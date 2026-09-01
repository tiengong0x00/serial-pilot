/**
 * AT 命令库类型定义 + 兼容旧格式解析
 *
 * 命令库从 .exe/../commands/*.json 动态加载，不再编译期硬编码。
 * 结构：{ cmd, desc, keywords, templates:[{s,d}] }，无 protocol/type/modes/urc/params。
 */

/** 单条模板：s=纯字符串语法（<>内为占位符），d=描述 */
export interface CmdTemplate {
  /** 语法字符串，如 "AT+CEREG=<n>" 或 URC "+CEREG: <stat>" */
  s: string;
  /** 描述，如 "设置：n=0禁用/1启用" */
  d: string;
}

/** 单条 AT 命令定义 */
export interface AtCommand {
  /** 基础命令名，如 "AT+CEREG" */
  cmd: string;
  /** 简短说明 */
  desc: string;
  /** 关键词（自然语言搜索用） */
  keywords: string[];
  /** 模板列表（含执行/读取/设置/示例/URC 各分支） */
  templates: CmdTemplate[];
}

/** 旧格式命令（V1.0），用于兼容解析 */
interface LegacyAtCommand {
  command: string;
  category?: string;
  description?: string;
  example?: string;
}

/**
 * 将单条命令归一化为扁平结构。
 * 新格式（有 cmd/templates）原样返回并补齐字段；旧格式（有 command）迁移。
 */
export function normalizeCommand(raw: unknown): AtCommand | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  // 新格式
  if (typeof obj.cmd === "string") {
    const templates = Array.isArray(obj.templates)
      ? (obj.templates as unknown[])
          .map((t) => {
            if (!t || typeof t !== "object") return null;
            const to = t as Record<string, unknown>;
            const s = typeof to.s === "string" ? to.s : "";
            if (!s) return null;
            return { s, d: typeof to.d === "string" ? to.d : "" } as CmdTemplate;
          })
          .filter((t): t is CmdTemplate => t !== null)
      : [];
    // 无模板时至少放一条与 cmd 同名的模板，保证补全可用
    if (templates.length === 0) templates.push({ s: obj.cmd, d: typeof obj.desc === "string" ? obj.desc : "" });
    return {
      cmd: obj.cmd,
      desc: typeof obj.desc === "string" ? obj.desc : "",
      keywords: Array.isArray(obj.keywords) ? (obj.keywords as unknown[]).filter((k): k is string => typeof k === "string") : [],
      templates,
    };
  }

  // 旧格式迁移
  if (typeof obj.command === "string") {
    const legacy = obj as unknown as LegacyAtCommand;
    const templates: CmdTemplate[] = [{ s: legacy.command, d: legacy.description ?? "" }];
    if (legacy.example && legacy.example !== legacy.command) {
      templates.push({ s: legacy.example, d: legacy.description ?? "" });
    }
    return {
      cmd: legacy.command,
      desc: legacy.description ?? "",
      keywords: legacy.category ? [legacy.category] : [],
      templates,
    };
  }

  return null;
}
