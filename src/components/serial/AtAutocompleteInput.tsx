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
}

export function AtAutocompleteInput({
  value,
  onChange,
  placeholder,
  className = "w-full px-3 py-2 border rounded-md bg-background text-sm font-mono",
  triggerMode = "at-prefix",
  onFileDrop,
  onCtrlS,
}: AtAutocompleteInputProps) {
  const autocomplete = useAtAutocomplete(value, triggerMode);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const applyCandidate = useCallback(() => {
    const selected = autocomplete.getSelected();
    if (selected) {
      onChange(selected.command);
      autocomplete.dismiss();
      inputRef.current?.focus();
    }
  }, [autocomplete, onChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
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
          case "Tab":
            e.preventDefault();
            applyCandidate();
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
    [autocomplete, applyCandidate, onCtrlS, value]
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
      <input
        ref={inputRef}
        className={`${className}${isDragging ? " ring-2 ring-primary border-primary" : ""}`}
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
      />
    </div>
  );
}
