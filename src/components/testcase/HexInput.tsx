/**
 * Hex 输入框
 *
 * 功能：
 * 1. 自动格式化：每 2 个字符添加空格
 * 2. 实时校验：高亮非法字符
 * 3. 字节计数显示
 * 4. UTF-8 预览（可选）
 */

import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';

interface HexInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * 格式化 hex 字符串：自动添加空格分隔
 * 输入: "48656c6c6f"
 * 输出: "48 65 6C 6C 6F"
 */
function formatHex(raw: string): string {
  // 移除所有空格和非十六进制字符（保留用于显示）
  const cleaned = raw.replace(/\s/g, '').toUpperCase();

  // 每 2 个字符添加一个空格
  const formatted: string[] = [];
  for (let i = 0; i < cleaned.length; i += 2) {
    formatted.push(cleaned.slice(i, i + 2));
  }

  return formatted.join(' ');
}

/**
 * 校验 hex 字符串
 * 返回: { valid: boolean; invalidChars: string[] }
 */
function validateHex(hex: string): { valid: boolean; invalidChars: Set<string> } {
  const cleaned = hex.replace(/\s/g, '');
  const validHexRegex = /^[0-9A-Fa-f]*$/;

  if (validHexRegex.test(cleaned)) {
    return { valid: true, invalidChars: new Set() };
  }

  // 找出所有非法字符
  const invalidChars = new Set<string>();
  for (const char of cleaned) {
    if (!/[0-9A-Fa-f]/.test(char)) {
      invalidChars.add(char);
    }
  }

  return { valid: false, invalidChars };
}

/**
 * Hex 转 UTF-8 预览
 */
function hexToUtf8(hex: string): string {
  try {
    const cleaned = hex.replace(/\s/g, '');
    if (cleaned.length === 0) return '';
    if (cleaned.length % 2 !== 0) return '(不完整的字节)';

    const bytes = new Uint8Array(Math.floor(cleaned.length / 2));
    for (let i = 0; i < cleaned.length; i += 2) {
      bytes[i / 2] = parseInt(cleaned.slice(i, i + 2), 16);
    }

    const decoder = new TextDecoder('utf-8', { fatal: false });
    return decoder.decode(bytes);
  } catch {
    return '(无效的 UTF-8)';
  }
}

/**
 * 计算字节数
 */
function getByteCount(hex: string): number {
  const cleaned = hex.replace(/\s/g, '');
  return Math.floor(cleaned.length / 2);
}

export function HexInput({ value, onChange, placeholder, className }: HexInputProps) {
  const { t } = useTranslation();
  const [showUtf8Preview, setShowUtf8Preview] = useState(false);

  // 校验结果
  const validation = useMemo(() => validateHex(value), [value]);

  // 字节数
  const byteCount = useMemo(() => getByteCount(value), [value]);

  // UTF-8 预览
  const utf8Preview = useMemo(() => hexToUtf8(value), [value]);

  // 输入处理：自动格式化
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;

    // 移除非十六进制字符和空格，然后格式化
    const cleaned = raw.replace(/\s/g, '');
    const formatted = formatHex(cleaned);

    onChange(formatted);
  }, [onChange]);

  // 粘贴处理：自动清理和格式化
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text');

    // 移除所有非十六进制字符（包括空格、换行、特殊符号）
    const cleaned = pasted.replace(/[^0-9A-Fa-f]/g, '');
    const formatted = formatHex(cleaned);

    onChange(formatted);
  }, [onChange]);

  // 默认样式
  const baseClassName = className || 'w-full px-3 py-2 border rounded-md bg-background text-sm font-mono';

  // 错误状态样式
  const inputClassName = validation.valid
    ? baseClassName
    : `${baseClassName} border-destructive focus:border-destructive`;

  return (
    <div className="space-y-1.5">
      <input
        type="text"
        value={value}
        onChange={handleChange}
        onPaste={handlePaste}
        placeholder={placeholder || 'FF 00 1A 2B ...'}
        className={inputClassName}
        spellCheck={false}
      />

      {/* 状态栏：字节数 + 错误提示 + UTF-8 预览切换 */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          {/* 字节数 */}
          <span className="text-muted-foreground">
            {byteCount} {t('testCase.hexBytes', { count: byteCount })}
          </span>

          {/* 错误提示 */}
          {!validation.valid && (
            <span className="text-destructive">
              {t('testCase.hexInvalidChars')}: {Array.from(validation.invalidChars).join(', ')}
            </span>
          )}
        </div>

        {/* UTF-8 预览切换 */}
        {validation.valid && byteCount > 0 && (
          <button
            type="button"
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowUtf8Preview(!showUtf8Preview)}
          >
            {showUtf8Preview ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            <span>{showUtf8Preview ? t('testCase.hideUtf8') : t('testCase.showUtf8')}</span>
          </button>
        )}
      </div>

      {/* UTF-8 预览面板 */}
      {showUtf8Preview && validation.valid && byteCount > 0 && (
        <div className="p-2 bg-secondary/30 border border-border rounded text-xs font-mono break-all">
          <div className="text-muted-foreground mb-1">{t('testCase.utf8Preview')}:</div>
          <div>{utf8Preview}</div>
        </div>
      )}
    </div>
  );
}

