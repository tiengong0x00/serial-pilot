/**
 * 命令库存储（Zustand）
 *
 * 启动时从 .exe/../commands/*.json 加载全部命令库文件，按文件名排序合并去重，
 * 构建单个内存 Trie 供高速前缀匹配（零 IPC、零磁盘 IO）。
 */

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { AtCommand, AtCommandTrie } from '@/lib/atCommands';

/** 后端返回的命令库文件（对应一个 commands/*.json） */
interface CommandLibFile {
  filename: string;  // 如 at-general.json，用于排序去重
  content: string;   // JSON 字符串
}

/** 命令库文件的 JSON 格式 */
interface CommandLibJson {
  version: string;
  name: string;
  commands: AtCommand[];
}

interface CommandLibraryState {
  /** 合并去重后的全量命令 */
  commands: AtCommand[];
  /** 内存 Trie（查找用） */
  trie: AtCommandTrie | null;
  /** 是否已加载 */
  loaded: boolean;
  /** 加载错误信息 */
  error: string | null;

  /**
   * 从后端加载命令库：invoke → 合并去重 → 建 Trie
   * 仅需调用一次（App 挂载时），后续查找直接用内存 Trie
   */
  load: () => Promise<void>;

  /**
   * 前缀匹配（查内存 Trie）
   * @param prefix 输入前缀
   * @param limit 最大候选数
   * @returns 匹配的命令列表
   */
  match: (prefix: string, limit?: number) => AtCommand[];

  /**
   * 手动刷新（重新从后端加载）
   * 用户修改 commands/ 目录后可调用此方法热更新
   */
  refresh: () => Promise<void>;
}

export const useCommandLibrary = create<CommandLibraryState>((set, get) => ({
  commands: [],
  trie: null,
  loaded: false,
  error: null,

  load: async () => {
    try {
      const libs = await invoke<CommandLibFile[]>('load_command_libraries');

      // 按文件名排序拼接所有命令（靠前文件优先）
      const allCommands: AtCommand[] = [];
      for (const lib of libs) {
        try {
          const parsed = JSON.parse(lib.content) as CommandLibJson;
          allCommands.push(...parsed.commands);
        } catch (e) {
          console.warn(`[Command Library] Failed to parse ${lib.filename}:`, e);
        }
      }

      // 去重：按 command.toUpperCase() 为键，首次出现保留（靠前文件优先）
      const seen = new Map<string, AtCommand>();
      for (const cmd of allCommands) {
        const key = cmd.command.toUpperCase();
        if (!seen.has(key)) {
          seen.set(key, cmd);
        }
      }

      const uniqueCommands = Array.from(seen.values());

      // 构建 Trie
      const trie = new AtCommandTrie(uniqueCommands);

      set({ commands: uniqueCommands, trie, loaded: true, error: null });
      console.log(`[Command Library] Loaded ${uniqueCommands.length} commands from ${libs.length} files`);
    } catch (e) {
      const error = String(e);
      set({ error, loaded: true });
      console.error('[Command Library] Failed to load:', e);
    }
  },

  match: (prefix: string, limit = 8) => {
    const { trie } = get();
    if (!trie) return [];
    return trie.match(prefix, limit);
  },

  refresh: async () => {
    set({ loaded: false, error: null });
    await get().load();
  },
}));
