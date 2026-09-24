// 协议解析 DSL —— 词法器。见 docs 规范 §2。

export type TokKind =
  | "kw"      // 关键字
  | "id"      // 标识符
  | "num"     // 数字字面量
  | "str"     // 字符串字面量
  | "punct"   // 标点/运算符
  | "eof";

export interface Token {
  kind: TokKind;
  value: string;
  num?: number;      // num 的数值
  line: number;
  col: number;
}

const KEYWORDS = new Set([
  "endian", "root", "struct", "enum", "match", "if", "parse", "fallback",
  "be", "le", "rest", "and", "or", "not", "true", "false", "_",
]);

// 多字符运算符（优先匹配长的）
const OPS2 = ["==", "!=", "<=", ">=", "=>"];
const PUNCT1 = new Set([":", "{", "}", "[", "]", "(", ")", "=", ",", "<", ">", "+", "-", "*", "/", "%"]);

export class LexError extends Error {
  constructor(msg: string, public line: number, public col: number) {
    super(`第 ${line} 行第 ${col} 列: ${msg}`);
  }
}

export function tokenize(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const n = src.length;

  const push = (kind: TokKind, value: string, extra?: Partial<Token>) => {
    toks.push({ kind, value, line, col, ...extra });
  };
  const advance = (k = 1) => {
    for (let x = 0; x < k; x++) {
      if (src[i] === "\n") { line++; col = 1; } else { col++; }
      i++;
    }
  };

  while (i < n) {
    const c = src[i];

    // 空白
    if (c === " " || c === "\t" || c === "\r" || c === "\n") { advance(); continue; }

    // 注释 # 到行尾
    if (c === "#") { while (i < n && src[i] !== "\n") advance(); continue; }

    const startLine = line, startCol = col;

    // 字符串
    if (c === '"') {
      let s = "";
      advance(); // 跳过开引号
      while (i < n && src[i] !== '"') {
        if (src[i] === "\\") {
          advance();
          const e = src[i];
          s += e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : e;
          advance();
        } else {
          s += src[i];
          advance();
        }
      }
      if (i >= n) throw new LexError("字符串未闭合", startLine, startCol);
      advance(); // 跳过闭引号
      toks.push({ kind: "str", value: s, line: startLine, col: startCol });
      continue;
    }

    // 数字：0x.. / 0b.. / 十进制
    if (c >= "0" && c <= "9") {
      let j = i;
      let numStr = "";
      if (src[j] === "0" && (src[j + 1] === "x" || src[j + 1] === "X")) {
        numStr = "0x";
        j += 2;
        while (j < n && /[0-9a-fA-F]/.test(src[j])) { numStr += src[j]; j++; }
      } else if (src[j] === "0" && (src[j + 1] === "b" || src[j + 1] === "B")) {
        numStr = "0b";
        j += 2;
        while (j < n && /[01]/.test(src[j])) { numStr += src[j]; j++; }
      } else {
        while (j < n && /[0-9]/.test(src[j])) { numStr += src[j]; j++; }
      }
      const num = numStr.startsWith("0b")
        ? parseInt(numStr.slice(2), 2)
        : Number(numStr);
      const len = j - i;
      toks.push({ kind: "num", value: numStr, num, line: startLine, col: startCol });
      advance(len);
      continue;
    }

    // 标识符 / 关键字（含 _）
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      let w = "";
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) { w += src[j]; j++; }
      const len = j - i;
      const kind: TokKind = KEYWORDS.has(w) ? "kw" : "id";
      toks.push({ kind, value: w, line: startLine, col: startCol });
      advance(len);
      continue;
    }

    // 双字符运算符
    const two = src.substr(i, 2);
    if (OPS2.includes(two)) {
      toks.push({ kind: "punct", value: two, line: startLine, col: startCol });
      advance(2);
      continue;
    }

    // 单字符标点
    if (PUNCT1.has(c)) {
      toks.push({ kind: "punct", value: c, line: startLine, col: startCol });
      advance();
      continue;
    }

    throw new LexError(`非法字符 "${c}"`, startLine, startCol);
  }

  push("eof", "");
  return toks;
}
