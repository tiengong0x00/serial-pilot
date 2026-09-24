// 协议解析 DSL —— 对外入口。见 docs/protocol-dsl-spec-v1.0.md。
//
// compileDsl(text)      文本 → DslFile（语法+语义校验，出错抛异常）
// parseDsl(text, bytes) 文本 + 字节 → ParseResult（编译失败以 errors 返回）
// flattenNodes(nodes)   展开树为叶子列表（供按 id 查找）

import { parse, ParseError } from "./parser";
import { check, SemanticError } from "./check";
import { interpret } from "./interp";
import { LexError } from "./lexer";
import type { DslFile } from "./ast";
import type { ParsedNode, ParseResult } from "./types";

export type { ParsedNode, ParseResult, Endian } from "./types";
export type { DslFile } from "./ast";

export function compileDsl(text: string): DslFile {
  const file = parse(text);
  check(file);
  return file;
}

export function parseDsl(text: string, bytes: number[] | Uint8Array): ParseResult {
  let file: DslFile;
  try {
    file = compileDsl(text);
  } catch (e: any) {
    const msg = e instanceof ParseError || e instanceof SemanticError ? e.message : (e?.message || String(e));
    const buf = bytes instanceof Uint8Array ? Array.from(bytes) : bytes;
    return { root: [], byteOwner: [], totalBytes: buf.length, bytesConsumed: 0, remaining: buf, errors: [msg] };
  }
  return interpret(file, bytes);
}

// 编辑器实时校验用：只包一层 compileDsl，抓取错误行号与消息，不改动解析逻辑。
export interface ValidateResult {
  ok: boolean;
  line?: number;
  col?: number;
  message?: string;
}

export function validateDsl(text: string): ValidateResult {
  try {
    compileDsl(text);
    return { ok: true };
  } catch (e: any) {
    if (e instanceof LexError) {
      return { ok: false, line: e.line, col: e.col, message: e.message };
    }
    if (e instanceof ParseError) {
      return { ok: false, line: e.line, message: e.message };
    }
    if (e instanceof SemanticError) {
      return { ok: false, message: e.message };
    }
    return { ok: false, message: e?.message || String(e) };
  }
}

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
