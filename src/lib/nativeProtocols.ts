// 内置原生协议解析器 —— 用于无法用 Kaitai YAML 子集表达的格式。
// 输出与 protocolParser 相同的 ParseResult（含 byteOwner），从而复用树↔hexdump 联动。

import type { ParseResult, ParsedNode } from "./protocolParser";
import type { Protocol } from "../stores/protocolStore";

const toHex = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");
const bytesHex = (bytes: number[], s: number, e: number) =>
  bytes.slice(s, e).map(toHex).join(" ");

/** 内置预设协议：始终存在、不可编辑 / 删除。 */
export const BUILTIN_PROTOCOLS: Protocol[] = [
  { id: "builtin-bitfield", name: "二进制位字段 (Bit Field)", yaml: "", native: "bitfield", builtin: true, inputMode: "hex" },
  { id: "builtin-nmea", name: "NMEA / GPS", yaml: "", native: "nmea", builtin: true, inputMode: "text" },
];

/** 分发到对应原生解析器。bytes 已由调用方从输入（hex 或 text）解码。 */
export function parseNative(native: string, bytes: number[], rawText: string): ParseResult {
  switch (native) {
    case "bitfield":
      return parseBitField(bytes);
    case "nmea":
      return parseNmea(bytes, rawText);
    default:
      return emptyResult(bytes, ["未知内置解析器: " + native]);
  }
}

function emptyResult(bytes: number[], errors: string[]): ParseResult {
  return { root: [], byteOwner: new Array(bytes.length).fill(null), totalBytes: bytes.length, bytesConsumed: 0, remaining: bytes.slice(), errors };
}

// ==================== 二进制位字段 ====================
// 每个字节展开为一个分组，其下 8 个 bit 子节点（高位在前）。
function parseBitField(bytes: number[]): ParseResult {
  const owner: (string | null)[] = new Array(bytes.length).fill(null);
  const root: ParsedNode[] = [];

  bytes.forEach((b, i) => {
    const byteId = "byte" + i;
    owner[i] = byteId;
    const bin = b.toString(2).padStart(8, "0");
    const bits: ParsedNode[] = [];
    for (let bit = 0; bit < 8; bit++) {
      const v = (b >> (7 - bit)) & 1;
      bits.push({
        id: byteId + ".b" + bit,
        name: "bit" + (7 - bit),
        byteStart: i,
        byteEnd: i + 1,
        bitOffset: bit,
        bitLen: 1,
        typeLabel: "b1",
        rawHex: toHex(b),
        value: String(v),
        meaning: v === 1 ? "置位" : undefined,
      });
    }
    root.push({
      id: byteId,
      name: "byte[" + i + "]",
      byteStart: i,
      byteEnd: i + 1,
      typeLabel: "u1",
      rawHex: toHex(b),
      value: "0x" + toHex(b) + " = " + b + " = 0b" + bin,
      isGroup: true,
      children: bits,
    });
  });

  return { root, byteOwner: owner, totalBytes: bytes.length, bytesConsumed: bytes.length, remaining: [], errors: [] };
}

// ==================== NMEA / GPS ====================

const nmeaToDecimal = (val: string, dir: string): number | null => {
  if (!val) return null;
  const num = parseFloat(val);
  if (isNaN(num)) return null;
  const deg = Math.floor(num / 100);
  const min = num - deg * 100;
  let decimal = deg + min / 60;
  if (dir === "S" || dir === "W") decimal = -decimal;
  return decimal;
};

const nmeaTime = (val: string): string => {
  if (!val || val.length < 6) return "";
  return val.slice(0, 2) + ":" + val.slice(2, 4) + ":" + val.slice(4, 6) + " UTC";
};

// 语义标签：给定语句类型后缀与字段索引 -> 显示名 + 值转换
interface FieldMeta { name: string; meaning?: (parts: string[]) => string | undefined; }

