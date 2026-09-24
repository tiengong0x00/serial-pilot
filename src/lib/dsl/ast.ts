// 协议解析 DSL —— 抽象语法树定义（parser 产出，interpreter 消费）。
// 语法见 docs/protocol-dsl-spec-v1.0.md。

import type { Endian } from "./types";

// ---------- 表达式（length_expr / expr 合一） ----------
export type Expr =
  | { kind: "num"; value: number }
  | { kind: "id"; name: string }
  | { kind: "rest" }
  | { kind: "unary"; op: "-" | "not"; operand: Expr }
  | { kind: "binary"; op: BinOp; left: Expr; right: Expr };

export type BinOp =
  | "+" | "-" | "*" | "/" | "%"
  | "==" | "!=" | "<" | ">" | "<=" | ">="
  | "and" | "or";

// ---------- 字面量（固定值校验用） ----------
export type Literal =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "hex"; bytes: number[] }; // 裸 hex 串（如 F1F1F1）

// ---------- 枚举 ----------
export interface EnumDef {
  name: string;
  entries: Record<string, string>; // 值(十进制字符串) -> 标签
}

// ---------- 修饰符 ----------
export type Modifier =
  | { kind: "bcd" }
  | { kind: "ascii" }
  | { kind: "hex" }
  | { kind: "endian"; endian: Endian }
  | { kind: "enum"; enumName?: string; inline?: Record<string, string> };

// ---------- 类型表达式 ----------
export type TypeExpr =
  | ScalarType
  | BytesType
  | ArrayType
  | VarintType
  | BitfieldType
  | MatchType
  | StructRefType;

export interface ScalarType {
  kind: "scalar";
  base: string;          // u8 u16 ... f32 f64
  modifiers: Modifier[];
}
export interface BytesType {
  kind: "bytes";
  length: Expr;
  modifiers: Modifier[];
}
export interface ArrayType {
  kind: "array";
  base: string;          // 元素标量类型
  count: Expr;           // 元素个数
  modifiers: Modifier[];
}
export interface VarintType {
  kind: "varint";
  maxBytes: number;
  modifiers: Modifier[];
}
export interface BitField {
  id: string;
  hi: number;            // 高位（含）
  lo: number;            // 低位（含）；单 bit 时 hi==lo
  enumName?: string;
  inlineEnum?: Record<string, string>;
}
export interface BitfieldType {
  kind: "bitfield";
  bitSize: 8 | 16 | 32 | 64;
  fields: BitField[];
}
export interface MatchCase {
  isDefault: boolean;
  literal?: Literal;
  body: TypeExpr;
}
export interface MatchType {
  kind: "match";
  tag: string;           // 前面已声明的整数字段名
  cases: MatchCase[];
}
export interface StructRefType {
  kind: "structRef";
  name: string;
}

// ---------- 字段 ----------
export interface Field {
  id: string;
  type: TypeExpr;
  fixed?: Literal;              // = literal
  cond?: Expr;                  // if expr
  parse?: string;              // parse <sub_parser>
  fallbackRaw?: boolean;        // fallback raw
  line: number;
}

// ---------- 结构体 ----------
export interface StructDef {
  name: string;
  fields: Field[];
}

// ---------- 文件 ----------
export interface DslFile {
  endian: Endian;
  root: string;
  enums: Record<string, EnumDef>;
  structs: Record<string, StructDef>;
}
