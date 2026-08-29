/**
 * 用例扩展菜单
 * 提供重命名、删除、导出、导入等操作
 */

import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreVertical, Trash2, Download, Upload, Save, Settings } from 'lucide-react';

interface CaseExtensionMenuProps {
  currentFile: string | null;
  disabled?: boolean;
  isDirty?: boolean;
  onSave: () => void;
  onEditCase: () => void;
  onDelete: () => void;
  onExport: () => void;
  onImport: () => void;
}

export function CaseExtensionMenu({
  currentFile,
  disabled,
  isDirty,
  onSave,
  onEditCase,
  onDelete,
  onExport,
  onImport,
}: CaseExtensionMenuProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleAction = (action: () => void) => {
    action();
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        className="flex items-center justify-center h-8 w-8 bg-background border border-border rounded-md hover:bg-accent transition-colors disabled:opacity-40"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        title={t('testCase.moreActions')}
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-popover border rounded-md shadow-lg z-50 py-1">
          <button
            className="w-full px-3 py-2 flex items-center gap-2.5 text-sm text-left hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => handleAction(onSave)}
            disabled={!currentFile || !isDirty}
          >
            <Save className="h-4 w-4" />
            {isDirty ? t('testCase.saveDirty') : t('testCase.save')}
          </button>

          <div className="h-px bg-border my-1" />

          <button
            className="w-full px-3 py-2 flex items-center gap-2.5 text-sm text-left hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => handleAction(onEditCase)}
            disabled={!currentFile}
          >
            <Settings className="h-4 w-4" />
            {t('testCase.editCaseProperties')}
          </button>

          <button
            className="w-full px-3 py-2 flex items-center gap-2.5 text-sm text-left hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => handleAction(onDelete)}
            disabled={!currentFile}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
            <span className="text-destructive">{t('testCase.deleteCaseFile')}</span>
          </button>

          <div className="h-px bg-border my-1" />

          <button
            className="w-full px-3 py-2 flex items-center gap-2.5 text-sm text-left hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => handleAction(onExport)}
            disabled={!currentFile}
          >
            <Download className="h-4 w-4" />
            {t('testCase.exportCaseFile')}
          </button>

          <button
            className="w-full px-3 py-2 flex items-center gap-2.5 text-sm text-left hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => handleAction(onImport)}
            disabled={!currentFile}
          >
            <Upload className="h-4 w-4" />
            {t('testCase.importCaseFile')}
          </button>
        </div>
      )}
    </div>
  );
}
