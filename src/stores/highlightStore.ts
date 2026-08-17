import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { HighlightRule } from '../types/terminal';
import { nanoid } from 'nanoid';

interface HighlightStore {
  rules: HighlightRule[];
  addRule: (rule: Omit<HighlightRule, 'id'>) => void;
  updateRule: (id: string, updates: Partial<HighlightRule>) => void;
  deleteRule: (id: string) => void;
  reorderRules: (fromIndex: number, toIndex: number) => void;
  toggleRule: (id: string) => void;
}

/**
 * 终端高亮规则 Store
 *
 * 规则按顺序匹配，先匹配的优先。支持拖拽排序。
 */
export const useHighlightStore = create<HighlightStore>()(
  persist(
    (set) => ({
      rules: [],

      addRule: (rule) =>
        set((state) => ({
          rules: [...state.rules, { ...rule, id: nanoid() }],
        })),

      updateRule: (id, updates) =>
        set((state) => ({
          rules: state.rules.map((r) => (r.id === id ? { ...r, ...updates } : r)),
        })),

      deleteRule: (id) =>
        set((state) => ({
          rules: state.rules.filter((r) => r.id !== id),
        })),

      reorderRules: (fromIndex, toIndex) =>
        set((state) => {
          const newRules = [...state.rules];
          const [removed] = newRules.splice(fromIndex, 1);
          newRules.splice(toIndex, 0, removed);
          return { rules: newRules };
        }),

      toggleRule: (id) =>
        set((state) => ({
          rules: state.rules.map((r) =>
            r.id === id ? { ...r, enabled: !r.enabled } : r
          ),
        })),
    }),
    {
      name: 'terminal-highlight-rules',
      version: 1,
    }
  )
);
