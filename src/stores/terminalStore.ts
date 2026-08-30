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
  maxBytes: number; // 累计字节数上限
  totalBytes: number; // 当前累计字节数
  sequenceCounter: number; // 用于生成单调递增的序列号

  // 系统日志（SYS）：固定条数 FIFO，不自动保存
  systemLogs: TerminalMessage[];
  maxSystemLogs: number;

  // Actions
  addMessage: (message: TerminalMessage) => void;
  /**
   * RX 融合模式：把一帧的增量字节拼到同一条消息。
   * 若 (port_label, frameId) 已存在对应 RX 消息则追加其 data 尾部并更新 text/isFinal，
   * 否则新建一条。decode 由调用方对"整条累积数据"重做，保证多字节 UTF-8 跨增量正确。
   */
  appendFrame: (args: {
    portLabel: TerminalMessage['port_label'];
    frameId: number;
    timestamp: number;
    chunk: Uint8Array;
    isFinal: boolean;
    decode: (full: Uint8Array) => string | undefined;
  }) => void;
  clearMessages: () => void;
  clearSystemLogs: () => void;
  setMaxBytes: (max: number) => void;
  setMaxSystemLogs: (max: number) => void;
}

const MAX_BYTES_DEFAULT = 1 * 1024 * 1024; // 1MB
const MAX_SYSTEM_LOGS_DEFAULT = 500;

export const useTerminalStore = create<TerminalStore>((set) => ({
  messages: [],
  maxBytes: MAX_BYTES_DEFAULT,
  totalBytes: 0,
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

      // 通信数据（TX/RX）：检查添加新消息后是否超过字节限制
      const newMsgBytes = message.data.length;
      const wouldExceed = state.totalBytes + newMsgBytes > state.maxBytes;

      if (wouldExceed) {
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

        // 清空终端，重置序列号和字节数，然后添加新消息
        return {
          messages: [{
            ...message,
            sequence: 0,
          }],
          totalBytes: newMsgBytes,
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
        totalBytes: state.totalBytes + newMsgBytes,
        sequenceCounter: state.sequenceCounter + 1,
      };
    }),

  appendFrame: ({ portLabel, frameId, timestamp, chunk, isFinal, decode }) =>
    set((state) => {
      // 从尾部找同 (port, frameId) 且尚未闭合的 RX 消息（帧进行中才追加）
      const idx = (() => {
        for (let i = state.messages.length - 1; i >= 0; i--) {
          const m = state.messages[i];
          if (m.type === 'RX' && m.port_label === portLabel && m.frameId === frameId) {
            return i;
          }
          // 越过更早的帧无需继续找（frameId 单调递增）
          if (m.type === 'RX' && m.frameId !== undefined && m.frameId < frameId) break;
        }
        return -1;
      })();

      // 已存在：就地追加增量到该消息 data 尾部，重算 text（整条重解码）
      if (idx >= 0) {
        const prev = state.messages[idx];
        const merged = new Uint8Array(prev.data.length + chunk.length);
        merged.set(prev.data, 0);
        merged.set(chunk, prev.data.length);
        const updated: TerminalMessage = {
          ...prev,
          data: merged,
          text: decode(merged),
          isFinal,
        };
        const nextMessages = state.messages.slice();
        nextMessages[idx] = updated;
        return {
          messages: nextMessages,
          totalBytes: state.totalBytes + chunk.length, // 追加字节数
        };
      }

      // 不存在：新建一条 RX 消息（复用 addMessage 的超限/序列号语义）
      const newMsg: TerminalMessage = {
        id: `${timestamp}-${frameId}-${Math.random().toString(36).substr(2, 6)}`,
        type: 'RX',
        port_label: portLabel,
        data: chunk,
        timestamp,
        text: decode(chunk),
        frameId,
        isFinal,
      };

      // 超限：先落盘再清空（与 addMessage 一致）
      const newMsgBytes = chunk.length;
      const wouldExceed = state.totalBytes + newMsgBytes > state.maxBytes;
      if (wouldExceed) {
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
        return {
          messages: [{ ...newMsg, sequence: 0 }],
          totalBytes: newMsgBytes,
          sequenceCounter: 1,
        };
      }

      return {
        messages: [...state.messages, { ...newMsg, sequence: state.sequenceCounter }],
        totalBytes: state.totalBytes + newMsgBytes,
        sequenceCounter: state.sequenceCounter + 1,
      };
    }),

  clearMessages: () => set({ messages: [], totalBytes: 0, sequenceCounter: 0 }),

  clearSystemLogs: () => set({ systemLogs: [] }),

  setMaxBytes: (max) => set({ maxBytes: max }),

  setMaxSystemLogs: (max) => set({ maxSystemLogs: max }),
}));
