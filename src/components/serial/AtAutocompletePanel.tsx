/**
 * AT 命令自动完成候选面板（共享组件）
 *
 * 每行展示一条模板：左侧 s（语法，占位符高亮），右侧 d（描述）。
 * 候选列表、选中索引由 useAtAutocomplete hook 管理，面板只负责渲染与交互。
 */

import { useTranslation } from "react-i18next";
import type { TemplateCandidate } from "@/stores/commandLibraryStore";
import { tokenize } from "@/lib/commandTemplate";

interface AtAutocompletePanelProps {
  /** 候选模板列表 */
  candidates: TemplateCandidate[];
  /** 当前选中索引 */
  selectedIndex: number;
  /** 点击或回车选中候选时触发 */
  onSelect: () => void;
  /** 鼠标悬停改变选中项 */
  onHover: (index: number) => void;
  /** 面板是否可见 */
  visible: boolean;
  /** 可选：自定义底部提示文本 */
  hintText?: string;
  /** 展开方向：top（默认，向上，用于底部输入框）/ bottom（向下，用于页面上方输入框） */
  placement?: "top" | "bottom";
}

/** 渲染模板语法，占位符 <xxx> 用不同颜色高亮 */
function renderSyntax(s: string) {
  return tokenize(s).map((tok, i) =>
    tok.type === "placeholder" ? (
      <span key={i} className="text-primary/80 italic">
        {tok.text}
      </span>
    ) : (
      <span key={i}>{tok.text}</span>
    ),
  );
}

export function AtAutocompletePanel({
  candidates,
  selectedIndex,
  onSelect,
  onHover,
  visible,
  hintText,
  placement = "top",
}: AtAutocompletePanelProps) {
  const { t } = useTranslation();
  if (!visible) return null;

  const posClass = placement === "bottom" ? "top-full mt-1" : "bottom-full mb-1";

  return (
    <div className={`absolute ${posClass} left-0 w-full bg-popover border border-border rounded-md shadow-lg overflow-hidden z-50`}>
      <div className="max-h-48 overflow-y-auto custom-scrollbar">
        {candidates.map((cand, idx) => (
          <button
            key={`${cand.cmd}::${cand.s}::${idx}`}
            type="button"
            className={`w-full text-left px-3 py-2 text-sm border-b border-border/50 last:border-b-0 transition-colors ${
              idx === selectedIndex ? "bg-primary/10 text-primary font-medium" : "hover:bg-secondary/50"
            }`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onHover(idx);
              onSelect();
            }}
            onMouseEnter={() => onHover(idx)}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono font-semibold truncate">{renderSyntax(cand.s)}</span>
              {cand.d && (
                <span className="text-xs text-muted-foreground shrink-0 max-w-[55%] truncate">{cand.d}</span>
              )}
            </div>
          </button>
        ))}
      </div>
      <div className="px-3 py-1.5 bg-secondary/30 text-xs text-muted-foreground border-t border-border">
        {hintText || t("terminal.atHint")}
      </div>
    </div>
  );
}
