// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import DataTerminal from '@/components/serial/DataTerminal';
import { useTerminalStore } from '@/stores/terminalStore';
import { useSerialStore } from '@/stores/serialStore';

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh' },
  }),
}));

describe('DataTerminal - 自动发送功能', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTerminalStore.setState({ messages: [] });
    useSerialStore.setState({
      connectionStatus: { p1_connected: true, p2_connected: false },
    });
  });

  it('勾选自动发送后立即发送一次', async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockResolvedValue({ bytes_written: 5, timestamp: Date.now() });

    render(<DataTerminal />);

    const input = screen.getByPlaceholderText('terminal.placeholderEnterToSend');
    await user.type(input, 'TEST');

    const autoSendCheckbox = screen.getByLabelText('terminal.autoSend');
    await user.click(autoSendCheckbox);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        'write_serial_data',
        expect.objectContaining({
          portLabel: 'P1',
        })
      );
    });
  });

  it('自动发送串行循环：发完上一条才等间隔发下一条', async () => {
    // 串行模型：send → 等 invoke 完成 → sleep(间隔) → 再 send。
    // 用真实计时器 + 短间隔验证会持续发出多次（不重叠）。
    vi.mocked(invoke).mockResolvedValue({ bytes_written: 5, timestamp: Date.now() });

    render(<DataTerminal />);

    const input = screen.getByPlaceholderText('terminal.placeholderEnterToSend');
    fireEvent.change(input, { target: { value: 'LOOP' } });

    // 间隔设为 20ms，加快测试
    const intervalInput = screen.getByDisplayValue('1000');
    fireEvent.change(intervalInput, { target: { value: '20' } });

    const autoSendCheckbox = screen.getByLabelText('terminal.autoSend');
    fireEvent.click(autoSendCheckbox);

    // 串行循环应在短时间内累计多次发送
    await waitFor(() => {
      expect(vi.mocked(invoke).mock.calls.length).toBeGreaterThanOrEqual(3);
    }, { timeout: 1000 });

    // 停止，避免泄漏到后续用例
    fireEvent.click(autoSendCheckbox);
  });

  it('取消勾选后停止自动发送', async () => {
    vi.mocked(invoke).mockResolvedValue({ bytes_written: 5, timestamp: Date.now() });

    render(<DataTerminal />);

    const input = screen.getByPlaceholderText('terminal.placeholderEnterToSend');
    fireEvent.change(input, { target: { value: 'STOP' } });

    // 间隔设大（1000ms），确保取消前只发出首次那一条
    const autoSendCheckbox = screen.getByLabelText('terminal.autoSend');
    fireEvent.click(autoSendCheckbox);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledTimes(1);
    }, { timeout: 500 });

    // 立即取消勾选（在 1000ms 间隔内），循环终止
    fireEvent.click(autoSendCheckbox);

    // 等待超过一个间隔，仍应停在 1 次
    await new Promise((r) => setTimeout(r, 300));
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('循环期间修改输入框内容，下次发送新内容', async () => {
    vi.mocked(invoke).mockResolvedValue({ bytes_written: 5, timestamp: Date.now() });

    render(<DataTerminal />);

    const input = screen.getByPlaceholderText('terminal.placeholderEnterToSend');
    fireEvent.change(input, { target: { value: 'OLD' } });

    const intervalInput = screen.getByDisplayValue('1000');
    fireEvent.change(intervalInput, { target: { value: '20' } });

    const autoSendCheckbox = screen.getByLabelText('terminal.autoSend');
    fireEvent.click(autoSendCheckbox);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledTimes(1);
    }, { timeout: 500 });

    // 修改输入框内容
    fireEvent.change(input, { target: { value: 'NEW' } });

    // 等待后续迭代发出 NEW 内容
    await waitFor(() => {
      const calls = vi.mocked(invoke).mock.calls;
      const hasNew = calls.some((c) => {
        const arg = c[1] as { data?: number[] } | undefined;
        if (!arg?.data) return false;
        const text = String.fromCharCode(...arg.data).replace(/\r\n$/, '');
        return text === 'NEW';
      });
      expect(hasNew).toBe(true);
    }, { timeout: 1000 });

    // 停止循环
    fireEvent.click(autoSendCheckbox);
  });

  it('未连接时禁用自动发送开关', () => {
    useSerialStore.setState({
      connectionStatus: { p1_connected: false, p2_connected: false },
    });

    render(<DataTerminal />);

    const autoSendCheckbox = screen.getByLabelText('terminal.autoSend');
    expect(autoSendCheckbox).toBeDisabled();
  });

  it('间隔输入框只接受纯数字', () => {
    render(<DataTerminal />);

    const intervalInput = screen.getByDisplayValue('1000') as HTMLInputElement;

    // 纯数字应正常更新
    fireEvent.change(intervalInput, { target: { value: '100' } });
    expect(intervalInput.value).toBe('100');

    fireEvent.change(intervalInput, { target: { value: '60000' } });
    expect(intervalInput.value).toBe('60000');

    // 非数字字符，onChange 拒绝更新，保持上一个有效值 60000
    fireEvent.change(intervalInput, { target: { value: 'abc' } });
    expect(intervalInput.value).toBe('60000');

    // 小数点，onChange 拒绝更新
    fireEvent.change(intervalInput, { target: { value: '123.45' } });
    expect(intervalInput.value).toBe('60000');
  });
});
