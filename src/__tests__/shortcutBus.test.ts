// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { emitShortcut, onShortcut, SHORTCUT_BINDINGS } from '@/lib/shortcutBus';

describe('shortcutBus 事件总线', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('emit 触发订阅的处理器', () => {
    const handler = vi.fn();
    const unsubscribe = onShortcut('send', handler);

    emitShortcut('send');
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('unsubscribe 后不再触发', () => {
    const handler = vi.fn();
    const unsubscribe = onShortcut('clearLog', handler);

    unsubscribe();
    emitShortcut('clearLog');
    expect(handler).not.toHaveBeenCalled();
  });

  it('不同动作互不干扰', () => {
    const sendHandler = vi.fn();
    const clearHandler = vi.fn();
    const unsub1 = onShortcut('send', sendHandler);
    const unsub2 = onShortcut('clearLog', clearHandler);

    emitShortcut('send');
    expect(sendHandler).toHaveBeenCalledTimes(1);
    expect(clearHandler).not.toHaveBeenCalled();

    unsub1();
    unsub2();
  });

  it('多个订阅者都能收到', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    const unsub1 = onShortcut('toggleFormat', h1);
    const unsub2 = onShortcut('toggleFormat', h2);

    emitShortcut('toggleFormat');
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);

    unsub1();
    unsub2();
  });

  it('绑定表包含所有核心动作', () => {
    const actions = SHORTCUT_BINDINGS.map((b) => b.action);
    expect(actions).toContain('send');
    expect(actions).toContain('clearLog');
    expect(actions).toContain('toggleFormat');
    expect(actions).toContain('refreshPorts');
    expect(actions).toContain('openSettings');
  });

  it('每个绑定都有键位和标签', () => {
    for (const binding of SHORTCUT_BINDINGS) {
      expect(binding.keys).toBeTruthy();
      expect(binding.labelKey).toBeTruthy();
    }
  });
});
