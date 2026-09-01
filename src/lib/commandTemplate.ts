/**
 * 命令模板纯函数工具库（扁平化命令库）
 *
 * 模板 s 是纯字符串：< > 内为占位符，其余（含 , 空格 = " []）全为死文本。
 * 本文件仅含纯函数，便于单测：tokenizer、公共前缀、灰显剩余期望、基础命令解析。
 */

/** 模板词元：死文本 or 占位符 */
export interface TemplateToken {
  type: "literal" | "placeholder";
  /** literal：原文；placeholder：含尖括号，如 "<n>" */
  text: string;
}

/**
 * 将模板字符串拆分为「死文本 / 占位符」交替队列。
 * 例："AT+CEREG=<n>" → [literal "AT+CEREG=", placeholder "<n>"]
 * 未闭合的 < 视为普通死文本（容错）。
 */
export function tokenize(template: string): TemplateToken[] {
  const tokens: TemplateToken[] = [];
  let buffer = "";
  let inPlaceholder = false;

  for (let i = 0; i < template.length; i++) {
    const char = template[i];
    if (char === "<" && !inPlaceholder) {
      if (buffer) tokens.push({ type: "literal", text: buffer });
      buffer = "";
      inPlaceholder = true;
    } else if (char === ">" && inPlaceholder) {
      tokens.push({ type: "placeholder", text: `<${buffer}>` });
      buffer = "";
      inPlaceholder = false;
    } else {
      buffer += char;
    }
  }

  // 收尾：未闭合的占位符降级为死文本（把之前吃掉的 < 补回）
  if (buffer) {
    tokens.push({ type: "literal", text: inPlaceholder ? `<${buffer}` : buffer });
  }
  return tokens;
}

/** 占位符区间（相对整串的字符下标，end 不含） */
export interface PlaceholderRange {
  start: number;
  end: number;
}

/**
 * 在 text 中查找从 fromPos 起的第一个 <...> 占位符区间。
 * 找不到返回 null。用于 Tab 高亮/跳转到下一个占位符。
 */
export function findPlaceholder(text: string, fromPos = 0): PlaceholderRange | null {
  const start = text.indexOf("<", fromPos);
  if (start === -1) return null;
  const end = text.indexOf(">", start + 1);
  if (end === -1) return null;
  return { start, end: end + 1 };
}

/**
 * 计算一组字符串的最长公共前缀（大小写敏感）。
 * 用于 Tab 补全：多个候选补到它们的公共前缀。
 * 空数组返回 ""。
 */
export function longestCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return "";
  if (strings.length === 1) return strings[0];
  let prefix = strings[0];
  for (let i = 1; i < strings.length; i++) {
    const s = strings[i];
    let j = 0;
    while (j < prefix.length && j < s.length && prefix[j] === s[j]) j++;
    prefix = prefix.slice(0, j);
    if (!prefix) break;
  }
  return prefix;
}

/**
 * 前缀通配符匹配：判断 userInput 是否是 template 的「合法前缀」，
 * 并返回光标后应灰显的「剩余期望」。
 *
 * 规则（大小写不敏感比较，但灰显返回模板原文大小写）：
 * - 死文本必须逐字符匹配；占位符匹配任意内容直到下一段死文本出现。
 * - 用户输入正好停在某死文本中间 → 灰显该死文本剩余 + 后续全部。
 * - 用户正在填某占位符（下一段死文本还没出现）→ 灰显该占位符 + 后续全部。
 * - 完全匹配 → 返回 ""。
 * - 输入与模板冲突（死文本对不上）→ 返回 null（该模板不再是候选）。
 */
