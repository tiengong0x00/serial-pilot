import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useTerminalStore, setAutoSaveNotifier } from '@/stores/terminalStore';
import type { TerminalMessage } from '@/types/serial';
import * as logExport from '@/lib/logExport';

// Mock logExport 模块
vi.mock('@/lib/logExport', async () => {
  const actual = await vi.importActual<typeof logExport>('@/lib/logExport');
  return {
    ...actual,
    saveLogToFile: vi.fn().mockResolvedValue('/logs/test.txt'),
  };
});

describe('terminalStore 自动保存逻辑', () => {
  beforeEach(() => {
    // 重置 store 状态
    useTerminalStore.setState({
      messages: [],
      systemLogs: [],
      sequenceCounter: 0,
      maxMessages: 10000,
      maxSystemLogs: 500,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    setAutoSaveNotifier(null);
  });

  it('未超限时正常添加消息', () => {
    const msg: TerminalMessage = {
      id: 'msg1',
      type: 'TX',
      port_label: 'P1',
      data: new Uint8Array([0x41]),
      timestamp: Date.now(),
      text: 'A',
    };

    useTerminalStore.getState().addMessage(msg);

    const state = useTerminalStore.getState();
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].text).toBe('A');
  });

  it('超限时自动保存并清空终端', async () => {
    const store = useTerminalStore.getState();
    const saveLogToFile = vi.mocked(logExport.saveLogToFile);
    const notifier = vi.fn();
    setAutoSaveNotifier(notifier);

    // 设置较小的上限方便测试
    store.setMaxMessages(3);

    // 添加 3 条消息（达到上限）
    for (let i = 0; i < 3; i++) {
      store.addMessage({
        id: `msg${i}`,
        type: 'RX',
        port_label: 'P1',
        data: new Uint8Array([0x30 + i]),
        timestamp: Date.now() + i,
        text: String(i),
      });
    }

    expect(useTerminalStore.getState().messages).toHaveLength(3);

    // 添加第 4 条消息，触发自动保存
    store.addMessage({
      id: 'msg4',
      type: 'TX',
      port_label: 'P1',
      data: new Uint8Array([0x34]),
      timestamp: Date.now() + 10,
      text: '4',
    });

    // 等待异步保存完成
    await vi.waitFor(() => {
      expect(saveLogToFile).toHaveBeenCalledOnce();
    });

    // 验证保存被调用，文件名包含 'auto'
    const [content, filename] = saveLogToFile.mock.calls[0];
    expect(filename).toContain('auto');
    expect(content).toContain('0');
    expect(content).toContain('1');
    expect(content).toContain('2');

    // 终端应被清空，只保留最新消息
    const finalMessages = useTerminalStore.getState().messages;
    expect(finalMessages).toHaveLength(1);
    expect(finalMessages[0].text).toBe('4');

    // 通知回调应被触发
    await vi.waitFor(() => {
      expect(notifier).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });
  });

  it('保存失败时触发错误通知', async () => {
    const store = useTerminalStore.getState();
    const saveLogToFile = vi.mocked(logExport.saveLogToFile);
    const notifier = vi.fn();
    setAutoSaveNotifier(notifier);

    // Mock 保存失败
    saveLogToFile.mockRejectedValueOnce(new Error('写入失败'));

    store.setMaxMessages(1);

    // 添加第一条消息
    store.addMessage({
      id: 'msg1',
      type: 'TX',
      port_label: 'P1',
      data: new Uint8Array([0x41]),
      timestamp: Date.now(),
      text: 'A',
    });

    // 添加第二条消息触发保存
    store.addMessage({
      id: 'msg2',
      type: 'TX',
      port_label: 'P1',
      data: new Uint8Array([0x42]),
      timestamp: Date.now() + 1,
      text: 'B',
    });

    // 等待失败回调
    await vi.waitFor(() => {
      expect(notifier).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, error: expect.any(Error) })
      );
    });

    // 尽管保存失败，终端仍应清空（避免内存溢出）
    expect(useTerminalStore.getState().messages).toHaveLength(1);
  });

  it('未注册通知回调时不影响保存功能', async () => {
    const store = useTerminalStore.getState();
    const saveLogToFile = vi.mocked(logExport.saveLogToFile);

    // 不注册 notifier
    setAutoSaveNotifier(null);

    store.setMaxMessages(2);

    store.addMessage({
      id: 'msg1',
      type: 'TX',
      port_label: 'P1',
      data: new Uint8Array([0x41]),
      timestamp: Date.now(),
      text: 'A',
    });

    store.addMessage({
      id: 'msg2',
      type: 'TX',
      port_label: 'P1',
      data: new Uint8Array([0x42]),
      timestamp: Date.now() + 1,
      text: 'B',
    });

    // 触发保存
    store.addMessage({
      id: 'msg3',
      type: 'TX',
      port_label: 'P1',
      data: new Uint8Array([0x43]),
      timestamp: Date.now() + 2,
      text: 'C',
    });

    await vi.waitFor(() => {
      expect(saveLogToFile).toHaveBeenCalled();
    });

    // 不应崩溃，正常清空
    expect(useTerminalStore.getState().messages).toHaveLength(1);
  });
});

