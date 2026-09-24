// 协议解析 DSL —— 解释器（运行时）。见 docs 规范 §4/§5/§6。
// 按 DslFile + 字节流产出 ParsedNode/ParseResult，供 UI 树/hexdump 联动。
//
// 注意：match 的 case body 从「tag 之后的当前位置」开始解析，不回读 tag 字节。
// parse tlv / lwm2m 均不实现，恒定降级为 raw：输出 { len, data(hex) }。

import type {
  DslFile, StructDef, Field, TypeExpr, Modifier, Expr, Literal,
} from "./ast";
import type { Endian, ParsedNode, ParseResult } from "./types";

// ---------- 位/字节读取器（窗口 [start,end)） ----------
class Reader {
  bytes: Uint8Array;
  pos: number;
  end: number;
  constructor(bytes: Uint8Array, start = 0, end = bytes.length) {
    this.bytes = bytes; this.pos = start; this.end = end;
  }
  get remaining(): number { return this.end - this.pos; }
  eof(): boolean { return this.pos >= this.end; }
  readBytes(n: number): Uint8Array {
    if (n < 0) throw new Error(`长度为负: ${n}`);
    if (this.pos + n > this.end) throw new Error(`字节流不足：需要 ${n}，仅剩 ${this.end - this.pos}`);
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
}

const toHex = (b: Uint8Array | number[]) =>
  Array.from(b).map((n) => n.toString(16).toUpperCase().padStart(2, "0")).join(" ");

const INT_BYTES: Record<string, number> = {
  u8: 1, u16: 2, u32: 4, u64: 8, i8: 1, i16: 2, i32: 4, i64: 8,
};

function bytesToInt(b: Uint8Array, endian: Endian, signed: boolean): number {
  const ordered = endian === "le" ? Array.from(b).reverse() : Array.from(b);
  let val = 0;
  for (const byte of ordered) val = val * 256 + byte;
  if (signed) {
    const bits = b.length * 8;
    const max = 2 ** bits;
    if (val >= max / 2) val -= max;
  }
  return val;
}

// BCD：每半字节一位十进制，高半字节在前。返回 {digits, illegal}
function decodeBcd(b: Uint8Array): { digits: string; illegal: boolean } {
  let s = "";
  let illegal = false;
  for (const byte of b) {
    const hi = byte >> 4, lo = byte & 0x0f;
    if (hi > 9 || lo > 9) illegal = true;
    s += String(hi) + String(lo);
  }
  return { digits: s, illegal };
}

// ---------- 上下文 ----------
interface Ctx {
  file: DslFile;
  errors: string[];
  values: Map<string, number>;  // 字段名 -> 数值（供表达式引用）
  owner: (string | null)[];
}

function claim(ctx: Ctx, start: number, end: number, id: string): void {
  for (let i = start; i < end && i < ctx.owner.length; i++) ctx.owner[i] = id;
}

// ---------- 表达式求值 ----------
function evalExpr(e: Expr, ctx: Ctx, reader: Reader, label: string): number {
  switch (e.kind) {
    case "num": return e.value;
    case "rest": return reader.remaining;
    case "id": {
      const v = ctx.values.get(e.name);
      if (v == null) throw new Error(`${label}: 引用 "${e.name}" 未找到或非数值`);
      return v;
    }
    case "unary": {
      const v = evalExpr(e.operand, ctx, reader, label);
      return e.op === "-" ? -v : (v === 0 ? 1 : 0);
    }
    case "binary": {
      const a = evalExpr(e.left, ctx, reader, label);
      const b = evalExpr(e.right, ctx, reader, label);
      switch (e.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return Math.trunc(a / b);
        case "%": return a % b;
        case "<": return a < b ? 1 : 0;
        case "<=": return a <= b ? 1 : 0;
        case ">": return a > b ? 1 : 0;
        case ">=": return a >= b ? 1 : 0;
        case "==": return a === b ? 1 : 0;
        case "!=": return a !== b ? 1 : 0;
        case "and": return a !== 0 && b !== 0 ? 1 : 0;
        case "or": return a !== 0 || b !== 0 ? 1 : 0;
        default: throw new Error(`${label}: 未知运算符`);
      }
    }
  }
}

// 修饰符查询
function findEndian(mods: Modifier[], def: Endian): Endian {
  for (const m of mods) if (m.kind === "endian") return m.endian;
  return def;
}
function hasMod(mods: Modifier[], k: Modifier["kind"]): boolean {
  return mods.some((m) => m.kind === k);
}
function enumMod(mods: Modifier[]): Modifier & { kind: "enum" } | undefined {
  return mods.find((m) => m.kind === "enum") as any;
}
function enumLookup(ctx: Ctx, mod: Modifier & { kind: "enum" } | undefined, value: number): string | undefined {
  if (!mod) return undefined;
  const map = mod.inline ?? (mod.enumName ? ctx.file.enums[mod.enumName]?.entries : undefined);
  if (!map) return `未知(${value})`;
  return map[String(value)] ?? `未知(${value})`;
}

// 固定值校验：返回告警文案（不匹配时）
function checkFixed(fixed: Literal, raw: Uint8Array, numeric: number | undefined, offset: number): string | undefined {
  if (fixed.kind === "num") {
    if (numeric !== undefined && numeric === fixed.value) return undefined;
    return `期望 ${fixed.value}，实际 ${numeric ?? toHex(raw)} @${offset}`;
  }
  if (fixed.kind === "hex") {
    const ok = raw.length === fixed.bytes.length && fixed.bytes.every((v, i) => v === raw[i]);
    return ok ? undefined : `期望 ${toHex(fixed.bytes)}，实际 ${toHex(raw)} @${offset}`;
  }
  // str
  const dec = new TextDecoder("utf-8").decode(raw);
  return dec === fixed.value ? undefined : `期望 "${fixed.value}"，实际 "${dec}" @${offset}`;
}

function walkStruct(s: StructDef, reader: Reader, ctx: Ctx, idPrefix: string, out: ParsedNode[]): void {
  for (const f of s.fields) walkField(f, reader, ctx, idPrefix, out);
}

function walkField(f: Field, reader: Reader, ctx: Ctx, idPrefix: string, out: ParsedNode[]): void {
  // if 条件为假：跳过，不消费字节
  if (f.cond && evalExpr(f.cond, ctx, reader, `${f.id} if`) === 0) return;
  const nodeId = `${idPrefix}/${f.id}`;

  // parse 子解析器：tlv/lwm2m 均不实现 → 降级 raw（{len, data}）
  if (f.parse) {
    const start = reader.pos;
    const len = storageLength(f.type, reader, ctx);
    const raw = reader.readBytes(len);
    claim(ctx, start, reader.pos, nodeId);
    out.push({
      id: nodeId, name: f.id, byteStart: start, byteEnd: reader.pos,
      typeLabel: `raw(${f.parse})`, rawHex: toHex(raw),
      value: `{ len: ${raw.length}, data: ${toHex(raw)} }`,
      warning: `子解析器 "${f.parse}" 未实现，已降级为 raw`,
    });
    return;
  }

  decodeType(f, f.type, reader, ctx, nodeId, f.id, out);
}

// 求「storage 层」应读取的字节数（供 parse 降级用）
function storageLength(t: TypeExpr, reader: Reader, ctx: Ctx): number {
  if (t.kind === "bytes") return evalExpr(t.length, ctx, reader, "bytes length");
  if (t.kind === "scalar") return INT_BYTES[t.base] ?? (t.base === "f32" ? 4 : t.base === "f64" ? 8 : 0);
  if (t.kind === "array") {
    const cnt = evalExpr(t.count, ctx, reader, "array count");
    return cnt * (INT_BYTES[t.base] ?? (t.base === "f32" ? 4 : 8));
  }
  return reader.remaining;
}

function decodeType(f: Field, t: TypeExpr, reader: Reader, ctx: Ctx, nodeId: string, name: string, out: ParsedNode[]): void {
  switch (t.kind) {
    case "scalar":    return decodeScalar(f, t.base, t.modifiers, reader, ctx, nodeId, name, out);
    case "bytes":     return decodeBytes(f, t, reader, ctx, nodeId, name, out);
    case "varint":    return decodeVarint(f, t, reader, ctx, nodeId, name, out);
    case "array":     return decodeArray(f, t, reader, ctx, nodeId, name, out);
    case "bitfield":  return decodeBitfield(t, reader, ctx, nodeId, name, out);
    case "structRef": return decodeStructRef(t.name, reader, ctx, nodeId, name, out);
    case "match":     return decodeMatch(f, t, reader, ctx, nodeId, name, out);
  }
}

function decodeScalar(f: Field, base: string, mods: Modifier[], reader: Reader, ctx: Ctx, nodeId: string, name: string, out: ParsedNode[]): void {
  const start = reader.pos;
  const isFloat = base === "f32" || base === "f64";
  const nBytes = isFloat ? (base === "f32" ? 4 : 8) : INT_BYTES[base];
  const raw = reader.readBytes(nBytes);
  claim(ctx, start, reader.pos, nodeId);
  const endian = findEndian(mods, ctx.file.endian);
  const signed = base.startsWith("i");

  let value: string;
  let meaning: string | undefined;
  let warning: string | undefined;
  let numeric: number | undefined;
  let label = base;

  if (isFloat) {
    const dv = new DataView(raw.slice().buffer);
    const v = base === "f32" ? dv.getFloat32(0, endian === "le") : dv.getFloat64(0, endian === "le");
    value = String(v);
  } else if (hasMod(mods, "bcd")) {
    const { digits, illegal } = decodeBcd(raw);
    numeric = Number(digits);
    value = digits.replace(/^0+(?=\d)/, "");
    label = base + " bcd";
    if (illegal) warning = "BCD 非法半字节(>9)";
  } else {
    numeric = bytesToInt(raw, endian, signed);
    if (hasMod(mods, "hex")) { value = "0x" + toHex(raw).replace(/ /g, ""); label = base + " hex"; }
    else value = String(numeric);
  }

  // enum 映射（基于数值）
  const em = enumMod(mods);
  if (em && numeric !== undefined) { meaning = enumLookup(ctx, em, numeric); label += " enum"; }

  if (numeric !== undefined) ctx.values.set(name, numeric);

  // 固定值校验
  if (f.fixed) { const w = checkFixed(f.fixed, raw, numeric, start); if (w) warning = warning ? warning + "; " + w : w; }

  out.push({ id: nodeId, name, byteStart: start, byteEnd: reader.pos, typeLabel: label, rawHex: toHex(raw), value, meaning, warning, error: false });
}

function decodeBytes(f: Field, t: Extract<TypeExpr, { kind: "bytes" }>, reader: Reader, ctx: Ctx, nodeId: string, name: string, out: ParsedNode[]): void {
  const start = reader.pos;
  const len = evalExpr(t.length, ctx, reader, `${name} length`);
  const raw = reader.readBytes(len);
  claim(ctx, start, reader.pos, nodeId);
  let value: string;
  let warning: string | undefined;
  let numeric: number | undefined;
  let label = `bytes[${len}]`;

  if (hasMod(t.modifiers, "bcd")) {
    const { digits, illegal } = decodeBcd(raw);
    value = digits;
    numeric = Number(digits);
    label += " bcd";
    if (illegal) warning = "BCD 非法半字节(>9)";
  } else if (hasMod(t.modifiers, "ascii")) {
    value = JSON.stringify(Array.from(raw).map((c) => (c >= 0x20 && c < 0x7f) ? String.fromCharCode(c) : `\\x${c.toString(16).padStart(2, "0")}`).join(""));
    label += " ascii";
  } else if (hasMod(t.modifiers, "hex")) {
    value = toHex(raw); label += " hex";
  } else {
    value = toHex(raw);
  }
  if (numeric !== undefined) ctx.values.set(name, numeric);
  if (f.fixed) { const w = checkFixed(f.fixed, raw, numeric, start); if (w) warning = warning ? warning + "; " + w : w; }
  out.push({ id: nodeId, name, byteStart: start, byteEnd: reader.pos, typeLabel: label, rawHex: toHex(raw), value, warning });
}

function decodeVarint(f: Field, t: Extract<TypeExpr, { kind: "varint" }>, reader: Reader, ctx: Ctx, nodeId: string, name: string, out: ParsedNode[]): void {
  const start = reader.pos;
  let value = 0, shift = 0, count = 0;
  let warning: string | undefined;
  for (;;) {
    if (reader.eof()) throw new Error(`${name}: varint 读取越界`);
    const byte = reader.readBytes(1)[0];
    count++;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (count >= t.maxBytes) { warning = `varint 超过 ${t.maxBytes} 字节`; break; }
  }
  claim(ctx, start, reader.pos, nodeId);
  ctx.values.set(name, value);
  if (f.fixed && f.fixed.kind === "num" && f.fixed.value !== value) {
    warning = (warning ? warning + "; " : "") + `期望 ${f.fixed.value}，实际 ${value} @${start}`;
  }
  out.push({ id: nodeId, name, byteStart: start, byteEnd: reader.pos, typeLabel: `varint(${t.maxBytes})`, rawHex: toHex(reader.bytes.subarray(start, reader.pos)), value: String(value), warning });
}

function decodeArray(_f: Field, t: Extract<TypeExpr, { kind: "array" }>, reader: Reader, ctx: Ctx, nodeId: string, name: string, out: ParsedNode[]): void {
  const start = reader.pos;
  const count = evalExpr(t.count, ctx, reader, `${name} count`);
  const children: ParsedNode[] = [];
  for (let i = 0; i < count; i++) {
    // 复用标量解码，元素名 name[i]，不写入 values（避免污染引用）
    const childId = `${nodeId}[${i}]`;
    decodeScalar({ id: `${name}[${i}]`, type: t as any, line: 0 }, t.base, t.modifiers, reader, ctx, childId, `${name}[${i}]`, children);
  }
  out.push({
    id: nodeId, name, byteStart: start, byteEnd: reader.pos,
    typeLabel: `${t.base}[${count}]`, rawHex: "", value: "", isGroup: true, children,
  });
}

function decodeBitfield(t: Extract<TypeExpr, { kind: "bitfield" }>, reader: Reader, ctx: Ctx, nodeId: string, name: string, out: ParsedNode[]): void {
  const nBytes = t.bitSize / 8;
  const start = reader.pos;
  const raw = reader.readBytes(nBytes);
  claim(ctx, start, reader.pos, nodeId);
  // 大整数（MSB 在前），提取 [lo..hi]
  let acc = 0;
  for (const b of raw) acc = acc * 256 + b;
  const children: ParsedNode[] = [];
  for (const bf of t.fields) {
    const width = bf.hi - bf.lo + 1;
    const v = Math.floor(acc / 2 ** bf.lo) % 2 ** width;
    // 展示用 bitOffset：从 MSB(0) 起
    const bitOffFromMsb = t.bitSize - 1 - bf.hi;
    const startByteOfBit = start + Math.floor(bitOffFromMsb / 8);
    ctx.values.set(bf.id, v);
    const meaning = (bf.enumName || bf.inlineEnum)
      ? enumLookup(ctx, { kind: "enum", enumName: bf.enumName, inline: bf.inlineEnum } as any, v)
      : undefined;
    children.push({
      id: `${nodeId}.${bf.id}`, name: bf.id,
      byteStart: startByteOfBit, byteEnd: start + nBytes,
      bitOffset: bitOffFromMsb % 8, bitLen: width,
      typeLabel: bf.hi === bf.lo ? `bit ${bf.hi}` : `bit ${bf.hi}:${bf.lo}`,
      rawHex: toHex(raw), value: String(v), meaning,
    });
  }
  out.push({
    id: nodeId, name, byteStart: start, byteEnd: reader.pos,
    typeLabel: `bitfield(${t.bitSize})`, rawHex: toHex(raw),
    value: "0x" + toHex(raw).replace(/ /g, ""), isGroup: true, children,
  });
}

function decodeStructRef(structName: string, reader: Reader, ctx: Ctx, nodeId: string, name: string, out: ParsedNode[]): void {
  const s = ctx.file.structs[structName];
  if (!s) throw new Error(`引用未定义 struct "${structName}"`);
  const start = reader.pos;
  const children: ParsedNode[] = [];
  walkStruct(s, reader, ctx, nodeId, children);
  out.push({
    id: nodeId, name, byteStart: start, byteEnd: reader.pos,
    typeLabel: structName, rawHex: "", value: "", isGroup: true, children,
  });
}

function decodeMatch(f: Field, t: Extract<TypeExpr, { kind: "match" }>, reader: Reader, ctx: Ctx, nodeId: string, name: string, out: ParsedNode[]): void {
  const tagVal = ctx.values.get(t.tag);
  if (tagVal == null) throw new Error(`match: tag "${t.tag}" 无数值`);
  let chosen = t.cases.find((c) => !c.isDefault && c.literal?.kind === "num" && c.literal.value === tagVal);
  if (!chosen) chosen = t.cases.find((c) => c.isDefault);
  if (!chosen) {
    // 无匹配分支且无默认：记录告警，不消费
    out.push({ id: nodeId, name, byteStart: reader.pos, byteEnd: reader.pos, typeLabel: `match ${t.tag}`, rawHex: "", value: `无匹配分支(${tagVal})`, warning: `match ${t.tag}=${tagVal} 无匹配分支` });
    return;
  }
  // case body 从当前位置解析（不回读 tag）
  decodeType(f, chosen.body, reader, ctx, nodeId, name, out);
}

// ---------- 入口 ----------
export function interpret(file: DslFile, bytes: number[] | Uint8Array): ParseResult {
  const buf = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  const reader = new Reader(buf);
  const ctx: Ctx = { file, errors: [], values: new Map(), owner: new Array(buf.length).fill(null) };
  const root: ParsedNode[] = [];
  const rootStruct = file.structs[file.root];
  try {
    if (!rootStruct) throw new Error(`根结构体 "${file.root}" 未定义`);
    walkStruct(rootStruct, reader, ctx, "", root);
  } catch (e: any) {
    ctx.errors.push(e?.message || String(e));
  }
  return {
    root,
    byteOwner: ctx.owner,
    totalBytes: buf.length,
    bytesConsumed: reader.pos,
    remaining: Array.from(buf.subarray(reader.pos)),
    errors: ctx.errors,
  };
}
