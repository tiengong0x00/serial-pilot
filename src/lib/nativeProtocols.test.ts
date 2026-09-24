import { describe, it, expect } from "vitest";
import { parseNative, BUILTIN_PROTOCOLS } from "./nativeProtocols";
import { flattenNodes } from "./protocolParser";

const textToBytes = (t: string) => Array.from(t).map((c) => c.charCodeAt(0) & 0xff);

describe("nativeProtocols: 内置预设", () => {
  it("暴露 bitfield 与 nmea 两个内置协议", () => {
    const ids = BUILTIN_PROTOCOLS.map((p) => p.native);
    expect(ids).toContain("bitfield");
    expect(ids).toContain("nmea");
    expect(BUILTIN_PROTOCOLS.every((p) => p.builtin)).toBe(true);
  });
});

describe("nativeProtocols: 位字段", () => {
  it("每字节展开 8 个 bit，byteOwner 指向该字节", () => {
    const r = parseNative("bitfield", [0xa5], "");
    expect(r.errors).toEqual([]);
    expect(r.root.length).toBe(1);
    const byte = r.root[0];
    expect(byte.children!.length).toBe(8);
    // 0xA5 = 1010 0101，最高位 bit7 = 1
    expect(byte.children![0].value).toBe("1");
    expect(byte.children![0].bitLen).toBe(1);
    expect(r.byteOwner[0]).toBe("byte0");
    expect(r.bytesConsumed).toBe(1);
  });
});

describe("nativeProtocols: NMEA/GPS", () => {
  const gga = "$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47";
  it("解析 GGA 语句为字段树，字段带字节区间与语义", () => {
    const bytes = textToBytes(gga);
    const r = parseNative("nmea", bytes, gga);
    expect(r.errors).toEqual([]);
    expect(r.root.length).toBe(1);
    const leaves = flattenNodes(r.root);
    const utc = leaves.find((n) => n.name === "UTC 时间")!;
    expect(utc).toBeTruthy();
    expect(utc.meaning).toBe("12:35:19 UTC");
    // 每个字段的字节区间应落在语句范围内
    expect(utc.byteStart).toBeGreaterThanOrEqual(0);
    expect(utc.byteEnd).toBeLessThanOrEqual(bytes.length);
    // byteOwner 至少覆盖部分字节
    expect(r.byteOwner.some((o) => o !== null)).toBe(true);
  });

  it("非 NMEA 文本报错", () => {
    const r = parseNative("nmea", textToBytes("hello"), "hello");
    expect(r.errors.length).toBeGreaterThan(0);
  });
});
