import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { Folder, Trash2, Edit, CheckCircle2, Circle, Copy, Plus, ChevronRight, Clipboard } from 'lucide-react';
import { AtCommandIcon, UrcIcon, ScriptIcon } from '@/components/icons/CommandTypeIcons';
import type { CommandType } from '@/types/testCase';
import { useClipboardStore } from '@/stores/clipboardStore';

// 菜单项类型定义
interface MenuItem {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  className?: string;
  submenu?: SubMenuItem[]; // 子菜单
}

interface SubMenuItem {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  caseId: string;
  commandId?: string;
  /** 目标节点当前是否选中（用于显示"选中/取消选中"文案） */
  isSelected?: boolean;
  /** 多选状态集合 */
  multiSelection: Set<string>;
  onClose: () => void;
  onAddCase: (parentId: string | null) => void;
  onAddCommand: (caseId: string, type: CommandType) => void;
  onRemoveCase: (id: string) => void;
  onRemoveCommand: (caseId: string, cmdId: string) => void;
  onToggleSelected: (caseId: string, cmdId?: string) => void;
  onBatchToggleSelected: (ids: Set<string>, enable: boolean) => void;
  onBatchRemove: (ids: Set<string>) => void;
  onEditCase: (id: string) => void;
  onEditCommand: (caseId: string, cmdId: string) => void;
  onCopyCase: (caseId: string) => void;
  onCopyCommand: (caseId: string, commandId: string) => void;
  onPaste: (targetCaseId: string, targetCommandId?: string) => void;
}

export function ContextMenu({
  x,
  y,
  caseId,
  commandId,
  isSelected,
  multiSelection,
  onClose,
  onAddCase,
  onAddCommand,
  onRemoveCase,
  onRemoveCommand,
  onToggleSelected,
  onBatchToggleSelected,
  onBatchRemove,
  onEditCase,
  onEditCommand,
  onCopyCase,
  onCopyCommand,
  onPaste,
}: ContextMenuProps) {
  const { t } = useTranslation();
  const clipboard = useClipboardStore((state) => state.clipboard);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState({ left: x, top: y });
  const [submenuIndex, setSubmenuIndex] = useState<number | null>(null); // 当前悬浮的子菜单索引
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);

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

  // 如果有多选(>1项),显示批量操作菜单
  const hasBatchSelection = multiSelection.size > 1;

  const menuItems: MenuItem[] = hasBatchSelection
    ? [
        // 批量操作菜单
        {
          icon: CheckCircle2,
          label: t('testCase.batchEnable', { count: multiSelection.size }),
          onClick: () => onBatchToggleSelected(multiSelection, true),
        },
        {
          icon: Circle,
          label: t('testCase.batchDisable', { count: multiSelection.size }),
          onClick: () => onBatchToggleSelected(multiSelection, false),
        },
        {
          icon: Trash2,
          label: t('testCase.batchDelete', { count: multiSelection.size }),
          onClick: () => {
            if (confirm(t('testCase.batchDeleteConfirm', { count: multiSelection.size }))) {
              onBatchRemove(multiSelection);
            }
          },
          className: 'text-red-600 hover:bg-red-50',
        },
      ]
    : commandId
    ? [
        // 命令节点菜单
        {
          icon: Edit,
          label: t('testCase.edit'),
          onClick: () => onEditCommand(caseId, commandId),
        },
        {
          icon: Copy,
          label: t('testCase.copyCommand'),
          onClick: () => onCopyCommand(caseId, commandId),
        },
        ...(clipboard
          ? [
              {
                icon: Clipboard,
                label: t('testCase.paste'),
                onClick: () => onPaste(caseId, commandId),
              },
            ]
          : []),
        {
          icon: Plus,
          label: t('testCase.add'),
          // 子菜单：在当前命令后添加用例、命令、URC、脚本
          submenu: [
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
          ],
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
        // 用例节点菜单（优化后：5项，带子菜单）
        {
          icon: Edit,
          label: t('testCase.edit'),
          onClick: () => onEditCase(caseId),
        },
        {
          icon: Copy,
          label: t('testCase.copyCase'),
          onClick: () => onCopyCase(caseId),
        },
        ...(clipboard
          ? [
              {
                icon: Clipboard,
                label: t('testCase.paste'),
                onClick: () => onPaste(caseId, undefined),
              },
            ]
          : []),
        {
          icon: Plus,
          label: t('testCase.add'),
          // 子菜单：添加子用例、命令、URC、脚本
          submenu: [
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
          ],
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
        <div
          key={idx}
          className="relative"
          onMouseEnter={() => item.submenu && setSubmenuIndex(idx)}
          onMouseLeave={() => item.submenu && setSubmenuIndex(null)}
        >
          <button
            className={`w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-accent transition-colors ${
              item.className || ''
            }`}
            onClick={(e) => {
              if (item.submenu) {
                // 有子菜单：阻止关闭，切换子菜单显示
                e.stopPropagation();
                setSubmenuIndex(submenuIndex === idx ? null : idx);
              } else if (item.onClick) {
                // 无子菜单：执行操作并关闭
                item.onClick();
                onClose();
              }
            }}
          >
            <item.icon className="h-4 w-4" />
            <span className="flex-1 text-left">{item.label}</span>
            {item.submenu && <ChevronRight className="h-4 w-4" />}
          </button>

          {/* 子菜单 */}
          {item.submenu && submenuIndex === idx && (
            <div
              ref={submenuRef}
              className="absolute left-full top-0 ml-1 min-w-[160px] bg-white border rounded-md shadow-lg py-1 z-50"
              onClick={(e) => e.stopPropagation()}
            >
              {item.submenu.map((subItem, subIdx) => (
                <button
                  key={subIdx}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-accent transition-colors"
                  onClick={() => {
                    subItem.onClick();
                    onClose();
                  }}
                >
                  <subItem.icon className="h-4 w-4" />
                  {subItem.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}
