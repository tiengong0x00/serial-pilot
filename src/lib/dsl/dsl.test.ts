import { describe, it, expect } from "vitest";
import { parseDsl, compileDsl, flattenNodes } from "./index";

const hex = (s: string) => s.trim().split(/\s+/).map((b) => parseInt(b, 16));
const find = (r: ReturnType<typeof parseDsl>, name: string) =>
  flattenNodes(r.root).find((n) => n.name === name);

describe("DSL: 标量 / 固定值 / enum", () => {
  const src = `
    endian be
    root Frame
    enum State { 0: idle  1: active }
    struct Frame {
      magic:  u16 = 0xAA55
      flag:   u8 enum State
      length: u16
      body:   bytes[length] ascii
    }`;

  it("解析标量、固定值通过、enum 映射、长度引用", () => {
    const r = parseDsl(src, hex("AA 55 01 00 02 41 42"));
    expect(r.errors).toEqual([]);
    expect(find(r, "magic")!.warning).toBeUndefined();
    expect(find(r, "flag")!.meaning).toBe("active");
    expect(find(r, "length")!.value).toBe("2");
    expect(find(r, "body")!.value).toContain("AB");
    expect(r.bytesConsumed).toBe(7);
  });

  it("固定值不匹配 → warning，不中断", () => {
    const r = parseDsl(src, hex("AA 56 00 00 00"));
    expect(find(r, "magic")!.warning).toContain("期望");
    expect(r.errors).toEqual([]);
  });
});

describe("DSL: BCD", () => {
  it("u8 bcd 解读为十进制；bytes bcd 为数字串", () => {
    const src = `endian be
      root P
      struct P { a: u8 bcd  b: bytes[3] bcd }`;
    const r = parseDsl(src, hex("95 12 34 56"));
    expect(find(r, "a")!.value).toBe("95");
    expect(find(r, "b")!.value).toBe("123456");
  });
  it("非法半字节 → warning", () => {
    const src = `endian be
      root P
      struct P { a: u8 bcd }`;
    const r = parseDsl(src, hex("9F"));
    expect(find(r, "a")!.warning).toContain("BCD");
  });
});

describe("DSL: 位域", () => {
  it("MSB 起连续占位，区间提取正确", () => {
    // 0b1011_0010 = 0xB2
    const src = `endian be
      root P
      struct P {
        f: bitfield(8) { hi: 7:4  lo: 3:0 }
      }`;
    const r = parseDsl(src, hex("B2"));
    expect(find(r, "hi")!.value).toBe("11"); // 0b1011
    expect(find(r, "lo")!.value).toBe("2");  // 0b0010
  });
});

describe("DSL: varint (MQTT 剩余长度)", () => {
  it("低位在前，续接位", () => {
    const src = `endian be
      root M
      struct M {
        fixed: bitfield(8) { ptype: 7:4  flags: 3:0 }
        remaining_len: varint(4)
        variable: bytes[remaining_len]
      }`;
    // 0x30 PUBLISH; 剩余长度 300 = 0xAC 0x02; 300 字节这里用较短示例
    const r = parseDsl(src, hex("30 05 41 42 43 44 45"));
    expect(find(r, "ptype")!.value).toBe("3");
    expect(find(r, "remaining_len")!.value).toBe("5");
    expect(find(r, "variable")!.byteEnd).toBe(7);
  });
  it("varint 128 = 0x80 0x01", () => {
    const src = `endian be
      root M
      struct M { v: varint(4) }`;
    const r = parseDsl(src, hex("80 01"));
    expect(find(r, "v")!.value).toBe("128");
  });
});

describe("DSL: match 派发", () => {
  const src = `endian be
    root Packet
    struct Packet {
      msg_ver: u8
      body: match msg_ver {
        0x06 => Body6
        _    => bytes[rest]
      }
    }
    struct Body6 { x: u8  y: u8 }`;

  it("命中分支解析子结构", () => {
    const r = parseDsl(src, hex("06 11 22"));
    expect(r.errors).toEqual([]);
    expect(find(r, "x")!.value).toBe("17");
    expect(find(r, "y")!.value).toBe("34");
  });
  it("默认分支走 bytes[rest]", () => {
    const r = parseDsl(src, hex("09 AA BB CC"));
    expect(find(r, "body")!.value).toContain("AA BB CC");
  });
});

describe("DSL: parse 降级", () => {
  it("parse tlv 恒定降级 raw，输出 {len,data} 并告警", () => {
    const src = `endian be
      root F
      struct F {
        len: u8
        payload: bytes[len] parse tlv fallback raw
      }`;
    const r = parseDsl(src, hex("03 01 02 03"));
    const p = find(r, "payload")!;
    expect(p.value).toContain("len: 3");
    expect(p.warning).toContain("未实现");
  });
});

describe("DSL: 条件字段", () => {
  it("if 为假跳过，不占字节", () => {
    const src = `endian be
      root F
      struct F {
        flag: u8
        opt:  u8 if flag == 1
        tail: u8
      }`;
    const r = parseDsl(src, hex("00 AB"));
    expect(find(r, "opt")).toBeUndefined();
    expect(find(r, "tail")!.value).toBe("171");
  });
});

describe("DSL: 语义错误（编译期拒绝）", () => {
  it("位域位宽和不符 → 抛错", () => {
    const src = `endian be
      root P
      struct P { f: bitfield(8) { a: 7:4 } }`;
    expect(() => compileDsl(src)).toThrow(/位宽之和/);
  });
  it("match tag 非整数字段 → 抛错", () => {
    const src = `endian be
      root P
      struct P { name: bytes[2]  b: match name { _ => u8 } }`;
    expect(() => compileDsl(src)).toThrow(/整数字段/);
  });
  it("根结构体未定义 → 抛错", () => {
    expect(() => compileDsl(`endian be\nroot Nope\nstruct P { a: u8 }`)).toThrow(/根结构体/);
  });
});
