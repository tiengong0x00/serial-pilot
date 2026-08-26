import { create } from 'zustand';
import type { TerminalMessage } from '../types/serial';
import { formatMessagesToText, generateLogFilename, saveLogToFile } from '@/lib/logExport';

/**
 * 自动保存结果通知回调
 *
 * store 作为数据层不直接依赖 i18n/toast（UI 关注点），
 * 由 UI 层注入通知实现，实现解耦。
 */
type AutoSaveNotifier = (result: { success: boolean; path?: string; error?: unknown }) => void;

let autoSaveNotifier: AutoSaveNotifier | null = null;

/** 注册自动保存通知回调（在 UI 层调用） */
export function setAutoSaveNotifier(fn: AutoSaveNotifier | null): void {
  autoSaveNotifier = fn;
}

interface TerminalStore {
  // 通信数据（TX/RX）：满了自动保存到文件并清空
  messages: TerminalMessage[];
  maxMessages: number;
  sequenceCounter: number; // 用于生成单调递增的序列号

  // 系统日志（SYS）：固定条数 FIFO，不自动保存
  systemLogs: TerminalMessage[];
  maxSystemLogs: number;

  // Actions
  addMessage: (message: TerminalMessage) => void;
  clearMessages: () => void;
  clearSystemLogs: () => void;
  setMaxMessages: (max: number) => void;
  setMaxSystemLogs: (max: number) => void;
}

const MAX_MESSAGES_DEFAULT = 10000;
const MAX_SYSTEM_LOGS_DEFAULT = 500;

export const useTerminalStore = create<TerminalStore>((set) => ({
  messages: [],
  maxMessages: MAX_MESSAGES_DEFAULT,
  sequenceCounter: 0,
  systemLogs: [],
  maxSystemLogs: MAX_SYSTEM_LOGS_DEFAULT,

  addMessage: (message) =>
    set((state) => {
      // 系统日志（SYS）：独立数组，固定条数 FIFO，超出删除最老一条，最新的在前
      if (message.type === 'SYS') {
        const nextLogs = [message, ...state.systemLogs];
        if (nextLogs.length > state.maxSystemLogs) {
          nextLogs.splice(state.maxSystemLogs);
        }
        return { systemLogs: nextLogs };
      }

      // 通信数据（TX/RX）：检查是否即将超限（添加新消息后会超过上限）
      if (state.messages.length >= state.maxMessages) {
        // 先保存当前所有消息到文件
        const filename = generateLogFilename('auto');
        const content = formatMessagesToText(state.messages, true);
        saveLogToFile(content, filename)
          .then((path) => {
            autoSaveNotifier?.({ success: true, path });
            console.log(`Terminal log auto-saved to: ${path}`);
          })
          .catch((err) => {
            autoSaveNotifier?.({ success: false, error: err });
            console.error('Failed to auto-save log:', err);
          });

        // 清空终端，重置序列号，然后添加新消息
        return {
          messages: [{
            ...message,
            sequence: 0,
          }],
          sequenceCounter: 1,
        };
      }

      // 未超限，直接追加。
      // 新架构下：TX 乐观渲染立即入列，RX 由监听器按到达顺序入列，
      // 消息的添加顺序即显示顺序，无需再排序。
      const messageWithSeq = {
        ...message,
        sequence: state.sequenceCounter,
      };

      return {
        messages: [...state.messages, messageWithSeq],
        sequenceCounter: state.sequenceCounter + 1,
      };
    }),

  clearMessages: () => set({ messages: [], sequenceCounter: 0 }),

  clearSystemLogs: () => set({ systemLogs: [] }),

  setMaxMessages: (max) => set({ maxMessages: max }),

  setMaxSystemLogs: (max) => set({ maxSystemLogs: max }),
}));
