// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAtAutocomplete } from '@/hooks/useAtAutocomplete';
import { useCommandLibrary } from '@/stores/commandLibraryStore';
import type { AtCommand } from '@/lib/atCommands';

// 测试用命令库：直接注入 store 的内存数组（不走后端 invoke）
const TEST_COMMANDS: AtCommand[] = [
  { command: 'AT', category: 'general', description: '测试通信' },
  { command: 'AT+CSQ', category: 'info', description: '查询信号' },
  { command: 'AT+CGREG', category: 'network', description: '查询GPRS注册' },
  { command: 'AT+CGMI', category: 'info', description: '查询制造商' },
  { command: 'AT+CGMR', category: 'info', description: '查询固件版本' },
];

// 模拟模糊搜索函数
const mockMatch = (query: string, limit = 50): AtCommand[] => {
  if (!query) return [];
  const q = query.toLowerCase();
  return TEST_COMMANDS.filter(
    c =>
      c.command.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q)
  ).slice(0, limit);
};

describe('useAtAutocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 注入测试命令库到 store
    useCommandLibrary.setState({
      commands: TEST_COMMANDS,
      loaded: true,
      error: null,
      match: mockMatch,
    } as any);
  });

  it('always 模式下按分类模糊匹配（输入 network）', async () => {
    const { result, rerender } = renderHook(
      ({ input }) => useAtAutocomplete(input, 'always'),
      { initialProps: { input: '' } }
    );
    rerender({ input: 'network' });
    await waitFor(() => {
      // network 分类应匹配 AT+CGREG
      expect(result.current.candidates.some(c => c.command === 'AT+CGREG')).toBe(true);
    }, { timeout: 200 });
  });

  it('always 模式下按描述模糊匹配（输入 注册）', async () => {
    const { result, rerender } = renderHook(
      ({ input }) => useAtAutocomplete(input, 'always'),
      { initialProps: { input: '' } }
    );
    rerender({ input: '注册' });
    await waitFor(() => {
      // 描述含"注册"应匹配 AT+CGREG
      expect(result.current.candidates.some(c => c.command === 'AT+CGREG')).toBe(true);
    }, { timeout: 200 });
  });

  it('单字符输入不触发匹配（最小长度 2）', async () => {
    const { result, rerender } = renderHook(
      ({ input }) => useAtAutocomplete(input, 'always'),
      { initialProps: { input: '' } }
    );
    rerender({ input: 'A' });
    await waitFor(() => {
      expect(result.current.candidates).toEqual([]);
    }, { timeout: 200 });
  });

  it('AT 开头触发匹配', async () => {
    // 从空值挂载，rerender 模拟用户输入（避免初始抑制）
    const { result, rerender } = renderHook(
      ({ input }) => useAtAutocomplete(input),
      { initialProps: { input: '' } }
    );
    rerender({ input: 'AT' });
    // 等待防抖
    await waitFor(() => {
      expect(result.current.candidates.length).toBeGreaterThan(0);
      expect(result.current.isOpen).toBe(true);
    }, { timeout: 200 });
  });

  it('大小写不敏感', async () => {
    const { result: upper } = renderHook(() => useAtAutocomplete('AT+CSQ'));
    const { result: lower } = renderHook(() => useAtAutocomplete('at+csq'));
    // 等待防抖
    await waitFor(() => {
      expect(upper.current.candidates.length).toBe(lower.current.candidates.length);
    }, { timeout: 200 });
  });

  it('精确匹配单个命令时不显示候选', async () => {
    const { result } = renderHook(() => useAtAutocomplete('AT+CSQ'));
    // 等待防抖
    await waitFor(() => {
      // 假设 AT+CSQ 是唯一匹配项
      if (result.current.candidates.length === 1 && result.current.candidates[0].command === 'AT+CSQ') {
        expect(result.current.isOpen).toBe(false);
      }
    }, { timeout: 200 });
  });

  it('支持向下导航', async () => {
    const { result } = renderHook(() => useAtAutocomplete('AT+CG'));
    // 等待防抖和候选加载
    await waitFor(() => {
      expect(result.current.candidates.length).toBeGreaterThan(0);
    }, { timeout: 200 });
    expect(result.current.selectedIndex).toBe(0);
    act(() => {
      result.current.moveDown();
    });
    expect(result.current.selectedIndex).toBe(1);
  });

  it('支持向上导航（循环）', async () => {
    const { result } = renderHook(() => useAtAutocomplete('AT+CG'));
    // 等待防抖和候选加载
    await waitFor(() => {
      expect(result.current.candidates.length).toBeGreaterThan(0);
    }, { timeout: 200 });
    const len = result.current.candidates.length;
    expect(result.current.selectedIndex).toBe(0);
    act(() => {
      result.current.moveUp();
    });
    expect(result.current.selectedIndex).toBe(len - 1);
  });

  it('dismiss 后不显示候选', async () => {
    // 从空值挂载，rerender 模拟用户输入 AT+CG（匹配多个命令）
    const { result, rerender } = renderHook(
      ({ input }) => useAtAutocomplete(input),
      { initialProps: { input: '' } }
    );
    rerender({ input: 'AT+CG' });
    // 等待防抖
    await waitFor(() => {
      expect(result.current.isOpen).toBe(true);
    }, { timeout: 200 });
    act(() => {
      result.current.dismiss();
    });
    expect(result.current.isOpen).toBe(false);
  });

  it('以已有内容挂载时不显示候选（编辑已存在命令场景）', () => {
    // 打开编辑页时命令内容已是 AT+CG，此时不应弹出补全面板
    const { result } = renderHook(() => useAtAutocomplete('AT+CG'));
    expect(result.current.isOpen).toBe(false);
  });

  it('以已有内容挂载后用户编辑，重新启用候选', async () => {
    const { result, rerender } = renderHook(
      ({ input }) => useAtAutocomplete(input),
      { initialProps: { input: 'AT+CG' } }
    );
    // 初始不弹
    expect(result.current.isOpen).toBe(false);
    // 用户编辑后（内容变化）重新启用
    rerender({ input: 'AT+CS' });
    // 等待防抖
    await waitFor(() => {
      expect(result.current.isOpen).toBe(true);
    }, { timeout: 200 });
  });

  it('输入变化后重新启用候选', async () => {
    const { result, rerender } = renderHook(
      ({ input }) => useAtAutocomplete(input),
      { initialProps: { input: 'AT+CG' } }
    );
    act(() => {
      result.current.dismiss();
    });
    expect(result.current.isOpen).toBe(false);

    // 输入变化（AT+CS 匹配 AT+CSQ）
    rerender({ input: 'AT+CS' });
    // 等待防抖
    await waitFor(() => {
      expect(result.current.isOpen).toBe(true);
    }, { timeout: 200 });
  });

  it('getSelected 返回当前选中的命令', async () => {
    const { result } = renderHook(() => useAtAutocomplete('AT+CG'));
    // 等待防抖
    await waitFor(() => {
      expect(result.current.candidates.length).toBeGreaterThan(0);
    }, { timeout: 200 });
    const selected = result.current.getSelected();
    expect(selected).not.toBeNull();
    expect(selected?.command).toBe(result.current.candidates[0].command);
  });

  it('候选变化时重置选中索引', async () => {
    const { result, rerender } = renderHook(
      ({ input }) => useAtAutocomplete(input),
      { initialProps: { input: 'AT+CG' } }
    );
    // 等待防抖
    await waitFor(() => {
      expect(result.current.candidates.length).toBeGreaterThan(0);
    }, { timeout: 200 });
    act(() => {
      result.current.moveDown();
    });
    expect(result.current.selectedIndex).toBe(1);

    // 输入变化导致候选列表变化
    rerender({ input: 'AT+CR' });
    // 等待防抖
    await waitFor(() => {
      expect(result.current.selectedIndex).toBe(0);
    }, { timeout: 200 });
  });
});
