/**
 * 用例选择对话框
 * 显示所有可用的测试用例文件，支持搜索和新建
 */

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Plus, FileText } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface CaseSelectorDialogProps {
  open: boolean;
  files: string[];
  currentFile: string | null;
  onClose: () => void;
  onSelect: (filename: string) => void;
  onCreateNew: () => void;
}

export function CaseSelectorDialog({
  open,
  files,
  currentFile,
  onClose,
  onSelect,
  onCreateNew,
}: CaseSelectorDialogProps) {
  const { t } = useTranslation();
  const [searchText, setSearchText] = useState('');

  // 过滤文件列表
  const filteredFiles = useMemo(() => {
    if (!searchText.trim()) return files;
    const lower = searchText.toLowerCase();
    return files.filter((f) => f.toLowerCase().includes(lower));
  }, [files, searchText]);

  const handleSelect = (filename: string) => {
    onSelect(filename);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('testCase.selectTestCase')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* 搜索框 */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              className="w-full h-9 pl-9 pr-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder={t('testCase.searchCasePlaceholder')}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              autoFocus
            />
          </div>

          {/* 新建用例按钮 */}
          <button
            className="w-full h-9 px-3 flex items-center gap-2 text-sm rounded-md border border-dashed border-primary text-primary hover:bg-primary/10 transition-colors"
            onClick={() => {
              onCreateNew();
              onClose();
            }}
          >
            <Plus className="h-4 w-4" />
            {t('testCase.newCaseFile')}
          </button>

          {/* 用例文件列表 */}
          <div className="max-h-80 overflow-y-auto border rounded-md">
            {filteredFiles.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {searchText ? t('testCase.noMatchingCases') : t('testCase.noCaseFiles')}
              </div>
            ) : (
              <div className="divide-y">
                {filteredFiles.map((filename) => {
                  const isCurrent = filename === currentFile;
                  return (
                    <button
                      key={filename}
                      className={`w-full px-3 py-2.5 flex items-center gap-2.5 text-sm text-left transition-colors ${
                        isCurrent
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'hover:bg-muted'
                      }`}
                      onClick={() => handleSelect(filename)}
                    >
                      <FileText className="h-4 w-4 flex-shrink-0" />
                      <span className="flex-1 truncate">{filename}</span>
                      {isCurrent && (
                        <span className="text-xs text-primary/70">{t('testCase.current')}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
