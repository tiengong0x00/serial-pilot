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

  it('自动发送按固定间隔循环发送', async () => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockResolvedValue({ bytes_written: 5, timestamp: Date.now() });

    render(<DataTerminal />);

    const input = screen.getByPlaceholderText('terminal.placeholderEnterToSend');
    fireEvent.change(input, { target: { value: 'LOOP' } });

    // 修改间隔为 500ms
    const intervalInput = screen.getByDisplayValue('1000');
    fireEvent.change(intervalInput, { target: { value: '500' } });

    const autoSendCheckbox = screen.getByLabelText('terminal.autoSend');
    fireEvent.click(autoSendCheckbox);

    // 立即发送一次（由 useEffect 触发）
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledTimes(1);
    }, { timeout: 100 });

    // 前进 500ms，应触发第二次
    await vi.advanceTimersByTimeAsync(500);
    expect(invoke).toHaveBeenCalledTimes(2);

    // 再前进 500ms，应触发第三次
    await vi.advanceTimersByTimeAsync(500);
    expect(invoke).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  it('取消勾选后停止自动发送', async () => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockResolvedValue({ bytes_written: 5, timestamp: Date.now() });

    render(<DataTerminal />);

    const input = screen.getByPlaceholderText('terminal.placeholderEnterToSend');
    fireEvent.change(input, { target: { value: 'STOP' } });

    const autoSendCheckbox = screen.getByLabelText('terminal.autoSend');
    fireEvent.click(autoSendCheckbox);

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledTimes(1);
    }, { timeout: 100 });

    // 取消勾选
    fireEvent.click(autoSendCheckbox);

    // 前进时间，不应再发送
    await vi.advanceTimersByTimeAsync(5000);
    expect(invoke).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('循环期间修改输入框内容，下次发送新内容', async () => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockResolvedValue({ bytes_written: 5, timestamp: Date.now() });

    render(<DataTerminal />);

    const input = screen.getByPlaceholderText('terminal.placeholderEnterToSend');
    fireEvent.change(input, { target: { value: 'OLD' } });

    const intervalInput = screen.getByDisplayValue('1000');
    fireEvent.change(intervalInput, { target: { value: '500' } });

    const autoSendCheckbox = screen.getByLabelText('terminal.autoSend');
    fireEvent.click(autoSendCheckbox);

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledTimes(1);
    }, { timeout: 100 });

    // 修改输入框
    fireEvent.change(input, { target: { value: 'NEW' } });

    // 前进间隔，触发下次发送
    await vi.advanceTimersByTimeAsync(500);

    expect(invoke).toHaveBeenCalledTimes(2);
    // 第二次发送应该是新内容（NEW + CRLF）
    const lastCall = vi.mocked(invoke).mock.calls[1];
    const data = lastCall[1] as { data: number[] };
    const text = String.fromCharCode(...data.data).replace(/\r\n$/, '');
    expect(text).toBe('NEW');

    vi.useRealTimers();
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
