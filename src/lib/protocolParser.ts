// 协议解析器 —— Kaitai Struct 风格 YAML 子集的运行时解释器
//
// 输出为带精确字节范围的树(ParsedNode)，供 hexdump ↔ 解码树联动。
//
// 支持的关键字子集（参考 https://doc.kaitai.io/user_guide.html）：
//   meta.id / meta.endian(be|le)
//   seq[].id / type / size / size-eos / enum / repeat / repeat-expr / if / doc
//   type: u1 u2 u4 u8 s1 s2 s4 s8 (可带 le/be 后缀) / f4 f8 / b1..b32 / str / strz / 自定义子类型名
//   types: 自定义子结构（含 seq）    enums: 值 -> 含义
//   size / repeat-expr / if 支持迷你表达式：+ - * / %、比较、and/or/not、括号、字段引用
// 不支持 process / io / pos / value / switch-on / instances（校验时明确报错）。

import yaml from "js-yaml";

export type Endian = "be" | "le";

export interface KsyField {
  id: string;
  type?: string;
  size?: number | string;
  sizeEos?: boolean;
  enumName?: string;
  repeat?: "eos" | "expr";
  repeatExpr?: number | string;
  encoding?: string;
  doc?: string;
  cond?: string; // if 条件表达式
}

export interface KsySpec {
  metaId: string;
  endian: Endian;
  seq: KsyField[];
  types: Record<string, KsyField[]>;
  enums: Record<string, Record<string, string>>;
}

/** 解析结果树节点：字段名 + 精确字节范围 + 值 + 子节点 */
export interface ParsedNode {
  id: string;             // 稳定唯一 id（路径式），供联动定位
  name: string;
  byteStart: number;      // 起始字节偏移（含）
  byteEnd: number;        // 结束字节偏移（不含）
  bitOffset?: number;     // 位域：在 byteStart 内的位偏移（从高位起 0）
  bitLen?: number;        // 位域宽度
  typeLabel: string;      // 展示用类型标签
  rawHex: string;         // 覆盖字节的 hex
  value: string;
  meaning?: string;       // enum 含义
  error?: boolean;
  isGroup?: boolean;      // 子结构容器
  children?: ParsedNode[];
}

export interface ParseResult {
  root: ParsedNode[];        // 顶层字段
  byteOwner: (string | null)[]; // byteOwner[i] = 拥有第 i 字节的叶子节点 id
  totalBytes: number;
  bytesConsumed: number;
  remaining: number[];
  errors: string[];
}

// ---------- 位/字节读取器（支持窗口 [start,end)） ----------
class Reader {
  bytes: Uint8Array;
  pos: number;
  end: number;
  private bitBuf = 0;
  private bitCount = 0;
  bitStartOffset = 0; // 最近一次 readBits 起始处在字节内的位偏移
  bitStartByte = 0;   // 最近一次 readBits 覆盖的起始字节（含）
  bitEndByte = 0;     // 最近一次 readBits 覆盖的结束字节（不含）

  constructor(bytes: Uint8Array, start = 0, end = bytes.length) {
    this.bytes = bytes;
    this.pos = start;
    this.end = end;
  }

  eof(): boolean {
    this.alignToByte();
    return this.pos >= this.end;
  }

  alignToByte(): void {
    this.bitBuf = 0;
    this.bitCount = 0;
  }

