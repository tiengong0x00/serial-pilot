/**
 * AT 命令自动完成候选面板（共享组件）
 *
 * 从 DataTerminal 内联面板抽出，供 DataTerminal、CommandEditor 复用。
 * 候选列表、选中索引由 useAtAutocomplete hook 管理，面板只负责渲染与交互。
 */

import { useTranslation } from "react-i18next";
import type { AtCommand } from "@/lib/atCommands";

interface AtAutocompletePanelProps {
  /** 候选命令列表 */
  candidates: AtCommand[];
  /** 当前选中索引 */
  selectedIndex: number;
  /** 点击或回车选中候选时触发 */
  onSelect: () => void;
  /** 鼠标悬停改变选中项 */
  onHover: (index: number) => void;
  /** 面板是否可见（由 useAtAutocomplete.isOpen 控制） */
  visible: boolean;
  /** 可选：自定义底部提示文本，默认使用 i18n autocomplete.hint */
  hintText?: string;
}

export function AtAutocompletePanel({
  candidates,
  selectedIndex,
  onSelect,
  onHover,
  visible,
  hintText,
}: AtAutocompletePanelProps) {
  const { t } = useTranslation();
  if (!visible) return null;

  return (
    <div className="absolute bottom-full left-0 mb-1 w-full max-w-md bg-popover border border-border rounded-md shadow-lg overflow-hidden z-50">
      <div className="max-h-64 overflow-y-auto custom-scrollbar">
        {candidates.map((cmd, idx) => (
          <button
            key={cmd.command}
            type="button"
            className={`w-full text-left px-3 py-2 text-sm border-b border-border/50 last:border-b-0 transition-colors ${
              idx === selectedIndex
                ? "bg-primary/10 text-primary font-medium"
                : "hover:bg-secondary/50"
            }`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onHover(idx);
              onSelect();
            }}
            onMouseEnter={() => onHover(idx)}
          >
            <div className="font-mono font-semibold">{cmd.command}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{cmd.description}</div>
            {cmd.example && (
              <div className="text-xs text-muted-foreground/70 mt-0.5 font-mono">
                {t("terminal.atExample")}: {cmd.example}
              </div>
            )}
          </button>
        ))}
      </div>
      <div className="px-3 py-1.5 bg-secondary/30 text-xs text-muted-foreground border-t border-border">
        {hintText || t("terminal.atHint")}
      </div>
    </div>
  );
}
