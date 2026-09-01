/**
 * 命令库存储（Zustand）
 *
 * 启动时从 .exe/../commands/*.json 加载全部命令库文件，按文件名排序合并去重，
 * 缓存到内存。补全以「模板（template）」为候选单位：
 * 同时匹配 cmd / desc / keywords / templates[].s，返回展开的模板候选。
 */

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { AtCommand, normalizeCommand } from '@/lib/atCommands';
import { getRemainingHint, stripOptionalBrackets } from '@/lib/commandTemplate';

/** 后端返回的命令库文件（对应一个 commands/*.json） */
interface CommandLibFile {
  filename: string;
  content: string;
}

/** 命令库文件的 JSON 格式（version 字段可选，兼容旧的 1.0） */
interface CommandLibJson {
  version?: string;
  name?: string;
  commands: unknown[];
}

/** 模板候选：一条 template 展开，携带所属命令信息，供补全面板逐行展示 */
export interface TemplateCandidate {
  /** 所属基础命令，如 "AT+CEREG" */
  cmd: string;
  /** 命令描述 */
  cmdDesc: string;
  /** 模板语法字符串，如 "AT+CEREG=<n>" */
  s: string;
  /** 模板描述 */
  d: string;
}

interface CommandLibraryState {
  /** 合并去重后的全量命令 */
  commands: AtCommand[];
  loaded: boolean;
  error: string | null;

  /** 从后端加载命令库：invoke → 归一化 → 合并去重 → 缓存 */
  load: () => Promise<void>;

  /**
   * 模糊搜索匹配（功能1）：同时匹配 cmd/desc/keywords/templates[].s。
   * 返回展开的模板候选，前缀命中的排在前面。
   */
  matchTemplates: (query: string, limit?: number) => TemplateCandidate[];

  /**
   * 前缀匹配（功能2 Tab 补全用）：返回 s 以 prefix 开头的模板候选。
   * 大小写不敏感。用于计算公共前缀与歧义判断。
   */
  prefixTemplates: (prefix: string, limit?: number) => TemplateCandidate[];

  /** 按基础命令名（大小写不敏感）查找命令，供 Ctrl+S 智能分拣用 */
  findByCmd: (cmd: string) => AtCommand | undefined;

  /** 手动刷新（热更新） */
  refresh: () => Promise<void>;
}

/** 把一条命令展开为模板候选数组 */
function expand(cmd: AtCommand): TemplateCandidate[] {
  return cmd.templates.map((t) => ({ cmd: cmd.cmd, cmdDesc: cmd.desc, s: t.s, d: t.d }));
}

export const useCommandLibrary = create<CommandLibraryState>((set, get) => ({
  commands: [],
  loaded: false,
  error: null,

  load: async () => {
    try {
      const libs = await invoke<CommandLibFile[]>('load_command_libraries');

      // 按文件名排序拼接（靠前文件优先），逐条归一化为扁平结构
      const all: AtCommand[] = [];
      for (const lib of libs) {
        try {
          const parsed = JSON.parse(lib.content) as CommandLibJson;
          for (const raw of parsed.commands ?? []) {
            const norm = normalizeCommand(raw);
            if (norm) all.push(norm);
          }
        } catch (e) {
          console.warn(`[Command Library] Failed to parse ${lib.filename}:`, e);
        }
      }

      // 去重合并：同 cmd（大写）为键，首个保留，后续文件的 templates 去重追加
      const seen = new Map<string, AtCommand>();
      for (const cmd of all) {
        const key = cmd.cmd.toUpperCase();
        const existing = seen.get(key);
        if (!existing) {
          seen.set(key, { ...cmd, templates: [...cmd.templates] });
        } else {
          for (const t of cmd.templates) {
            if (!existing.templates.some((et) => et.s === t.s)) existing.templates.push(t);
          }
          // 补齐关键词
          for (const k of cmd.keywords) {
            if (!existing.keywords.includes(k)) existing.keywords.push(k);
          }
        }
      }

      const unique = Array.from(seen.values());
      set({ commands: unique, loaded: true, error: null });
    } catch (e) {
      const error = String(e);
      set({ error, loaded: true });
      console.error('[Command Library] Failed to load:', e);
    }
  },

  matchTemplates: (query, limit = 50) => {
    const { commands } = get();
    if (!query || commands.length === 0) return [];
    const raw = query.trim();
    const q = raw.toLowerCase();

    // 第一层：占位符感知的「合法延续」。
    // 用 getRemainingHint 判定当前输入是否为该模板的合法前缀（占位符可匹配任意值）。
    // 命中即说明用户正在输入该模板 —— 只显示这一层，杜绝无关命令噪声。
    const compatible: { cand: TemplateCandidate; exact: boolean; len: number }[] = [];
    for (const cmd of commands) {
      for (const t of cmd.templates) {
        const cand: TemplateCandidate = { cmd: cmd.cmd, cmdDesc: cmd.desc, s: t.s, d: t.d };
        // 匹配用「去可选括号」版本（把 [,<x>] 摊平），面板仍显示原文 t.s
        const flat = stripOptionalBrackets(t.s);
        const flatLower = flat.toLowerCase();
        const exactPrefix = flatLower.startsWith(q);
        // 字面前缀命中，或占位符通配匹配成功（getRemainingHint 非 null）
        const compat = exactPrefix || getRemainingHint(raw, flat) !== null;
        if (compat) compatible.push({ cand, exact: exactPrefix, len: flat.length });
      }
    }
    if (compatible.length > 0) {
      // 字面前缀命中优先，其次按模板长度升序（短的更接近当前输入进度）
      compatible.sort((a, b) => (a.exact === b.exact ? a.len - b.len : a.exact ? -1 : 1));
      return compatible.slice(0, limit).map((x) => x.cand);
    }

    // 第二层：模糊搜索（关键词发现）。仅当第一层无「正在输入的命令」时启用。
    // 只做正向包含（字段含 query），不做反向，避免短关键词误伤。
    const fuzzy: TemplateCandidate[] = [];
    for (const cmd of commands) {
      const cmdHit = cmd.cmd.toLowerCase().includes(q);
      const descHit = cmd.desc.toLowerCase().includes(q);
      const kwHit = cmd.keywords.some((k) => k.toLowerCase().includes(q));
      if (!cmdHit && !descHit && !kwHit) continue;
      for (const t of cmd.templates) {
        fuzzy.push({ cmd: cmd.cmd, cmdDesc: cmd.desc, s: t.s, d: t.d });
      }
    }
    return fuzzy.slice(0, limit);
  },

  prefixTemplates: (prefix, limit = 100) => {
    const { commands } = get();
    if (!prefix || commands.length === 0) return [];
    const p = prefix.toLowerCase();
    const hits: TemplateCandidate[] = [];
    for (const cmd of commands) {
      for (const t of cmd.templates) {
        if (t.s.toLowerCase().startsWith(p)) {
          hits.push({ cmd: cmd.cmd, cmdDesc: cmd.desc, s: t.s, d: t.d });
          if (hits.length >= limit) return hits;
        }
      }
    }
    return hits;
  },

  findByCmd: (cmd) => {
    const target = cmd.toUpperCase();
    return get().commands.find((c) => c.cmd.toUpperCase() === target);
  },

  refresh: async () => {
    set({ loaded: false, error: null });
    await get().load();
  },
}));

// 保留 expand 供潜在外部使用（tree-shake 友好）
export { expand as expandCommandTemplates };

