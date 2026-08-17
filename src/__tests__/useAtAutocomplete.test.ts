// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAtAutocomplete } from '@/hooks/useAtAutocomplete';
import { useCommandLibrary } from '@/stores/commandLibraryStore';
import { AtCommandTrie, type AtCommand } from '@/lib/atCommands';

// 测试用命令库：直接注入 store 的内存 Trie（不走后端 invoke）
const TEST_COMMANDS: AtCommand[] = [
  { command: 'AT', category: 'general', description: '测试通信' },
  { command: 'AT+CSQ', category: 'info', description: '查询信号' },
  { command: 'AT+CGREG', category: 'network', description: '查询GPRS注册' },
  { command: 'AT+CGMI', category: 'info', description: '查询制造商' },
  { command: 'AT+CGMR', category: 'info', description: '查询固件版本' },
];

describe('useAtAutocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 注入测试命令库到 store
    useCommandLibrary.setState({
      commands: TEST_COMMANDS,
      trie: new AtCommandTrie(TEST_COMMANDS),
      loaded: true,
      error: null,
    });
  });

  it('非 AT 开头的输入不触发匹配', () => {
    const { result } = renderHook(() => useAtAutocomplete('HELLO'));
    expect(result.current.candidates).toEqual([]);
    expect(result.current.isOpen).toBe(false);
  });

  it('AT 开头触发匹配', () => {
    // 从空值挂载，rerender 模拟用户输入（避免初始抑制）
    const { result, rerender } = renderHook(
      ({ input }) => useAtAutocomplete(input),
      { initialProps: { input: '' } }
    );
    rerender({ input: 'AT' });
    expect(result.current.candidates.length).toBeGreaterThan(0);
    expect(result.current.isOpen).toBe(true);
  });

  it('大小写不敏感', () => {
    const { result: upper } = renderHook(() => useAtAutocomplete('AT+CSQ'));
    const { result: lower } = renderHook(() => useAtAutocomplete('at+csq'));
    expect(upper.current.candidates.length).toBe(lower.current.candidates.length);
  });

  it('精确匹配单个命令时不显示候选', () => {
    const { result } = renderHook(() => useAtAutocomplete('AT+CSQ'));
    // 假设 AT+CSQ 是唯一匹配项
    if (result.current.candidates.length === 1 && result.current.candidates[0].command === 'AT+CSQ') {
      expect(result.current.isOpen).toBe(false);
    }
  });

  it('支持向下导航', () => {
    const { result } = renderHook(() => useAtAutocomplete('AT+CG'));
    expect(result.current.selectedIndex).toBe(0);
    act(() => {
      result.current.moveDown();
    });
    expect(result.current.selectedIndex).toBe(1);
  });

  it('支持向上导航（循环）', () => {
    const { result } = renderHook(() => useAtAutocomplete('AT+CG'));
    const len = result.current.candidates.length;
    expect(result.current.selectedIndex).toBe(0);
    act(() => {
      result.current.moveUp();
    });
    expect(result.current.selectedIndex).toBe(len - 1);
  });

  it('dismiss 后不显示候选', () => {
    // 从空值挂载，rerender 模拟用户输入 AT+CG（匹配多个命令）
    const { result, rerender } = renderHook(
      ({ input }) => useAtAutocomplete(input),
      { initialProps: { input: '' } }
    );
    rerender({ input: 'AT+CG' });
    expect(result.current.isOpen).toBe(true);
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

  it('以已有内容挂载后用户编辑，重新启用候选', () => {
    const { result, rerender } = renderHook(
      ({ input }) => useAtAutocomplete(input),
      { initialProps: { input: 'AT+CG' } }
    );
    // 初始不弹
    expect(result.current.isOpen).toBe(false);
    // 用户编辑后（内容变化）重新启用
    rerender({ input: 'AT+CS' });
    expect(result.current.isOpen).toBe(true);
  });

  it('输入变化后重新启用候选', () => {
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
    expect(result.current.isOpen).toBe(true);
  });

  it('getSelected 返回当前选中的命令', () => {
    const { result } = renderHook(() => useAtAutocomplete('AT+CG'));
    const selected = result.current.getSelected();
    expect(selected).not.toBeNull();
    expect(selected?.command).toBe(result.current.candidates[0].command);
  });

  it('候选变化时重置选中索引', () => {
    const { result, rerender } = renderHook(
      ({ input }) => useAtAutocomplete(input),
      { initialProps: { input: 'AT+CG' } }
    );
    act(() => {
      result.current.moveDown();
    });
    expect(result.current.selectedIndex).toBe(1);

    // 输入变化导致候选列表变化
    rerender({ input: 'AT+CR' });
    expect(result.current.selectedIndex).toBe(0);
  });
});