  readBytes(n: number): Uint8Array {
    this.alignToByte();
    if (this.pos + n > this.end) throw new Error(`数据不足：需要 ${n} 字节，仅剩 ${this.end - this.pos}`);
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  readBits(n: number): number {
    if (n < 1 || n > 32) throw new Error(`位字段宽度 ${n} 超出 1..32`);
    // 缓冲区中已有 bitCount 位（属于 [pos-⌈bitCount/8⌉, pos) 的字节）。
    // 本次读取的绝对起始位 = 已消费字节位数 - 缓冲剩余位数。
    const startBit = this.pos * 8 - this.bitCount;
    this.bitStartOffset = startBit % 8;
    this.bitStartByte = Math.floor(startBit / 8);
    this.bitEndByte = Math.ceil((startBit + n) / 8);
    while (this.bitCount < n) {
      if (this.pos >= this.end) throw new Error("数据不足：位字段读取越界");
      this.bitBuf = this.bitBuf * 256 + this.bytes[this.pos];
      this.pos += 1;
      this.bitCount += 8;
    }
    const shift = this.bitCount - n;
    const div = 2 ** shift;
    const val = Math.floor(this.bitBuf / div) % 2 ** n;
    this.bitBuf = this.bitBuf % div;
    this.bitCount -= n;
    return val;
  }
}

// ---------- YAML -> KsySpec ----------
const KNOWN_FIELD_KEYS = new Set([
  "id", "type", "size", "size-eos", "enum", "repeat", "repeat-expr", "doc", "encoding", "contents", "if",
]);
const UNSUPPORTED_FIELD_KEYS = new Set(["process", "io", "pos", "value", "cases", "switch-on"]);

function compileField(raw: any, path: string): KsyField {
  if (typeof raw !== "object" || raw === null) throw new Error(`${path}: 字段必须是对象`);
  for (const k of Object.keys(raw)) {
    if (UNSUPPORTED_FIELD_KEYS.has(k)) throw new Error(`${path}: 暂不支持关键字 "${k}"`);
    if (!KNOWN_FIELD_KEYS.has(k)) throw new Error(`${path}: 未知关键字 "${k}"`);
  }
  if (!raw.id || typeof raw.id !== "string") throw new Error(`${path}: 缺少 id`);
  if (raw.type && typeof raw.type === "object") throw new Error(`${path}.type: 暂不支持 switch-on 类型`);
  const repeat = raw.repeat as string | undefined;
  if (repeat && repeat !== "eos" && repeat !== "expr") {
    throw new Error(`${path}.repeat: 仅支持 eos / expr（不支持 "${repeat}"）`);
  }
  return {
    id: raw.id,
    type: raw.type != null ? String(raw.type) : undefined,
    size: raw.size,
    sizeEos: raw["size-eos"] === true,
    enumName: raw.enum != null ? String(raw.enum) : undefined,
    repeat: repeat as KsyField["repeat"],
    repeatExpr: raw["repeat-expr"],
    encoding: raw.encoding,
    doc: raw.doc,
    cond: raw.if != null ? String(raw.if) : undefined,
  };
}

function compileSeq(seq: any, path: string): KsyField[] {
  if (!Array.isArray(seq)) throw new Error(`${path}: seq 必须是列表`);
  return seq.map((f, i) => compileField(f, `${path}[${i}]`));
}

export function compileSpec(text: string): KsySpec {
  let doc: any;
  try {
    doc = yaml.load(text);
  } catch (e: any) {
    throw new Error(`YAML 语法错误：${e.message || e}`);
  }
  if (typeof doc !== "object" || doc === null) throw new Error("协议定义为空或格式错误");
  const meta = doc.meta || {};
  const endian: Endian = meta.endian === "le" ? "le" : "be";
  const types: Record<string, KsyField[]> = {};
  if (doc.types) {
    if (typeof doc.types !== "object") throw new Error("types 必须是对象");
    for (const [name, def] of Object.entries<any>(doc.types)) {
      if (!def || !def.seq) throw new Error(`types.${name}: 缺少 seq`);
      types[name] = compileSeq(def.seq, `types.${name}.seq`);
    }
  }
  const enums: Record<string, Record<string, string>> = {};
  if (doc.enums) {
    for (const [name, map] of Object.entries<any>(doc.enums)) {
      const m: Record<string, string> = {};
      for (const [k, v] of Object.entries<any>(map)) m[String(k)] = String(v);
      enums[name] = m;
    }
  }
  return {
    metaId: meta.id ? String(meta.id) : "unnamed",
    endian,
    seq: compileSeq(doc.seq || [], "seq"),
    types,
    enums,
  };
}

// ---------- 迷你表达式求值（size / repeat-expr / if） ----------
type ExTok = { k: "num" | "id" | "op" | "lp" | "rp"; v: string; n?: number };

function tokenizeExpr(s: string): ExTok[] {
  const toks: ExTok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "(") { toks.push({ k: "lp", v: "(" }); i++; continue; }
    if (c === ")") { toks.push({ k: "rp", v: ")" }); i++; continue; }
    const two = s.substr(i, 2);
    if (two === "==" || two === "!=" || two === "<=" || two === ">=") { toks.push({ k: "op", v: two }); i += 2; continue; }
    if ("+-*/%<>".includes(c)) { toks.push({ k: "op", v: c }); i++; continue; }
    const num = /^(0[xX][0-9a-fA-F]+|\d+)/.exec(s.slice(i));
    if (num) { toks.push({ k: "num", v: num[0], n: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (id) {
      const w = id[0];
      if (w === "and" || w === "or" || w === "not") toks.push({ k: "op", v: w });
      else toks.push({ k: "id", v: w });
      i += w.length; continue;
    }
    throw new Error(`表达式无法解析: "${s}"`);
  }
  return toks;
}

const EX_PREC: Record<string, number> = {
  or: 1, and: 2, "==": 3, "!=": 3, "<": 4, "<=": 4, ">": 4, ">=": 4,
  "+": 5, "-": 5, "*": 6, "/": 6, "%": 6,
};

function applyOp(op: string, a: number, b: number): number {
  switch (op) {
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
    default: throw new Error(`未知运算符 "${op}"`);
  }
}

export function evalExpr(expr: string | number, values: Map<string, number>, ctxLabel: string): number {
  if (typeof expr === "number") return expr;
  const toks = tokenizeExpr(String(expr));
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];

  function parsePrimary(): number {
    const t = next();
    if (!t) throw new Error(`${ctxLabel}: 表达式不完整`);
    if (t.k === "num") return t.n!;
    if (t.k === "id") {
      const v = values.get(t.v);
      if (v == null) throw new Error(`${ctxLabel}: 引用 "${t.v}" 未找到或非数值`);
      return v;
    }
    if (t.k === "lp") {
      const v = parseBin(0);
      const r = next();
      if (!r || r.k !== "rp") throw new Error(`${ctxLabel}: 缺少 ")"`);
      return v;
    }
    if (t.k === "op" && (t.v === "-" || t.v === "not")) {
      const v = parsePrimary();
      return t.v === "-" ? -v : v === 0 ? 1 : 0;
    }
    throw new Error(`${ctxLabel}: 意外符号 "${t.v}"`);
  }

  function parseBin(minPrec: number): number {
    let left = parsePrimary();
    for (;;) {
      const t = peek();
      if (!t || t.k !== "op" || EX_PREC[t.v] == null || EX_PREC[t.v] < minPrec) break;
      const op = next().v;
      const right = parseBin(EX_PREC[op] + 1);
      left = applyOp(op, left, right);
    }
    return left;
  }

  const result = parseBin(0);
  if (pos !== toks.length) throw new Error(`${ctxLabel}: 表达式多余符号`);
  return result;
}

// ---------- 值解码 ----------
const toHex = (b: Uint8Array) => Array.from(b).map((n) => n.toString(16).toUpperCase().padStart(2, "0")).join(" ");

function bytesToInt(b: Uint8Array, endian: Endian, signed: boolean): number {
  let val = 0;
  const ordered = endian === "le" ? Array.from(b).reverse() : Array.from(b);
  for (const byte of ordered) val = val * 256 + byte;
  if (signed) {
    const bits = b.length * 8;
    const max = 2 ** bits;
    if (val >= max / 2) val -= max;
  }
  return val;
}

function intTypeInfo(type: string | undefined): { bytes?: number; bits?: number; signed: boolean; endian?: Endian } | null {
  if (!type) return null;
  const m = /^([us])(1|2|4|8)(le|be)?$/.exec(type);
  if (m) return { bytes: Number(m[2]), signed: m[1] === "s", endian: m[3] as Endian | undefined };
  const b = /^b([0-9]+)$/.exec(type);
  if (b) return { bits: Number(b[1]), signed: false };
  return null;
}

interface Ctx {
  spec: KsySpec;
  errors: string[];
  values: Map<string, number>;
  owner: (string | null)[]; // 全局字节归属
}

function claim(ctx: Ctx, start: number, end: number, id: string): void {
  for (let i = start; i < end && i < ctx.owner.length; i++) ctx.owner[i] = id;
}

function resolveSize(field: KsyField, reader: Reader, ctx: Ctx): number {
  if (field.sizeEos) return reader.end - reader.pos;
  const s = field.size;
  if (s == null) throw new Error(`字段 ${field.id}: 缺少 size / size-eos`);
  return evalExpr(s, ctx.values, `字段 ${field.id} size`);
}

function enumMeaning(ctx: Ctx, field: KsyField, value: string): string | undefined {
  if (!field.enumName) return undefined;
  const map = ctx.spec.enums[field.enumName];
  return map?.[value] ?? `<未定义:${field.enumName}>`;
}

// 解析一个叶子字段，返回节点（不含 children）
function decodeLeaf(field: KsyField, reader: Reader, ctx: Ctx, nodeId: string): ParsedNode {
  const startOffset = reader.pos;
  const type = field.type;
  const info = intTypeInfo(type);

  // 位字段
  if (info?.bits != null) {
    const v = reader.readBits(info.bits);
    const bitOff = reader.bitStartOffset;
    const startByte = reader.bitStartByte;
    const endByte = Math.max(reader.bitEndByte, startByte + 1);
    ctx.values.set(field.id, v);
    // 位字段与同字节其他位共享字节，按覆盖到的字节标记归属
    claim(ctx, startByte, endByte, nodeId);
    const raw = toHex(reader.bytes.subarray(startByte, endByte));
    const value = String(v);
    return { id: nodeId, name: field.id, byteStart: startByte, byteEnd: endByte,
      bitOffset: bitOff, bitLen: info.bits, typeLabel: type!, rawHex: raw, value, meaning: enumMeaning(ctx, field, value) };
  }
  // 整数
  if (info?.bytes != null) {
    const raw = reader.readBytes(info.bytes);
    const v = bytesToInt(raw, info.endian ?? ctx.spec.endian, info.signed);
    ctx.values.set(field.id, v);
    claim(ctx, startOffset, reader.pos, nodeId);
    const value = String(v);
    return { id: nodeId, name: field.id, byteStart: startOffset, byteEnd: reader.pos,
      typeLabel: type!, rawHex: toHex(raw), value, meaning: enumMeaning(ctx, field, value) };
  }
  // 浮点
  if (type === "f4" || type === "f8") {
    const n = type === "f4" ? 4 : 8;
    const raw = reader.readBytes(n);
    const dv = new DataView(raw.slice().buffer);
    const v = type === "f4" ? dv.getFloat32(0, ctx.spec.endian === "le") : dv.getFloat64(0, ctx.spec.endian === "le");
    claim(ctx, startOffset, reader.pos, nodeId);
    return { id: nodeId, name: field.id, byteStart: startOffset, byteEnd: reader.pos, typeLabel: type, rawHex: toHex(raw), value: String(v) };
  }
  // 字符串
  if (type === "str" || type === "strz") {
    let raw: Uint8Array;
    if (type === "strz") {
      const arr: number[] = [];
      while (!reader.eof()) { const c = reader.readBytes(1)[0]; if (c === 0) break; arr.push(c); }
      raw = Uint8Array.from(arr);
    } else {
      raw = reader.readBytes(resolveSize(field, reader, ctx));
    }
    claim(ctx, startOffset, reader.pos, nodeId);
    const dec = new TextDecoder(field.encoding || "utf-8");
    return { id: nodeId, name: field.id, byteStart: startOffset, byteEnd: reader.pos, typeLabel: type, rawHex: toHex(raw), value: JSON.stringify(dec.decode(raw)) };
  }
  // 无类型 / bytes：按 size 读原始字节
  const raw = reader.readBytes(resolveSize(field, reader, ctx));
  claim(ctx, startOffset, reader.pos, nodeId);
  return { id: nodeId, name: field.id, byteStart: startOffset, byteEnd: reader.pos, typeLabel: field.type || "bytes", rawHex: toHex(raw), value: toHex(raw) };
}

// ---------- 树遍历 ----------
function walkField(field: KsyField, reader: Reader, ctx: Ctx, idPrefix: string, out: ParsedNode[]): void {
  // if 条件为假：整段跳过（不消费字节、不产生节点）
  if (field.cond != null && evalExpr(field.cond, ctx.values, `字段 ${field.id} if`) === 0) return;

  if (field.repeat) {
    let count: number;
    if (field.repeat === "expr") {
      count = evalExpr(field.repeatExpr!, ctx.values, `字段 ${field.id} repeat-expr`);
      if (!Number.isFinite(count)) throw new Error(`字段 ${field.id}: repeat-expr 无法求值`);
    } else {
      count = Infinity;
    }
    let i = 0;
    while (i < count && !reader.eof()) {
      walkOne({ ...field, repeat: undefined }, reader, ctx, `${idPrefix}/${field.id}[${i}]`, out, `${field.id}[${i}]`);
      i++;
    }
    return;
  }
  walkOne(field, reader, ctx, `${idPrefix}/${field.id}`, out, field.id);
}

function walkOne(field: KsyField, reader: Reader, ctx: Ctx, nodeId: string, out: ParsedNode[], displayName: string): void {
  const sub = field.type ? ctx.spec.types[field.type] : undefined;
  if (sub) {
    // 子结构容器：受 size 约束的窗口内递归
    const startOffset = reader.pos;
    let subReader = reader;
    let windowLen = -1;
    if (field.size != null || field.sizeEos) {
      windowLen = resolveSize(field, reader, ctx);
      subReader = new Reader(reader.bytes, reader.pos, reader.pos + windowLen);
    }
    const children: ParsedNode[] = [];
    for (const child of sub) walkField(child, subReader, ctx, nodeId, children);
    const endOffset = windowLen >= 0 ? subReader.end : subReader.pos;
    if (windowLen >= 0) reader.pos = subReader.end;
    out.push({
      id: nodeId, name: displayName, byteStart: startOffset, byteEnd: endOffset,
      typeLabel: field.type!, rawHex: "", value: "", isGroup: true, children,
    });
    return;
  }
  const node = decodeLeaf(field, reader, ctx, nodeId);
  node.name = displayName;
  out.push(node);
}

function hexToBytes(hex: string): { bytes: Uint8Array; error?: string } {
  const clean = hex.replace(/0x/gi, "").replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2 !== 0) return { bytes: new Uint8Array(0), error: "Hex 长度为奇数，请检查输入" };
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  return { bytes };
}

