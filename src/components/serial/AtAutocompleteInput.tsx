/**
 * AT 自动完成输入框（input + hook + panel 一体封装）
 *
 * 供 CommandEditor 中的命令内容框和 URC pattern 框使用。
 * 内部集成 useAtAutocomplete hook、键盘导航、候选面板，对外只暴露 value/onChange。
 */

import { useCallback, useRef, useState } from "react";
import { useAtAutocomplete, type TriggerMode } from "@/hooks/useAtAutocomplete";
import { AtAutocompletePanel } from "./AtAutocompletePanel";

interface AtAutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** 触发模式：at-prefix（默认，仅AT开头）或 always（任意输入） */
  triggerMode?: TriggerMode;
  /** 拖入文件回调（可选）：提供后输入框支持拖拽文件 */
  onFileDrop?: (file: File) => void;
  /** Ctrl+S 回调（可选）：提供后焦点在本输入框时按 Ctrl+S 触发，传入当前值 */
  onCtrlS?: (value: string) => void;
  /** 候选面板展开方向，默认向下（用于页面上方的表单输入框） */
  placement?: "top" | "bottom";
}

export function AtAutocompleteInput({
  value,
  onChange,
  placeholder,
  className = "w-full px-3 py-2 border rounded-md bg-background text-sm font-mono",
  triggerMode = "at-prefix",
  onFileDrop,
  onCtrlS,
  placement = "bottom",
}: AtAutocompleteInputProps) {
  const autocomplete = useAtAutocomplete(value, triggerMode);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // 高亮选中候选的模板语法 s；若含占位符，选中第一个占位符区域便于覆盖输入
  const applyCandidate = useCallback(() => {
    const selected = autocomplete.getSelected();
    if (selected) {
      onChange(selected.s);
      autocomplete.dismiss();
      const el = inputRef.current;
      el?.focus();
      // 下一帧设置占位符高亮（等 value 更新后）
      const ph = selected.s.indexOf("<");
      const phEnd = ph !== -1 ? selected.s.indexOf(">", ph + 1) : -1;
      if (el && ph !== -1 && phEnd !== -1) {
        requestAnimationFrame(() => el.setSelectionRange(ph, phEnd + 1));
      }
    }
  }, [autocomplete, onChange]);

  // Tab 补全：公共前缀 + 歧义暂停 + 占位符高亮
  const handleTab = useCallback(() => {
    const result = autocomplete.getTabCompletion();
    if (!result || result.ambiguous) return; // 歧义暂停：不补全，等更多输入
    onChange(result.text);
    const el = inputRef.current;
    el?.focus();
    if (el && result.highlight) {
      const { start, end } = result.highlight;
      requestAnimationFrame(() => el.setSelectionRange(start, end));
    }
  }, [autocomplete, onChange]);

  // 高亮态按 Tab 跳到下一个占位符
  const jumpNextPlaceholder = useCallback((): boolean => {
    const el = inputRef.current;
    if (!el) return false;
    const from = el.selectionEnd ?? 0;
    const next = value.indexOf("<", from);
    if (next === -1) return false;
    const nextEnd = value.indexOf(">", next + 1);
    if (nextEnd === -1) return false;
    el.setSelectionRange(next, nextEnd + 1);
    return true;
  }, [value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Tab：优先在占位符间跳转（选中态），否则做补全
      if (e.key === "Tab" && !e.shiftKey) {
        const el = inputRef.current;
        const hasSelection = el && el.selectionStart !== el.selectionEnd;
        if (hasSelection && jumpNextPlaceholder()) {
          e.preventDefault();
          return;
        }
        if (autocomplete.isOpen) {
          e.preventDefault();
          handleTab();
          return;
        }
      }

      if (autocomplete.isOpen) {
        switch (e.key) {
          case "ArrowDown":
            e.preventDefault();
            autocomplete.moveDown();
            return;
          case "ArrowUp":
            e.preventDefault();
            autocomplete.moveUp();
            return;
          case "Escape":
            e.preventDefault();
            autocomplete.dismiss();
            return;
          case "Enter":
            // 候选面板打开时，Enter 优先补全而非提交
            e.preventDefault();
            applyCandidate();
            return;
          default:
            break;
        }
      }

      // Ctrl+S 保存命令到库（仅焦点在本输入框时生效）
      if (onCtrlS && e.key.toLowerCase() === "s" && e.ctrlKey) {
        e.preventDefault();
        const v = value.trim();
        if (v) onCtrlS(v);
      }
    },
    [autocomplete, applyCandidate, handleTab, jumpNextPlaceholder, onCtrlS, value]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!onFileDrop) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
    },
    [onFileDrop]
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (!onFileDrop) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
    },
    [onFileDrop]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (!onFileDrop) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) onFileDrop(file);
    },
    [onFileDrop]
  );

  return (
    <div className="relative">
      {/* 灰显「剩余期望」覆盖层：与 input 同字体/内距，透明占位 + 灰色续写 */}
      {autocomplete.ghostHint && (
        <div
          aria-hidden
          className="absolute inset-0 px-3 py-2 text-sm font-mono whitespace-pre overflow-hidden pointer-events-none border border-transparent"
        >
          <span className="invisible">{value}</span>
          <span className="text-muted-foreground/60">{autocomplete.ghostHint}</span>
        </div>
      )}
      <input
        ref={inputRef}
        className={`relative bg-transparent ${className}${isDragging ? " ring-2 ring-primary border-primary" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => autocomplete.dismiss()}
        placeholder={placeholder}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      />
      <AtAutocompletePanel
        visible={autocomplete.isOpen}
        candidates={autocomplete.candidates}
        selectedIndex={autocomplete.selectedIndex}
        onSelect={applyCandidate}
        onHover={autocomplete.setSelectedIndex}
        placement={placement}
      />
    </div>
  );
}
