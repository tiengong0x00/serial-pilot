/**
 * 格式切换按钮组（UTF-8 / HEX）
 *
 * 以标签页形式内联显示在输入框上方，节省垂直空间
 */

import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** 通用分段控制按钮组 */
interface SegmentedControlProps {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  className?: string;
}

export function SegmentedControl({ value, options, onChange, className }: SegmentedControlProps) {
  return (
    <div className={cn("inline-flex rounded-md border border-border overflow-hidden", className)}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={cn(
            "px-2.5 py-1 text-xs font-medium transition-colors",
            value === opt.value
              ? "bg-primary text-primary-foreground"
              : "bg-background hover:bg-secondary text-muted-foreground"
          )}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

interface FormatToggleProps {
  value: 'utf8' | 'hex';
  onChange: (format: 'utf8' | 'hex') => void;
  className?: string;
}

export function FormatToggle({ value, onChange, className }: FormatToggleProps) {
  const { t } = useTranslation();
  return (
    <SegmentedControl
      value={value}
      options={[
        { value: 'utf8', label: t('testCase.dataFormatUtf8') },
        { value: 'hex', label: t('testCase.dataFormatHex') },
      ]}
      onChange={(v) => onChange(v as 'utf8' | 'hex')}
      className={className}
    />
  );
}

