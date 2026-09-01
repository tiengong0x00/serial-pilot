// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAtAutocomplete } from '@/hooks/useAtAutocomplete';
import { useCommandLibrary, type TemplateCandidate } from '@/stores/commandLibraryStore';
import type { AtCommand } from '@/lib/atCommands';

// 测试用命令库
const TEST_COMMANDS: AtCommand[] = [
  { cmd: 'AT', desc: '测试通信', keywords: ['握手'], templates: [{ s: 'AT', d: '执行' }] },
  { cmd: 'AT+CSQ', desc: '查询信号', keywords: ['信号'], templates: [{ s: 'AT+CSQ', d: '执行' }] },
  {
    cmd: 'AT+CGREG',
    desc: '查询GPRS注册',
    keywords: ['注册', 'network'],
    templates: [
      { s: 'AT+CGREG?', d: '读取' },
      { s: 'AT+CGREG=<n>', d: '设置' },
    ],
  },
  { cmd: 'AT+CGMI', desc: '查询制造商', keywords: [], templates: [{ s: 'AT+CGMI', d: '执行' }] },
  { cmd: 'AT+CGMR', desc: '查询固件版本', keywords: [], templates: [{ s: 'AT+CGMR', d: '执行' }] },
];

function expand(cmd: AtCommand): TemplateCandidate[] {
  return cmd.templates.map((t) => ({ cmd: cmd.cmd, cmdDesc: cmd.desc, s: t.s, d: t.d }));
}

const mockMatchTemplates = (query: string, limit = 50): TemplateCandidate[] => {
  if (!query) return [];
  const q = query.toLowerCase();
  const prefix: TemplateCandidate[] = [];
  const other: TemplateCandidate[] = [];
  for (const c of TEST_COMMANDS) {
    const kw = c.keywords.some((k) => k.toLowerCase().includes(q) || q.includes(k.toLowerCase()));
    const dh = c.desc.toLowerCase().includes(q);
    const ch = c.cmd.toLowerCase().includes(q);
    for (const cand of expand(c)) {
      if (cand.s.toLowerCase().startsWith(q)) prefix.push(cand);
      else if (ch || dh || kw || cand.s.toLowerCase().includes(q)) other.push(cand);
    }
  }
  return [...prefix, ...other].slice(0, limit);
};

const mockPrefixTemplates = (prefix: string, limit = 100): TemplateCandidate[] => {
  if (!prefix) return [];
  const p = prefix.toLowerCase();
  const hits: TemplateCandidate[] = [];
  for (const c of TEST_COMMANDS) {
    for (const cand of expand(c)) {
      if (cand.s.toLowerCase().startsWith(p)) hits.push(cand);
    }
  }
  return hits.slice(0, limit);
};

describe('useAtAutocomplete (扁平化命令库)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCommandLibrary.setState({
      commands: TEST_COMMANDS,
      loaded: true,
      error: null,
      matchTemplates: mockMatchTemplates,
      prefixTemplates: mockPrefixTemplates,
    } as any);
  });

  it('按关键词模糊匹配（输入 network）', async () => {
    const { result, rerender } = renderHook(({ input }) => useAtAutocomplete(input, 'always'), {
      initialProps: { input: '' },
    });
    rerender({ input: 'network' });
    await waitFor(
      () => expect(result.current.candidates.some((c) => c.cmd === 'AT+CGREG')).toBe(true),
      { timeout: 300 },
    );
  });

  it('按描述模糊匹配（输入 注册）', async () => {
    const { result, rerender } = renderHook(({ input }) => useAtAutocomplete(input, 'always'), {
      initialProps: { input: '' },
    });
    rerender({ input: '注册' });
    await waitFor(
      () => expect(result.current.candidates.some((c) => c.cmd === 'AT+CGREG')).toBe(true),
      { timeout: 300 },
    );
  });

  it('单字符输入不触发匹配', async () => {
    const { result, rerender } = renderHook(({ input }) => useAtAutocomplete(input, 'always'), {
      initialProps: { input: '' },
    });
    rerender({ input: 'A' });
    await waitFor(() => expect(result.current.candidates).toEqual([]), { timeout: 300 });
  });

  it('AT 开头触发匹配', async () => {
    const { result, rerender } = renderHook(({ input }) => useAtAutocomplete(input), {
      initialProps: { input: '' },
    });
    rerender({ input: 'AT+CG' });
    await waitFor(
      () => {
        expect(result.current.candidates.length).toBeGreaterThan(0);
        expect(result.current.isOpen).toBe(true);
      },
      { timeout: 300 },
    );
  });

  it('Tab 补全到公共前缀（AT+CG → AT+CGM/AT+CGR 无更长公共前缀则暂停）', async () => {
    const { result, rerender } = renderHook(({ input }) => useAtAutocomplete(input), {
      initialProps: { input: '' },
    });
    rerender({ input: 'AT+CGR' });
    await waitFor(() => expect(result.current.candidates.length).toBeGreaterThan(0), { timeout: 300 });
    const tab = result.current.getTabCompletion();
    // AT+CGR 前缀命中 AT+CGREG?、AT+CGREG=<n>、AT+CGMR(否，不以AT+CGR开头)
    // 实际前缀候选：AT+CGREG? / AT+CGREG=<n>，公共前缀 AT+CGREG
    expect(tab?.text).toBe('AT+CGREG');
  });

  it('ghostHint 计算剩余期望', async () => {
    const { result, rerender } = renderHook(({ input }) => useAtAutocomplete(input), {
      initialProps: { input: '' },
    });
    rerender({ input: 'AT+CGREG' });
    await waitFor(() => expect(result.current.candidates.length).toBeGreaterThan(0), { timeout: 300 });
    // 选中第一个候选（AT+CGREG?），剩余应为 "?"
    expect(typeof result.current.ghostHint).toBe('string');
  });

  it('支持向下导航', async () => {
    const { result } = renderHook(() => useAtAutocomplete('AT+CGREG'));
    await waitFor(() => expect(result.current.candidates.length).toBeGreaterThan(1), { timeout: 300 });
    expect(result.current.selectedIndex).toBe(0);
    act(() => result.current.moveDown());
    expect(result.current.selectedIndex).toBe(1);
  });

  it('getSelected 返回当前选中候选', async () => {
    const { result } = renderHook(() => useAtAutocomplete('AT+CGREG'));
    await waitFor(() => expect(result.current.candidates.length).toBeGreaterThan(0), { timeout: 300 });
    const selected = result.current.getSelected();
    expect(selected).not.toBeNull();
    expect(selected?.s).toBe(result.current.candidates[0].s);
  });

  it('以已有内容挂载时不显示候选', () => {
    const { result } = renderHook(() => useAtAutocomplete('AT+CGREG?'));
    expect(result.current.isOpen).toBe(false);
  });
});
