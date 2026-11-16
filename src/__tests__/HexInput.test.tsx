// @vitest-environment jsdom
/**
 * HexInput 组件单元测试
 *
 * 测试场景：
 * 1. 自动格式化（每 2 个字符添加空格）
 * 2. 实时校验（非法字符检测）
 * 3. 字节计数
 * 4. UTF-8 预览
 * 5. 粘贴处理
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HexInput } from '@/components/testcase/HexInput';

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'testCase.hexBytes': `${params?.count} bytes`,
        'testCase.hexInvalidChars': 'Invalid chars',
        'testCase.showUtf8': 'Show UTF-8 preview',
        'testCase.hideUtf8': 'Hide UTF-8 preview',
        'testCase.utf8Preview': 'UTF-8 Preview',
      };
      return translations[key] || key;
    },
  }),
}));

describe('HexInput', () => {
  it('renders with placeholder', () => {
    const onChange = vi.fn();
    render(<HexInput value="" onChange={onChange} />);

    const input = screen.getByPlaceholderText('FF 00 1A 2B ...');
    expect(input).toBeInTheDocument();
  });

  it('formats hex string with spaces (每 2 个字符添加空格)', () => {
    const onChange = vi.fn();
    render(<HexInput value="" onChange={onChange} />);

    const input = screen.getByPlaceholderText('FF 00 1A 2B ...') as HTMLInputElement;

    // 输入 "48656c6c6f"
    fireEvent.change(input, { target: { value: '48656c6c6f' } });

    // 应该调用 onChange，并格式化为 "48 65 6C 6C 6F"
    expect(onChange).toHaveBeenCalledWith('48 65 6C 6C 6F');
  });

  it('removes spaces and reformats on input', () => {
    const onChange = vi.fn();
    render(<HexInput value="" onChange={onChange} />);

    const input = screen.getByPlaceholderText('FF 00 1A 2B ...') as HTMLInputElement;

    // 输入已经带空格的字符串
    fireEvent.change(input, { target: { value: '48 65 6c 6c 6f' } });

    // 应该移除空格后重新格式化
    expect(onChange).toHaveBeenCalledWith('48 65 6C 6C 6F');
  });

  it('displays byte count', () => {
    const onChange = vi.fn();
    render(<HexInput value="48 65 6C 6C 6F" onChange={onChange} />);

    // 5 个字节（使用正则匹配，因为文本可能被分割）
    expect(screen.getByText(/5.*bytes/i)).toBeInTheDocument();
  });

  it('detects invalid characters', () => {
    const onChange = vi.fn();
    render(<HexInput value="48 XY 6C" onChange={onChange} />);

    // 应该显示非法字符提示
    expect(screen.getByText(/Invalid chars/)).toBeInTheDocument();
  });

  it('shows UTF-8 preview when valid hex', () => {
    const onChange = vi.fn();
    render(<HexInput value="48 65 6C 6C 6F" onChange={onChange} />);

    // 点击"显示 UTF-8 预览"按钮
    const toggleButton = screen.getByText('Show UTF-8 preview');
    fireEvent.click(toggleButton);

    // 应该显示预览面板，内容为 "Hello"
    expect(screen.getByText('UTF-8 Preview:')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('handles paste event and cleans input', () => {
    const onChange = vi.fn();
    render(<HexInput value="" onChange={onChange} />);

    const input = screen.getByPlaceholderText('FF 00 1A 2B ...') as HTMLInputElement;

    // 模拟粘贴 "48 65 6c\n6c 6f" (带换行和空格)
    const pasteEvent = {
      clipboardData: {
        getData: () => '48 65 6c\n6c 6f',
      },
      preventDefault: vi.fn(),
    };

    fireEvent.paste(input, pasteEvent);

    // 应该清理后格式化为 "48 65 6C 6C 6F"
    expect(onChange).toHaveBeenCalledWith('48 65 6C 6C 6F');
  });

  it('displays incomplete byte message for odd length hex', () => {
    const onChange = vi.fn();
    render(<HexInput value="48 65 6" onChange={onChange} />);

    // 点击"显示 UTF-8 预览"
    const toggleButton = screen.getByText('Show UTF-8 preview');
    fireEvent.click(toggleButton);

    // 应该显示"不完整的字节"
    expect(screen.getByText('(不完整的字节)')).toBeInTheDocument();
  });

  it('converts uppercase automatically', () => {
    const onChange = vi.fn();
    render(<HexInput value="" onChange={onChange} />);

    const input = screen.getByPlaceholderText('FF 00 1A 2B ...') as HTMLInputElement;

    // 输入小写
    fireEvent.change(input, { target: { value: 'abcdef' } });

    // 应该转换为大写
    expect(onChange).toHaveBeenCalledWith('AB CD EF');
  });

  it('handles empty input', () => {
    const onChange = vi.fn();
    render(<HexInput value="" onChange={onChange} />);

    // 0 字节（使用正则匹配）
    expect(screen.getByText(/0.*bytes/i)).toBeInTheDocument();

    // 不应显示 UTF-8 预览按钮（byteCount === 0）
    expect(screen.queryByText('Show UTF-8 preview')).not.toBeInTheDocument();
  });
});
