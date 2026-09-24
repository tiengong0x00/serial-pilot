import { describe, it, expect } from "vitest";
import { parseWithYaml, parseYamlBytes, flattenNodes, compileSpec, evalExpr } from "./protocolParser";

describe("protocolParser: 基础类型与字节范围", () => {
  const yaml = [
    "meta:",
    "  id: basic",
    "  endian: be",
    "seq:",
    "  - id: magic",
    "    type: u1",
    "  - id: len",
    "    type: u2",
    "  - id: flag",
    "    type: u1",
    "    enum: state",
    "enums:",
    "  state:",
    "    0: idle",
    "    1: active",
  ].join("\n");

  it("解析出正确的节点、字节范围与 byteOwner", () => {
    const r = parseWithYaml(yaml, "AB 00 05 01");
    expect(r.errors).toEqual([]);
    expect(r.totalBytes).toBe(4);
    expect(r.bytesConsumed).toBe(4);

    const leaves = flattenNodes(r.root);
    const byName = (n: string) => leaves.find((x) => x.name === n)!;

    const magic = byName("magic");
    expect(magic.byteStart).toBe(0);
    expect(magic.byteEnd).toBe(1);
    expect(magic.rawHex.toUpperCase()).toBe("AB");

    const len = byName("len");
    expect(len.byteStart).toBe(1);
    expect(len.byteEnd).toBe(3);
    expect(len.value).toBe("5");

    const flag = byName("flag");
    expect(flag.byteStart).toBe(3);
    expect(flag.byteEnd).toBe(4);
    expect(flag.meaning).toBe("active");
  });

  it("byteOwner 将每个字节映射到其所属叶子节点 id", () => {
    const r = parseWithYaml(yaml, "AB 00 05 01");
    expect(r.byteOwner.length).toBe(4);
    const leaves = flattenNodes(r.root);
    const magicId = leaves.find((x) => x.name === "magic")!.id;
    const lenId = leaves.find((x) => x.name === "len")!.id;
    expect(r.byteOwner[0]).toBe(magicId);
    expect(r.byteOwner[1]).toBe(lenId);
    expect(r.byteOwner[2]).toBe(lenId);
  });
});

describe("protocolParser: 表达式 / if / repeat", () => {
  it("evalExpr 支持算术与比较", () => {
    const v = new Map([["n", 12]]);
    expect(evalExpr("n / 4", v, "t")).toBe(3);
    expect(evalExpr("n % 5", v, "t")).toBe(2);
    expect(evalExpr("n > 10 and n < 20", v, "t")).toBe(1);
  });

  it("if 为假时跳过字段，不消费字节", () => {
    const yaml = [
      "meta:",
      "  id: cond",
      "  endian: be",
      "seq:",
      "  - id: has_body",
      "    type: u1",
      "  - id: body",
      "    type: u2",
      "    if: has_body == 1",
    ].join("\n");
    const r = parseWithYaml(yaml, "00 AA BB");
    expect(r.errors).toEqual([]);
    expect(r.bytesConsumed).toBe(1);
    const names = flattenNodes(r.root).map((n) => n.name);
    expect(names).not.toContain("body");
  });

  it("repeat-expr 按字段值重复", () => {
    const yaml = [
      "meta:",
      "  id: rep",
      "  endian: be",
      "seq:",
      "  - id: count",
      "    type: u1",
      "  - id: items",
      "    type: u1",
      "    repeat: expr",
      "    repeat-expr: count",
    ].join("\n");
    const r = parseWithYaml(yaml, "03 11 22 33");
    expect(r.errors).toEqual([]);
    expect(r.bytesConsumed).toBe(4);
  });
});

describe("protocolParser: 位域", () => {
  it("b1..bN 记录 bitOffset / bitLen", () => {
    const yaml = [
      "meta:",
      "  id: bits",
      "  endian: be",
      "seq:",
      "  - id: hi",
      "    type: b4",
      "  - id: lo",
      "    type: b4",
    ].join("\n");
    const r = parseWithYaml(yaml, "A5");
    expect(r.errors).toEqual([]);
    const leaves = flattenNodes(r.root);
    const hi = leaves.find((x) => x.name === "hi")!;
    const lo = leaves.find((x) => x.name === "lo")!;
    expect(hi.value).toBe("10");
    expect(lo.value).toBe("5");
    expect(hi.bitOffset).toBe(0);
    expect(hi.bitLen).toBe(4);
    expect(lo.bitOffset).toBe(4);
  });
});

describe("protocolParser: 校验不支持关键字", () => {
  it("process 报错", () => {
    expect(() =>
      compileSpec(["meta:", "  id: x", "seq:", "  - id: a", "    type: u1", "    process: zlib"].join("\n")),
    ).toThrow();
  });
});

describe("protocolParser: parseYamlBytes 按字节解析（输入模式）", () => {
  const yaml = [
    "meta:",
    "  id: m",
    "  endian: be",
    "seq:",
    "  - id: a",
    "    type: u1",
    "  - id: b",
    "    type: u1",
  ].join("\n");

  const hexToBytes = (h: string) => {
    const c = h.replace(/[^0-9a-fA-F]/g, "");
    const o: number[] = [];
    for (let i = 0; i + 1 < c.length; i += 2) o.push(parseInt(c.substr(i, 2), 16));
    return o;
  };
  const textToBytes = (t: string) => Array.from(t).map((ch) => ch.charCodeAt(0) & 0xff);

  it("hex 模式与 text 模式对同一字符串产生不同字节与结果", () => {
    const raw = "0605";
    const rh = parseYamlBytes(yaml, hexToBytes(raw)); // [0x06, 0x05]
    const rt = parseYamlBytes(yaml, textToBytes(raw)); // ['0','6','0','5'] = [0x30,0x36,0x30,0x35]

    expect(rh.root[0].value).toBe("6");
    expect(rh.root[1].value).toBe("5");
    // 文本模式：'0'=0x30=48, '6'=0x36=54
    expect(rt.root[0].value).toBe("48");
    expect(rt.root[1].value).toBe("54");
    expect(rt.totalBytes).toBe(4);
  });
});

