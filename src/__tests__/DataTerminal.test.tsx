// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import DataTerminal from '@/components/serial/DataTerminal';
import { useTerminalStore } from '@/stores/terminalStore';
import { useSerialStore } from '@/stores/serialStore';

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'terminal.emptyInput': '输入不能为空',
        'terminal.notConnected': '未连接',
        'terminal.targetNotConnected': '目标端口未连接',
        'terminal.formatText': '文本',
        'terminal.formatHex': 'HEX',
        'terminal.clear': '清空',
        'terminal.lineFeed': '换行符',
        'terminal.sendTarget': '发送到',
        'terminal.modeMerged': '合并显示',
        'terminal.modeSplit': '左右分栏',
        'terminal.lfNone': '无',
        'terminal.lfLF': 'LF',
        'terminal.lfCR': 'CR',
        'terminal.lfCRLF': 'CRLF',
        'terminal.placeholder': '输入命令',
        'terminal.send': '发送',
      };
      return translations[key] || key;
    },
  }),
}));

describe('DataTerminal 组件测试', () => {
  beforeEach(() => {
    // 重置 stores
    useTerminalStore.getState().clearMessages();
    useSerialStore.setState({
      connectionStatus: { p1_connected: false, p2_connected: false },
    });
    vi.clearAllMocks();
  });

  it('应渲染基本 UI 元素', () => {
    render(<DataTerminal />);

    expect(screen.getByPlaceholderText('terminal.placeholderEnterToSend')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /发送/ })).toBeInTheDocument();
    expect(screen.getByText('文本')).toBeInTheDocument();
    expect(screen.getByText('HEX')).toBeInTheDocument();
  });

  it('未连接时发送按钮应禁用', () => {
    render(<DataTerminal />);

    const sendBtn = screen.getByRole('button', { name: /发送/ });
    expect(sendBtn).toBeDisabled();
  });

  it('连接后输入内容时发送按钮应启用', async () => {
    const user = userEvent.setup();

    useSerialStore.setState({
      connectionStatus: { p1_connected: true, p2_connected: false },
    });

    render(<DataTerminal />);

    const sendBtn = screen.getByRole('button', { name: /发送/ });
    const input = screen.getByPlaceholderText('terminal.placeholderEnterToSend');

    // 空输入时按钮禁用
    expect(sendBtn).toBeDisabled();

    // 输入内容后按钮启用
    await user.type(input, 'AT');
    expect(sendBtn).toBeEnabled();
  });

  it('应模拟用户输入并发送命令', async () => {
    const user = userEvent.setup();

    // 模拟 P1 已连接
    useSerialStore.setState({
      connectionStatus: { p1_connected: true, p2_connected: false },
    });

    // Mock invoke 成功，返回符合契约的结果对象
    vi.mocked(invoke).mockResolvedValueOnce({ bytes_written: 6, timestamp: Date.now() });

    render(<DataTerminal />);

    const input = screen.getByPlaceholderText('terminal.placeholderEnterToSend');
    const sendBtn = screen.getByRole('button', { name: /发送/ });

    // 用户输入
    await user.type(input, 'AT+CSQ');
    expect(input).toHaveValue('AT+CSQ');

    // 点击发送
    await user.click(sendBtn);

    // 验证调用了 write_serial_data
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('write_serial_data', expect.objectContaining({
        portLabel: 'P1',
      }));
    });

    // 验证消息被添加到 store
    // TX 的 text 存实际发送内容（含行尾符，默认 CRLF），与真实发送一致，
    // 使显示中 TX 与 RX 之间有换行分隔
    await waitFor(() => {
      const messages = useTerminalStore.getState().messages;
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('TX');
      expect(messages[0].text).toBe('AT+CSQ\r\n');
    });
  });

  it('应在输入为空时禁用发送按钮', () => {
    useSerialStore.setState({
      connectionStatus: { p1_connected: true, p2_connected: false },
    });

    render(<DataTerminal />);

    const sendBtn = screen.getByRole('button', { name: /发送/ });
    expect(sendBtn).toBeDisabled();
  });

  it('应支持 Enter 键发送', async () => {
    const user = userEvent.setup();

    useSerialStore.setState({
      connectionStatus: { p1_connected: true, p2_connected: false },
    });

    vi.mocked(invoke).mockResolvedValueOnce({ bytes_written: 5, timestamp: Date.now() });

    render(<DataTerminal />);

    const input = screen.getByPlaceholderText('terminal.placeholderEnterToSend');
    // 使用非 AT 开头的命令，避免触发自动完成
    await user.type(input, 'HELLO{Enter}');

    await waitFor(() => {
      expect(invoke).toHaveBeenCalled();
    });
  });

  it('应切换显示格式（文本/HEX）', async () => {
    const user = userEvent.setup();

    // 添加测试消息
    useTerminalStore.getState().addMessage({
      id: 'test-1',
      type: 'RX',
      port_label: 'P1',
      data: new Uint8Array([0x41, 0x54]),
      timestamp: Date.now(),
      text: 'AT',
    });

    render(<DataTerminal />);

    // 默认文本模式
    expect(screen.getByText(/AT/)).toBeInTheDocument();

    // 切换到 HEX
    const hexBtn = screen.getByText('HEX');
    await user.click(hexBtn);

    // 应显示 HEX 格式
    expect(screen.getByText(/41 54/)).toBeInTheDocument();
  });

  it('应统计 TX/RX 字节数', () => {
    useTerminalStore.getState().addMessage({
      id: '1',
      type: 'TX',
      port_label: 'P1',
      data: new Uint8Array([0x41, 0x54]),
      timestamp: Date.now(),
    });

    useTerminalStore.getState().addMessage({
      id: '2',
      type: 'RX',
      port_label: 'P1',
      data: new Uint8Array([0x4f, 0x4b]),
      timestamp: Date.now(),
    });

    render(<DataTerminal />);

    expect(screen.getByText(/TX 2/)).toBeInTheDocument();
    expect(screen.getByText(/RX 2/)).toBeInTheDocument();
  });

  it('应清空消息', async () => {
    const user = userEvent.setup();

    useTerminalStore.getState().addMessage({
      id: '1',
      type: 'TX',
      port_label: 'P1',
      data: new Uint8Array([0x41]),
      timestamp: Date.now(),
    });

    render(<DataTerminal />);

    expect(useTerminalStore.getState().messages).toHaveLength(1);

    const clearBtn = screen.getByTitle('清空');
    await user.click(clearBtn);

    expect(useTerminalStore.getState().messages).toHaveLength(0);
  });
});
