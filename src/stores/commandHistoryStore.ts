import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * 终端输入行的历史命令记录。
 *
 * 用户在输入行手动发送命令后记录，之后在输入框按 ↑/↓ 方向键调取。
 * hex 与文本模式共用同一套历史，按用户输入的原始字符串存储。
 * 通过 zustand persist 持久化到 localStorage，跨软件重启保留。
 */

const MAX_HISTORY = 200; // 历史条数上限，超出丢弃最老的

interface CommandHistoryStore {
  /** 历史命令，索引 0 为最新（最近一次发送） */
  history: string[];
  /**
   * 记录一条命令。空串/纯空白跳过，与最新一条相同则跳过（连续去重），
   * 超过上限丢弃末尾（最老）。
   */
  push: (command: string) => void;
  /** 清空历史 */
  clear: () => void;
}

export const useCommandHistoryStore = create<CommandHistoryStore>()(
  persist(
    (set) => ({
      history: [],
      push: (command) =>
        set((state) => {
          const cmd = command.trim();
          if (!cmd) return {};
          // 连续去重：与最新一条相同则不重复记录
          if (state.history[0] === cmd) return {};
          const next = [cmd, ...state.history];
          if (next.length > MAX_HISTORY) next.length = MAX_HISTORY;
          return { history: next };
        }),
      clear: () => set({ history: [] }),
    }),
    {
      name: 'serial-pilot-command-history', // localStorage key
      storage: {
        getItem: (name) => {
          try {
            const str = localStorage.getItem(name);
            return str ? JSON.parse(str) : null;
          } catch (err) {
            console.error('Failed to load command history from localStorage:', err);
            localStorage.removeItem(name);
            return null;
          }
        },
        setItem: (name, value) => {
          try {
            localStorage.setItem(name, JSON.stringify(value));
          } catch (err) {
            console.error('Failed to save command history to localStorage:', err);
          }
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
);