/** 核心：按已解码的字节数组解析。 */
export function parseBytes(bytes: number[] | Uint8Array, spec: KsySpec): ParseResult {
  const buf = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  const reader = new Reader(buf);
  const ctx: Ctx = { spec, errors: [], values: new Map(), owner: new Array(buf.length).fill(null) };
  const root: ParsedNode[] = [];
  try {
    for (const field of spec.seq) walkField(field, reader, ctx, "", root);
  } catch (e: any) {
    ctx.errors.push(e.message || String(e));
  }
  reader.alignToByte();
  return {
    root,
    byteOwner: ctx.owner,
    totalBytes: buf.length,
    bytesConsumed: reader.pos,
    remaining: Array.from(buf.subarray(reader.pos)),
    errors: ctx.errors,
  };
}

export function parseHex(hex: string, spec: KsySpec): ParseResult {
  const { bytes, error } = hexToBytes(hex);
  if (error) return { root: [], byteOwner: [], totalBytes: 0, bytesConsumed: 0, remaining: [], errors: [error] };
  return parseBytes(bytes, spec);
}

/** 编译 YAML 后按字节数组解析（供 UI 用已选输入模式解码后的字节）。 */
export function parseYamlBytes(yamlText: string, bytes: number[] | Uint8Array): ParseResult {
  let spec: KsySpec;
  try {
    spec = compileSpec(yamlText);
  } catch (e: any) {
    return { root: [], byteOwner: [], totalBytes: 0, bytesConsumed: 0, remaining: [], errors: [e.message || String(e)] };
  }
  return parseBytes(bytes, spec);
}

export function parseWithYaml(yamlText: string, hex: string): ParseResult {
  let spec: KsySpec;
  try {
    spec = compileSpec(yamlText);
  } catch (e: any) {
    return { root: [], byteOwner: [], totalBytes: 0, bytesConsumed: 0, remaining: [], errors: [e.message || String(e)] };
  }
  return parseHex(hex, spec);
}

/** 展开树为扁平叶子列表（供按 id 查找 / 树渲染辅助） */
export function flattenNodes(nodes: ParsedNode[]): ParsedNode[] {
  const out: ParsedNode[] = [];
  const walk = (ns: ParsedNode[]) => {
    for (const n of ns) {
      out.push(n);
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}
