import { create } from 'zustand';
import type { TestCase, TestCommand } from '@/types/testCase';

/**
 * 剪贴板数据类型
 */
interface ClipboardData {
  type: 'case' | 'command';
  data: TestCase | TestCommand;
  cut: boolean; // 是否为剪切模式（剪切后粘贴时会删除原节点）
  sourceId: string; // 原节点 ID（用于剪切后删除）
  sourceCaseId?: string; // 命令节点的父用例 ID（仅 type='command' 时存在）
}

interface ClipboardStore {
  /** 剪贴板内容 */
  clipboard: ClipboardData | null;

  /** 复制节点到剪贴板 */
  copy: (type: 'case' | 'command', data: TestCase | TestCommand, sourceCaseId?: string) => void;

  /** 剪切节点到剪贴板（标记为待删除） */
  cut: (type: 'case' | 'command', data: TestCase | TestCommand, sourceId: string, sourceCaseId?: string) => void;

  /** 清空剪贴板 */
  clear: () => void;

  /** 检查剪贴板是否有内容 */
  hasContent: () => boolean;
}

export const useClipboardStore = create<ClipboardStore>((set, get) => ({
  clipboard: null,

  copy: (type, data, sourceCaseId) => {
    set({
      clipboard: {
        type,
        data: structuredClone(data), // 深拷贝数据
        cut: false,
        sourceId: data.id,
        sourceCaseId,
      },
    });
  },

  cut: (type, data, sourceId, sourceCaseId) => {
    set({
      clipboard: {
        type,
        data: structuredClone(data), // 深拷贝数据
        cut: true,
        sourceId,
        sourceCaseId,
      },
    });
  },

  clear: () => {
    set({ clipboard: null });
  },

  hasContent: () => {
    return get().clipboard !== null;
  },
}));
