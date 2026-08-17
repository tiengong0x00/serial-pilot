/**
 * 命令类型图标组件
 *
 * 统一的图标设计：无背景色，仅通过颜色区分
 * - AT: 灰色文字
 * - URC: 橙色文字
 * - Terminal: 紫色图标
 */

import { Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TextBadgeProps {
  text: string;
  className?: string;
}

/**
 * 文字图标（用于 AT / URC，无背景）
 */
function TextIcon({ text, className }: TextBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center h-3.5 w-6 text-[10px] font-bold',
        className,
      )}
    >
      {text}
    </span>
  );
}

/**
 * AT 命令图标（灰色文字，无背景）
 */
export function AtCommandIcon({ className }: { className?: string }) {
  return <TextIcon text="AT" className={cn('text-gray-600', className)} />;
}

/**
 * URC 图标（橙色文字，无背景）
 */
export function UrcIcon({ className }: { className?: string }) {
  return <TextIcon text="URC" className={cn('text-orange-600', className)} />;
}

/**
 * 脚本图标（紫色 Terminal 图标）
 */
export function ScriptIcon({ className }: { className?: string }) {
  return <Terminal className={cn('h-3.5 w-3.5 text-purple-600', className)} />;
}