describe('terminalStore 系统日志 FIFO', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      messages: [],
      systemLogs: [],
      sequenceCounter: 0,
      maxMessages: 10000,
      maxSystemLogs: 500,
    });
    vi.clearAllMocks();
  });

  it('SYS 消息路由到 systemLogs，不影响 messages', () => {
    const store = useTerminalStore.getState();

    store.addMessage({
      id: 'sys1',
      type: 'SYS',
      port_label: 'P1',
      data: new Uint8Array(),
      timestamp: Date.now(),
      text: '✅ 测试成功',
    });

    store.addMessage({
      id: 'tx1',
      type: 'TX',
      port_label: 'P1',
      data: new Uint8Array([0x41]),
      timestamp: Date.now(),
      text: 'A',
    });

    const state = useTerminalStore.getState();
    expect(state.systemLogs).toHaveLength(1);
    expect(state.systemLogs[0].text).toBe('✅ 测试成功');
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].text).toBe('A');
  });

  it('systemLogs 超限时删除最早条目（FIFO）', () => {
    const store = useTerminalStore.getState();
    store.setMaxSystemLogs(3);

    // 添加 4 条 SYS 消息
    for (let i = 0; i < 4; i++) {
      store.addMessage({
        id: `sys${i}`,
        type: 'SYS',
        port_label: 'P1',
        data: new Uint8Array(),
        timestamp: Date.now() + i,
        text: `Log ${i}`,
      });
    }

    const logs = useTerminalStore.getState().systemLogs;
    expect(logs).toHaveLength(3);
    // 头插：最新在前，最早的 'Log 0' 被删除
    expect(logs[0].text).toBe('Log 3');
    expect(logs[1].text).toBe('Log 2');
    expect(logs[2].text).toBe('Log 1');
  });

  it('clearSystemLogs 只清空系统日志，不影响通信数据', () => {
    const store = useTerminalStore.getState();

    store.addMessage({
      id: 'sys1',
      type: 'SYS',
      port_label: 'P1',
      data: new Uint8Array(),
      timestamp: Date.now(),
      text: 'System log',
    });

    store.addMessage({
      id: 'tx1',
      type: 'TX',
      port_label: 'P1',
      data: new Uint8Array([0x41]),
      timestamp: Date.now(),
      text: 'A',
    });

    expect(useTerminalStore.getState().systemLogs).toHaveLength(1);
    expect(useTerminalStore.getState().messages).toHaveLength(1);

    store.clearSystemLogs();

    expect(useTerminalStore.getState().systemLogs).toHaveLength(0);
    expect(useTerminalStore.getState().messages).toHaveLength(1);
  });
});