function fieldMetaFor(suffix: string): Record<number, FieldMeta> {
  const common: Record<number, FieldMeta> = {};
  if (suffix === "GGA") {
    common[1] = { name: "UTC 时间", meaning: (p) => nmeaTime(p[1]) };
    common[2] = { name: "纬度(原始)", meaning: (p) => { const v = nmeaToDecimal(p[2], p[3]); return v !== null ? v.toFixed(6) + "°" : undefined; } };
    common[3] = { name: "纬度方向" };
    common[4] = { name: "经度(原始)", meaning: (p) => { const v = nmeaToDecimal(p[4], p[5]); return v !== null ? v.toFixed(6) + "°" : undefined; } };
    common[5] = { name: "经度方向" };
    common[6] = { name: "定位质量", meaning: (p) => ({ "0": "无效", "1": "GPS", "2": "DGPS" }[p[6]] ?? undefined) };
    common[7] = { name: "卫星数" };
    common[8] = { name: "HDOP" };
    common[9] = { name: "海拔" };
  } else if (suffix === "RMC") {
    common[1] = { name: "UTC 时间", meaning: (p) => nmeaTime(p[1]) };
    common[2] = { name: "状态", meaning: (p) => (p[2] === "A" ? "有效" : "无效") };
    common[3] = { name: "纬度(原始)", meaning: (p) => { const v = nmeaToDecimal(p[3], p[4]); return v !== null ? v.toFixed(6) + "°" : undefined; } };
    common[4] = { name: "纬度方向" };
    common[5] = { name: "经度(原始)", meaning: (p) => { const v = nmeaToDecimal(p[5], p[6]); return v !== null ? v.toFixed(6) + "°" : undefined; } };
    common[6] = { name: "经度方向" };
    common[7] = { name: "速度(节)" };
    common[8] = { name: "航向" };
    common[9] = { name: "日期" };
  } else if (suffix === "GSA") {
    common[2] = { name: "定位模式", meaning: (p) => ({ "1": "无定位", "2": "2D", "3": "3D" }[p[2]] ?? undefined) };
    common[15] = { name: "PDOP" };
    common[16] = { name: "HDOP" };
    common[17] = { name: "VDOP" };
  } else if (suffix === "GSV") {
    common[1] = { name: "消息总数" };
    common[2] = { name: "当前消息号" };
    common[3] = { name: "可见卫星数" };
  } else if (suffix === "VTG") {
    common[1] = { name: "真航向" };
    common[5] = { name: "地面速度(节)" };
    common[7] = { name: "地面速度(km/h)" };
  }
  return common;
}

function parseNmea(bytes: number[], rawText: string): ParseResult {
  const owner: (string | null)[] = new Array(bytes.length).fill(null);
  const root: ParsedNode[] = [];
  const errors: string[] = [];
  // rawText 与 bytes 为 ASCII 一一对应；用 rawText 定位偏移
  const text = rawText;

  const sentenceRe = /\$[^\r\n$]*/g;
  let m: RegExpExecArray | null;
  let sIdx = 0;
  while ((m = sentenceRe.exec(text)) !== null) {
    const sentence = m[0];
    const sStart = m.index;
    const suffix = sentence.slice(1).split(",")[0].slice(-3);
    const metas = fieldMetaFor(suffix);
    const gid = "s" + sIdx;

    // 拆分字段并记录字节区间（分隔符 , 与 *）
    const children: ParsedNode[] = [];
    const rawParts: string[] = [];
    let fieldStart = sStart + 1; // 跳过 '$'
    let cursor = sStart + 1;
    let fi = 0;
    const flush = (endOff: number) => {
      const val = text.slice(fieldStart, endOff);
      rawParts.push(val);
      const meta = metas[fi];
      const id = gid + ".f" + fi;
      for (let b = fieldStart; b < endOff && b < bytes.length; b++) owner[b] = id;
      children.push({
        id,
        name: meta ? meta.name : (fi === 0 ? "语句类型" : "字段" + fi),
        byteStart: fieldStart,
        byteEnd: endOff,
        typeLabel: "str",
        rawHex: bytesHex(bytes, fieldStart, endOff),
        value: val || "—",
      });
      fi++;
      fieldStart = endOff + 1;
    };
    const sEnd = sStart + sentence.length;
    while (cursor < sEnd) {
      const ch = text[cursor];
      if (ch === "," || ch === "*") { flush(cursor); }
      cursor++;
    }
    flush(sEnd);

    // 附加语义含义
    children.forEach((node, idx) => {
      const meta = metas[idx];
      if (meta && meta.meaning) { const mv = meta.meaning(rawParts); if (mv) node.meaning = mv; }
    });

    const gStart = sStart;
    const gEnd = Math.min(sEnd, bytes.length);
    root.push({
      id: gid,
      name: sentence.split(",")[0] || "$",
      byteStart: gStart,
      byteEnd: gEnd,
      typeLabel: "NMEA",
      rawHex: bytesHex(bytes, gStart, gEnd),
      value: suffix,
      isGroup: true,
      children,
    });
    sIdx++;
  }

  if (root.length === 0) errors.push("未识别到 NMEA 语句（应以 $ 开头）");
  const consumed = owner.filter((o) => o !== null).length;
  return { root, byteOwner: owner, totalBytes: bytes.length, bytesConsumed: consumed, remaining: [], errors };
}
