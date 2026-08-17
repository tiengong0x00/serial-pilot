import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export interface TerminalMenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

interface TerminalContextMenuProps {
  x: number;
  y: number;
  items: TerminalMenuItem[];
  onClose: () => void;
}

/** 终端专用右键菜单（复制/粘贴/剪切/全选/清空等） */
export function TerminalContextMenu({ x, y, items, onClose }: TerminalContextMenuProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const handleClose = () => onClose();
    document.addEventListener("click", handleClose);
    document.addEventListener("scroll", handleClose, true);
    return () => {
      document.removeEventListener("click", handleClose);
      document.removeEventListener("scroll", handleClose, true);
    };
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed z-50 min-w-[140px] bg-popover border rounded-md shadow-lg py-1"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, idx) => (
        <button
          key={idx}
          type="button"
          disabled={item.disabled}
          className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
          onClick={() => {
            item.onClick();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body
  );
}
