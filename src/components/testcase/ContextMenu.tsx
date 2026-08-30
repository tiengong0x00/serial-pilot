import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { Folder, Trash2, Edit, CheckCircle2, Circle } from 'lucide-react';
import { AtCommandIcon, UrcIcon, ScriptIcon } from '@/components/icons/CommandTypeIcons';
import type { CommandType } from '@/types/testCase';

interface ContextMenuProps {
  x: number;
  y: number;
  caseId: string;
  commandId?: string;
  /** 目标节点当前是否选中（用于显示"选中/取消选中"文案） */
  isSelected?: boolean;
  onClose: () => void;
  onAddCase: (parentId: string | null) => void;
  onAddCommand: (caseId: string, type: CommandType) => void;
  onRemoveCase: (id: string) => void;
  onRemoveCommand: (caseId: string, cmdId: string) => void;
  onToggleSelected: (caseId: string, cmdId?: string) => void;
  onEditCase: (id: string) => void;
  onEditCommand: (caseId: string, cmdId: string) => void;
}

export function ContextMenu({
  x,
  y,
  caseId,
  commandId,
  isSelected,
  onClose,
  onAddCase,
  onAddCommand,
  onRemoveCase,
  onRemoveCommand,
  onToggleSelected,
  onEditCase,
  onEditCommand,
}: ContextMenuProps) {
  const { t } = useTranslation();
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState({ left: x, top: y });
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 调整菜单位置，避免超出视口（底部超出则向上翻转，右侧超出则向左翻转）
  useEffect(() => {
    if (!mounted || !menuRef.current) return;

    const rect = menuRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = x;
    let top = y;

    // 右侧超出：翻转到点击位置左侧
    if (x + rect.width > viewportWidth) {
      left = Math.max(0, x - rect.width);
    }
    // 底部超出：翻转到点击位置上方
    if (y + rect.height > viewportHeight) {
      top = Math.max(0, y - rect.height);
    }

    setPosition({ left, top });
  }, [mounted, x, y]);

  useEffect(() => {
    const handleClick = () => onClose();
    const handleScroll = () => onClose();

    document.addEventListener('click', handleClick);
    document.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [onClose]);

  const menuItems = commandId
    ? [
        // 命令节点菜单
        {
          icon: Edit,
          label: t('testCase.edit'),
          onClick: () => onEditCommand(caseId, commandId),
        },
        {
          icon: isSelected ? Circle : CheckCircle2,
          label: isSelected ? t('testCase.disableExecution') : t('testCase.enableExecution'),
          onClick: () => onToggleSelected(caseId, commandId),
        },
        {
          icon: Trash2,
          label: t('testCase.deleteCommand'),
          onClick: () => onRemoveCommand(caseId, commandId),
          className: 'text-red-600 hover:bg-red-50',
        },
      ]
    : [
        // 用例节点菜单
        {
          icon: Edit,
          label: t('testCase.edit'),
          onClick: () => onEditCase(caseId),
        },
        {
          icon: Folder,
          label: t('testCase.addCase'),
          onClick: () => onAddCase(caseId),
        },
        {
          icon: AtCommandIcon,
          label: t('testCase.addCommand'),
          onClick: () => onAddCommand(caseId, 'command'),
        },
        {
          icon: UrcIcon,
          label: t('testCase.addUrc'),
          onClick: () => onAddCommand(caseId, 'urc-guard'),
        },
        {
          icon: ScriptIcon,
          label: t('testCase.addScript'),
          onClick: () => onAddCommand(caseId, 'script'),
        },
        {
          icon: isSelected ? Circle : CheckCircle2,
          label: isSelected ? t('testCase.disableExecution') : t('testCase.enableExecution'),
          onClick: () => onToggleSelected(caseId),
        },
        {
          icon: Trash2,
          label: t('testCase.deleteCase'),
          onClick: () => onRemoveCase(caseId),
          className: 'text-red-600 hover:bg-red-50',
        },
      ];

  if (!mounted) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] bg-white border rounded-md shadow-lg py-1"
      style={{ left: position.left, top: position.top }}
      onClick={(e) => e.stopPropagation()}
    >
      {menuItems.map((item, idx) => (
        <button
          key={idx}
          className={`w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-accent transition-colors ${
            item.className || ''
          }`}
          onClick={() => {
            item.onClick();
            onClose();
          }}
        >
          <item.icon className="h-4 w-4" />
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
