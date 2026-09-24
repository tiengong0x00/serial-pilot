// 协议解析 DSL —— 递归下降语法分析。见 docs 规范 §3。
// 产出 DslFile（AST）；语法错误抛 ParseError（带行号）。

import { tokenize, LexError } from "./lexer";
import type { Token } from "./lexer";
import type {
  DslFile, StructDef, Field, TypeExpr, Modifier, Expr, BinOp,
  Literal, EnumDef, BitField, MatchCase,
} from "./ast";
import type { Endian } from "./types";

export class ParseError extends Error {
  constructor(msg: string, public line: number) {
    super(`第 ${line} 行: ${msg}`);
  }
}

const SCALARS = new Set(["u8", "u16", "u32", "u64", "i8", "i16", "i32", "i64", "f32", "f64"]);

class Parser {
  toks: Token[];
  pos = 0;
  constructor(toks: Token[]) { this.toks = toks; }

  peek(): Token { return this.toks[this.pos]; }
  next(): Token { return this.toks[this.pos++]; }
  get line(): number { return this.peek().line; }

  isKw(v: string): boolean { const t = this.peek(); return t.kind === "kw" && t.value === v; }
  isPunct(v: string): boolean { const t = this.peek(); return t.kind === "punct" && t.value === v; }

  expectPunct(v: string): void {
    if (!this.isPunct(v)) throw new ParseError(`期望 "${v}"，实际 "${this.peek().value}"`, this.line);
    this.next();
  }
  expectKw(v: string): void {
    if (!this.isKw(v)) throw new ParseError(`期望关键字 "${v}"`, this.line);
    this.next();
  }
  expectId(): string {
    const t = this.peek();
    // 允许把「非保留字关键字」当标识符用的场景不存在——id 必须是 id 类
    if (t.kind !== "id") throw new ParseError(`期望标识符，实际 "${t.value}"`, this.line);
    return this.next().value;
  }

  parseFile(): DslFile {
    let endian: Endian = "be";
    let root = "";
    const enums: Record<string, EnumDef> = {};
    const structs: Record<string, StructDef> = {};
    let endianSeen = false;

    while (this.peek().kind !== "eof") {
      if (this.isKw("endian")) {
        if (endianSeen) throw new ParseError("endian 只能声明一次", this.line);
        endianSeen = true;
        this.next();
        if (this.isKw("be")) { endian = "be"; this.next(); }
        else if (this.isKw("le")) { endian = "le"; this.next(); }
        else throw new ParseError("endian 需为 be / le", this.line);
      } else if (this.isKw("root")) {
        this.next();
        root = this.expectId();
      } else if (this.isKw("enum")) {
        const e = this.parseEnum();
        enums[e.name] = e;
      } else if (this.isKw("struct")) {
        const s = this.parseStruct();
        structs[s.name] = s;
      } else {
        throw new ParseError(`意外符号 "${this.peek().value}"（期望 endian/root/enum/struct）`, this.line);
      }
    }
    return { endian, root, enums, structs };
  }

  parseEnum(): EnumDef {
    this.expectKw("enum");
    const name = this.expectId();
    this.expectPunct("{");
    const entries = this.parseEnumEntries();
    this.expectPunct("}");
    return { name, entries };
  }

  // { key: label } 内的条目；key 为数字或标识符，label 为标识符/字符串
  parseEnumEntries(): Record<string, string> {
    const entries: Record<string, string> = {};
    while (!this.isPunct("}")) {
      const kt = this.peek();
      let key: string;
      if (kt.kind === "num") { key = String(kt.num); this.next(); }
      else if (kt.kind === "id") { key = String(parseInt(kt.value, 10)); this.next(); }
      else throw new ParseError(`枚举键需为数字，实际 "${kt.value}"`, this.line);
      this.expectPunct(":");
      const lt = this.peek();
      let label: string;
      if (lt.kind === "str" || lt.kind === "id") { label = lt.value; this.next(); }
      else if (lt.kind === "num") { label = lt.value; this.next(); }
      else throw new ParseError(`枚举标签非法 "${lt.value}"`, this.line);
      entries[key] = label;
      if (this.isPunct(",")) this.next();
    }
    return entries;
  }

  parseStruct(): StructDef {
    this.expectKw("struct");
    const name = this.expectId();
    this.expectPunct("{");
    const fields: Field[] = [];
    while (!this.isPunct("}")) {
      fields.push(this.parseField());
    }
    this.expectPunct("}");
    return { name, fields };
  }