export function getRemainingHint(userInput: string, template: string): string | null {
  const tokens = tokenize(template);
  const lowerInput = userInput.toLowerCase();
  let pos = 0; // 已消费到 userInput 的下标

  for (let ti = 0; ti < tokens.length; ti++) {
    const token = tokens[ti];

    if (token.type === "literal") {
      const litLower = token.text.toLowerCase();
      const remainInput = lowerInput.slice(pos);

      if (remainInput.length === 0) {
        // 输入已耗尽，正好停在该死文本前 → 灰显该死文本 + 后续
        return token.text + tailText(tokens, ti + 1);
      }
      if (remainInput.length < litLower.length) {
        // 输入停在死文本中间：必须是该死文本的前缀
        if (!litLower.startsWith(remainInput)) return null;
        return token.text.slice(remainInput.length) + tailText(tokens, ti + 1);
      }
      // 输入覆盖了整段死文本：必须完全匹配
      if (!remainInput.startsWith(litLower)) return null;
      pos += token.text.length;
    } else {
      // 占位符：向后看下一段死文本，作为占位符的结束锚点
      const nextLit = tokens[ti + 1]?.type === "literal" ? tokens[ti + 1].text : "";
      if (pos >= lowerInput.length) {
        // 输入耗尽，正在此占位符处 → 灰显占位符 + 后续
        return token.text + tailText(tokens, ti + 1);
      }
      if (!nextLit) {
        // 占位符是最后一段，用户还在填 → 无剩余灰显
        return "";
      }
      const idx = lowerInput.indexOf(nextLit.toLowerCase(), pos);
      if (idx === -1) {
        // 下一段死文本尚未输入，用户仍在填占位符 → 灰显该占位符 + 后续
        // 注意：不返回占位符本身（用户正在填），仅提示后续死文本
        return tailText(tokens, ti + 1);
      }
      pos = idx; // 跳过占位符已填内容，对齐到下一段死文本
    }
  }

  // 所有词元消费完毕
  return pos >= userInput.length ? "" : "";
}

/** 拼接从 startIdx 起所有词元的原文，用于灰显后续期望 */
function tailText(tokens: TemplateToken[], startIdx: number): string {
  let out = "";
  for (let i = startIdx; i < tokens.length; i++) out += tokens[i].text;
  return out;
}

/**
 * 从用户输入解析「基础命令」（去掉参数 / ? / = 部分）。
 * 例："AT+CEREG=2" → "AT+CEREG"；"AT+CGSN?" → "AT+CGSN"；"ATI" → "ATI"。
 * URC 类（不以 AT 开头，如 "+CEREG: 1"）：取冒号/空格前的 token。
 */
export function parseBaseCmd(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  // 截断到第一个 = ? < 空格 之前
  const m = trimmed.match(/^([^=?<\s]+)/);
  const base = m ? m[1] : trimmed;
  // URC 形式 "+CEREG:" 去掉尾部冒号
  return base.replace(/:$/, "");
}

/**
 * 去除模板中的「可选组括号」`[` `]`（3GPP/AT 记法中表示可选参数）。
 *
 * 模板 s 里 `[,<APN>]` 意为「可选：逗号 + APN」。tokenize 把 `[` `]` 当死文本，
 * 会导致用户不打括号时匹配卡住（`getRemainingHint` 无法越过 `[,` 死文本）。
 * 匹配 / 灰显前先剥掉方括号，把可选组摊平成普通逗号分隔串；面板显示仍用原文（保留可选语义）。
 * 例："AT+CGDCONT=<cid>[,<PDP_type>[,<APN>]]" → "AT+CGDCONT=<cid>,<PDP_type>,<APN>"
 */
export function stripOptionalBrackets(template: string): string {
  return template.replace(/[[\]]/g, "");
}

/** 模板类型（用于预填模板说明 d，供用户确认，可留空） */
export type TemplateKind = "urc" | "test" | "read" | "set" | "exec";

/**
 * 根据用户输入推断模板类型（启发式，仅用于给出「建议说明」预填值）。
 * - 不以 AT 开头 → URC/主动上报
 * - 以 =? 结尾 → 测试（查询取值范围）
 * - 以 ? 结尾 → 读取（查询当前值）
 * - 含 = → 设置（写参数）
 * - 其余（如 ATI / AT） → 执行
 */
export function classifyTemplate(input: string): TemplateKind {
  const s = input.trim();
  if (!s) return "exec";
  if (!/^at/i.test(s)) return "urc";
  if (/=\?\s*$/.test(s)) return "test";
  if (/\?\s*$/.test(s)) return "read";
  if (s.includes("=")) return "set";
  return "exec";
}