  parseField(): Field {
    const line = this.line;
    const id = this.expectId();
    this.expectPunct(":");
    const type = this.parseTypeExpr();
    const field: Field = { id, type, line };
    // field_attr* 任意顺序
    for (;;) {
      if (this.isPunct("=")) {
        this.next();
        field.fixed = this.parseLiteral();
      } else if (this.isKw("if")) {
        this.next();
        field.cond = this.parseExpr();
      } else if (this.isKw("parse")) {
        this.next();
        // sub_parser：tlv / lwm2m / 标识符
        const t = this.peek();
        if (t.kind === "kw" || t.kind === "id") { field.parse = t.value; this.next(); }
        else throw new ParseError("parse 后需为子解析器名", this.line);
      } else if (this.isKw("fallback")) {
        this.next();
        // fallback_spec = raw
        if (this.peek().value === "raw") { field.fallbackRaw = true; this.next(); }
        else throw new ParseError('fallback 后仅支持 "raw"', this.line);
      } else {
        break;
      }
    }
    return field;
  }

  parseLiteral(): Literal {
    const t = this.peek();
    if (t.kind === "num") { this.next(); return { kind: "num", value: t.num! }; }
    if (t.kind === "str") { this.next(); return { kind: "str", value: t.value }; }
    // 裸 hex 串（如 F1F1F1 或 AA55），作为字节序列
    if (t.kind === "id" && /^[0-9a-fA-F]+$/.test(t.value) && t.value.length % 2 === 0) {
      this.next();
      const bytes: number[] = [];
      for (let k = 0; k < t.value.length; k += 2) bytes.push(parseInt(t.value.substr(k, 2), 16));
      return { kind: "hex", bytes };
    }
    throw new ParseError(`固定值字面量非法 "${t.value}"`, this.line);
  }

  parseTypeExpr(): TypeExpr {
    // bitfield / match / varint / bytes / scalar(+array) / struct 引用
    if (this.isKw("match")) return this.parseMatch();
    const t = this.peek();

    if (t.kind === "id" && t.value === "bitfield") return this.parseBitfield();
    if (t.kind === "id" && t.value === "varint") {
      this.next();
      this.expectPunct("(");
      const nt = this.peek();
      if (nt.kind !== "num") throw new ParseError("varint(N) 需数字", this.line);
      this.next();
      this.expectPunct(")");
      return { kind: "varint", maxBytes: nt.num!, modifiers: this.parseModifiers() };
    }
    if (t.kind === "id" && t.value === "bytes") {
      this.next();
      this.expectPunct("[");
      const length = this.parseLengthExpr();
      this.expectPunct("]");
      return { kind: "bytes", length, modifiers: this.parseModifiers() };
    }
    if (t.kind === "id" && SCALARS.has(t.value)) {
      const base = t.value;
      this.next();
      if (this.isPunct("[")) {
        this.next();
        const count = this.parseLengthExpr();
        this.expectPunct("]");
        return { kind: "array", base, count, modifiers: this.parseModifiers() };
      }
      return { kind: "scalar", base, modifiers: this.parseModifiers() };
    }
    if (t.kind === "id") {
      // struct 引用
      this.next();
      return { kind: "structRef", name: t.value };
    }
    throw new ParseError(`类型表达式非法 "${t.value}"`, this.line);
  }

  parseModifiers(): Modifier[] {
    const mods: Modifier[] = [];
    for (;;) {
      const t = this.peek();
      const v = t.value;
      if (t.kind === "id" && v === "bcd") { mods.push({ kind: "bcd" }); this.next(); }
      else if (t.kind === "id" && v === "ascii") { mods.push({ kind: "ascii" }); this.next(); }
      else if ((t.kind === "kw" || t.kind === "id") && v === "hex") { mods.push({ kind: "hex" }); this.next(); }
      else if (t.kind === "kw" && v === "endian") {
        this.next();
        if (this.isKw("le")) { mods.push({ kind: "endian", endian: "le" }); this.next(); }
        else if (this.isKw("be")) { mods.push({ kind: "endian", endian: "be" }); this.next(); }
        else throw new ParseError("endian 修饰需 le / be", this.line);
      }
      else if ((t.kind === "kw" || t.kind === "id") && v === "enum") {
        this.next(); // 消费 enum
        if (this.isPunct("{")) {
          this.next();
          const inline = this.parseEnumEntries();
          this.expectPunct("}");
          mods.push({ kind: "enum", inline });
        } else {
          mods.push({ kind: "enum", enumName: this.expectId() });
        }
      }
      else break;
    }
    return mods;
  }

  parseBitfield(): TypeExpr {
    this.next(); // bitfield
    this.expectPunct("(");
    const st = this.peek();
    if (st.kind !== "num" || ![8, 16, 32, 64].includes(st.num!)) {
      throw new ParseError("bitfield(N) 的 N 需为 8/16/32/64", this.line);
    }
    const bitSize = st.num! as 8 | 16 | 32 | 64;
    this.next();
    this.expectPunct(")");
    this.expectPunct("{");
    const fields: BitField[] = [];
    while (!this.isPunct("}")) {
      const id = this.expectId();
      this.expectPunct(":");
      const hiT = this.peek();
      if (hiT.kind !== "num") throw new ParseError("位域区间需数字", this.line);
      this.next();
      let hi = hiT.num!, lo = hiT.num!;
      if (this.isPunct(":")) {
        this.next();
        const loT = this.peek();
        if (loT.kind !== "num") throw new ParseError("位域区间需数字", this.line);
        this.next();
        lo = loT.num!;
      }
      if (hi < lo) { const x = hi; hi = lo; lo = x; }
      const bf: BitField = { id, hi, lo };
      // 可选 enum 属性
      if ((this.peek().kind === "kw" || this.peek().kind === "id") && this.peek().value === "enum") {
        this.next();
        if (this.isPunct("{")) {
          this.next();
          bf.inlineEnum = this.parseEnumEntries();
          this.expectPunct("}");
        } else {
          bf.enumName = this.expectId();
        }
      }
      fields.push(bf);
      if (this.isPunct(",")) this.next();
    }
    this.expectPunct("}");
    return { kind: "bitfield", bitSize, fields };
  }

  parseMatch(): TypeExpr {
    this.expectKw("match");
    const tag = this.expectId();
    this.expectPunct("{");
    const cases: MatchCase[] = [];
    while (!this.isPunct("}")) {
      let isDefault = false;
      let literal: Literal | undefined;
      if (this.isKw("_")) { isDefault = true; this.next(); }
      else literal = this.parseLiteral();
      this.expectPunct("=>");
      const body = this.parseTypeExpr();
      cases.push({ isDefault, literal, body });
    }
    this.expectPunct("}");
    return { kind: "match", tag, cases };
  }

  // ---------- 表达式 ----------
  parseLengthExpr(): Expr { return this.parseExpr(); }

  parseExpr(): Expr { return this.parseOr(); }
  parseOr(): Expr {
    let left = this.parseAnd();
    while (this.isKw("or")) { this.next(); left = { kind: "binary", op: "or", left, right: this.parseAnd() }; }
    return left;
  }
  parseAnd(): Expr {
    let left = this.parseNot();
    while (this.isKw("and")) { this.next(); left = { kind: "binary", op: "and", left, right: this.parseNot() }; }
    return left;
  }
  parseNot(): Expr {
    if (this.isKw("not")) { this.next(); return { kind: "unary", op: "not", operand: this.parseCmp() }; }
    return this.parseCmp();
  }
  parseCmp(): Expr {
    let left = this.parseAdd();
    const t = this.peek();
    if (t.kind === "punct" && ["==", "!=", "<", ">", "<=", ">="].includes(t.value)) {
      this.next();
      const right = this.parseAdd();
      left = { kind: "binary", op: t.value as BinOp, left, right };
    }
    return left;
  }
  parseAdd(): Expr {
    let left = this.parseMul();
    while (this.isPunct("+") || this.isPunct("-")) {
      const op = this.next().value as BinOp;
      left = { kind: "binary", op, left, right: this.parseMul() };
    }
    return left;
  }
  parseMul(): Expr {
    let left = this.parsePrimary();
    while (this.isPunct("*") || this.isPunct("/") || this.isPunct("%")) {
      const op = this.next().value as BinOp;
      left = { kind: "binary", op, left, right: this.parsePrimary() };
    }
    return left;
  }
  parsePrimary(): Expr {
    const t = this.peek();
    if (this.isPunct("(")) { this.next(); const e = this.parseExpr(); this.expectPunct(")"); return e; }
    if (this.isPunct("-")) { this.next(); return { kind: "unary", op: "-", operand: this.parsePrimary() }; }
    if (this.isKw("rest")) { this.next(); return { kind: "rest" }; }
    if (t.kind === "num") { this.next(); return { kind: "num", value: t.num! }; }
    if (t.kind === "id") { this.next(); return { kind: "id", name: t.value }; }
    throw new ParseError(`表达式意外符号 "${t.value}"`, this.line);
  }
}

export function parse(src: string): DslFile {
  let toks: Token[];
  try {
    toks = tokenize(src);
  } catch (e) {
    if (e instanceof LexError) throw new ParseError(e.message, e.line);
    throw e;
  }
  const p = new Parser(toks);
  return p.parseFile();
}
