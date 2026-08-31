import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Square, RefreshCw, Maximize2, Minimize2, Plus, Folder } from 'lucide-react';
import { AtCommandIcon, UrcIcon, ScriptIcon } from '@/components/icons/CommandTypeIcons';
import { useTestCaseStore } from '@/stores/testCaseStore';
import { useExecutionStore } from '@/stores/executionStore';
import { useTestExecution } from '@/hooks/useTestExecution';
import { useUrcListener } from '@/hooks/useUrcListener';
import { useTestCaseFiles } from '@/hooks/useTestCaseFiles';
import { useSettingsStore } from '@/stores/settingsStore';
import { findCase, findCommand, walkCases, isCommand, isUrcGuard } from '@/lib/testCaseUtils';
import type { StandardCommand } from '@/types/testCase';
import { TestCaseTree } from './TestCaseTree';
import { ContextMenu } from './ContextMenu';
import { CommandEditorDialog } from './CommandEditorDialog';
import { CaseEditorDialog } from './CaseEditorDialog';
import { CaseSelectorDialog } from './CaseSelectorDialog';
import { CaseExtensionMenu } from './CaseExtensionMenu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

interface ContextMenuState {
  x: number;
  y: number;
  caseId: string;
  commandId?: string;
}

export function TestCaseManager() {
  const { t } = useTranslation();
  const {
    cases,
    selectedCaseId,
    selectedCommandId,
    isDirty,
    addCase,
    removeCase,
    updateCase,
    toggleExpanded,
    addCommand,
    addCommandRelative,
    removeCommand,
    updateCommand,
    selectCase,
    selectCommand,
    exportJson,
    importJson,
    importAsGroup,
    markClean,
    getRootCase,
    moveChildRelative,
    moveChildToPosition,
    reset,
  } = useTestCaseStore();

  const { isRunning } = useExecutionStore();
  const { startExecution, stopExecution, runSingleCase, runSingleCommand, quickSendCommand } = useTestExecution();
  useUrcListener(); // 启动 URC 后台监听器

  // 自动保存配置
  const testCaseAutoSave = useSettingsStore((s) => s.testCaseAutoSave);

  // 模板文件管理
  const {
    files,
    currentFile,
    loading: filesLoading,
    error: filesError,
    loadFile,
    saveFile,
    deleteFile,
    renameFile,
    refreshFiles,
  } = useTestCaseFiles();

  // 启动时自动加载默认模板文件
  useEffect(() => {
    const autoLoadDefault = async () => {
      const list = await refreshFiles();
      if (list.length === 0) return;

      // 优先加载 demo.json 或第一个文件
      const defaultFile = list.find((f) => f === 'demo.json') || list[0];
      const json = await loadFile(defaultFile);
      if (json) {
        try {
          importJson(json, defaultFile, true);
          markClean(); // 刚加载，无未保存修改
        } catch (err) {
          console.error('Failed to auto-load template:', err);
        }
      }
    };

    // 只在首次挂载且用例为空时自动加载
    if (cases.length === 0) {
      void autoLoadDefault();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editingCase, setEditingCase] = useState<string | null>(null);
  const [editingCommand, setEditingCommand] = useState<{
    caseId: string;
    commandId: string;
  } | null>(null);
  const [caseSelectorOpen, setCaseSelectorOpen] = useState(false);
  const [allExpanded, setAllExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 添加按钮的悬浮下拉菜单
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 悬浮进入：取消待关闭，延迟展开下拉菜单
  const handleAddMouseEnter = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    openTimerRef.current = setTimeout(() => setAddMenuOpen(true), 250);
  }, []);

  // 移出：取消待展开，延迟收起（留出时间移向菜单项，避免瞬间消失）
  const handleAddMouseLeave = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => setAddMenuOpen(false), 300);
  }, []);

  // 卸载时清理定时器
  useEffect(() => {
    return () => {
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  // 计算添加目标：优先选中的用例，其次根用例
  const resolveTargetCaseId = useCallback((): string | null => {
    const root = getRootCase();
    if (!root) return null;
    return selectedCaseId ?? root.id;
  }, [getRootCase, selectedCaseId]);

  // Bug 3 修复：智能插入逻辑
  // - 选中命令：在该命令同级下方插入新命令
  // - 选中用例：在用例内部末尾插入（方案 B）
  // - 无选中：根末尾新增
  const handleAddCommand = useCallback(() => {
    const root = getRootCase();
    if (!root) return;

    let newId: string | null = null;

    if (selectedCommandId) {
      // 选中命令：需找到命令所属父用例，在命令下方插入
      const parent = findCase([root], selectedCaseId || root.id);
      if (parent) {
        newId = addCommandRelative(parent.id, selectedCommandId, 'command');
      }
    } else if (selectedCaseId) {
      // 选中用例：在用例内部末尾插入，并展开
      newId = addCommandRelative(selectedCaseId, null, 'command');
      updateCase(selectedCaseId, { isExpanded: true });
    } else {
      // 无选中：根末尾新增
      newId = addCommandRelative(root.id, null, 'command');
    }

    // 自动选中新建的命令
    if (newId) selectCommand(newId);
    setAddMenuOpen(false);
  }, [getRootCase, selectedCommandId, selectedCaseId, addCommandRelative, updateCase, selectCommand]);

  const handleAddCase = useCallback(() => {
    const target = resolveTargetCaseId();
    if (target) {
      addCase(target);
      // 展开目标用例以显示新建的子用例
      updateCase(target, { isExpanded: true });
    }
    setAddMenuOpen(false);
  }, [resolveTargetCaseId, addCase, updateCase]);

  const handleAddUrcGuard = useCallback(() => {
    const root = getRootCase();
    if (!root) return;

    let newId: string | null = null;

    if (selectedCommandId) {
      const parent = findCase([root], selectedCaseId || root.id);
      if (parent) {
        newId = addCommandRelative(parent.id, selectedCommandId, 'urc-guard');
      }
    } else if (selectedCaseId) {
      newId = addCommandRelative(selectedCaseId, null, 'urc-guard');
      updateCase(selectedCaseId, { isExpanded: true });
    } else {
      newId = addCommandRelative(root.id, null, 'urc-guard');
    }

    if (newId) selectCommand(newId);
    setAddMenuOpen(false);
  }, [getRootCase, selectedCommandId, selectedCaseId, addCommandRelative, updateCase, selectCommand]);

  const handleAddScript = useCallback(() => {
    const root = getRootCase();
    if (!root) return;

    let newId: string | null = null;

    if (selectedCommandId) {
      const parent = findCase([root], selectedCaseId || root.id);
      if (parent) {
        newId = addCommandRelative(parent.id, selectedCommandId, 'script');
      }
    } else if (selectedCaseId) {
      newId = addCommandRelative(selectedCaseId, null, 'script');
      updateCase(selectedCaseId, { isExpanded: true });
    } else {
      newId = addCommandRelative(root.id, null, 'script');
    }

    if (newId) selectCommand(newId);
    setAddMenuOpen(false);
  }, [getRootCase, selectedCommandId, selectedCaseId, addCommandRelative, updateCase, selectCommand]);

  // 未保存修改确认对话框
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    pendingAction: (() => void) | null;
  }>({ open: false, pendingAction: null });

  // 当前编辑的用例数据
  const editingCaseData = editingCase ? findCase(cases, editingCase) : null;

  // 编辑的命令数据
  const editingCommandData = editingCommand
    ? findCommand(cases, editingCommand.commandId)
    : null;

  // 处理右键菜单
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, caseId: string, commandId?: string) => {
      setContextMenu({ x: e.clientX, y: e.clientY, caseId, commandId });
    },
    [],
  );

  // 右键切换 selected 状态
  const handleToggleSelected = useCallback(
    (caseId: string, commandId?: string) => {
      if (commandId) {
        // 切换单个命令的 selected
        const found = findCommand(cases, commandId);
        if (found) {
          updateCommand(caseId, commandId, { selected: !found.command.selected });
        }
      } else {
        // 切换用例及其所有子节点的 selected
        const targetCase = findCase(cases, caseId);
        if (targetCase) {
          // 根用例（带 targetPort）始终选中，不可取消
          const isRoot = 'targetPort' in targetCase;
          if (isRoot) {
            return; // 静默忽略，根用例不允许取消选中
          }

          const newSelected = !targetCase.selected;
          // 递归更新用例及所有子用例和命令
          walkCases([targetCase], (c) => {
            updateCase(c.id, { selected: newSelected });
            c.children.forEach((child) => {
              if (isCommand(child)) {
                updateCommand(c.id, child.id, { selected: newSelected });
              }
            });
          });
        }
      }
    },
    [cases, updateCase, updateCommand],
  );

  // 打开用例编辑弹窗
  const handleEditCase = useCallback((caseId: string) => {
    setEditingCase(caseId);
  }, []);

  // 编辑根用例属性
  const handleEditRootCase = useCallback(() => {
    const root = getRootCase();
    if (root) {
      setEditingCase(root.id);
    }
  }, [getRootCase]);

  // 打开命令编辑弹窗
  const handleEditCommand = useCallback((caseId: string, cmdId: string) => {
    setEditingCommand({ caseId, commandId: cmdId });
  }, []);

  // 实际执行文件加载（替换模式：清空当前用例，加载选中文件）
  const performFileSelect = useCallback(
    async (filename: string) => {
      if (!filename) return;
      const json = await loadFile(filename);
      if (json) {
        try {
          reset();
          importJson(json, filename, true);
          markClean(); // 刚加载，无未保存修改
        } catch (err) {
          alert(t('testCase.loadTemplateFailed', { error: err }));
        }
      }
    },
    [loadFile, reset, importJson, markClean],
  );

  // 切换文件：如果有未保存修改，先弹确认对话框
  const handleFileSelect = useCallback(
    (filename: string) => {
      if (!filename) return;
      if (isDirty) {
        setConfirmDialog({
          open: true,
          pendingAction: () => void performFileSelect(filename),
        });
      } else {
        void performFileSelect(filename);
      }
    },
    [isDirty, performFileSelect],
  );

  // 新建用例文件
  const handleCreateNewFile = useCallback(() => {
    const filename = prompt(t('testCase.promptNewFileName'));
    if (!filename) return;

    const fullname = filename.endsWith('.json') ? filename : `${filename}.json`;

    // 创建空用例文件
    const emptyJson = JSON.stringify({ version: '1.0', testCases: [] }, null, 2);
    saveFile(fullname, emptyJson).then((success) => {
      if (success) {
        // 立即清空 store 并标记为 clean，防止自动保存覆盖新文件
        reset();
        markClean();
        // 加载新创建的文件（已 clean，不会触发确认对话框）
        void performFileSelect(fullname);
      } else {
        alert(t('testCase.createFileFailed', { error: filesError }));
      }
    });
  }, [saveFile, performFileSelect, reset, markClean, filesError, t]);

  // 删除当前用例文件
  const handleDeleteFile = useCallback(async () => {
    if (!currentFile) return;

    const confirmed = confirm(t('testCase.confirmDeleteFile', { file: currentFile }));
    if (!confirmed) return;

    const success = await deleteFile(currentFile);
    if (success) {
      reset(); // 清空当前用例
      markClean();
      alert(t('testCase.deleteSuccess'));
    } else {
      alert(t('testCase.deleteFailed', { error: filesError }));
    }
  }, [currentFile, deleteFile, reset, markClean, filesError, t]);

  // 保存当前用例到文件
  const handleSaveFile = useCallback(async () => {
    if (!currentFile) return;

    const json = exportJson(currentFile);
    const success = await saveFile(currentFile, json);
    if (success) {
      markClean();
    } else {
      alert(t('testCase.saveFailed', { error: filesError }));
    }
  }, [currentFile, exportJson, saveFile, markClean, filesError, t]);

  // 自动保存：开启 + 有修改 + 有文件时，2秒防抖后静默保存
  // 依赖 handleSaveFile，故定义在其后，避免暂时性死区
  useEffect(() => {
    if (!testCaseAutoSave || !isDirty || !currentFile) return;

    const timer = setTimeout(() => {
      void handleSaveFile();
    }, 2000);

    return () => clearTimeout(timer);
  }, [testCaseAutoSave, isDirty, currentFile, handleSaveFile]);

  // 刷新：更新文件列表，并重新从磁盘加载当前打开的文件（丢弃内存中的未保存修改）
  const handleRefresh = useCallback(async () => {
    const list = await refreshFiles();
    if (!currentFile) return;

    // 当前文件已被外部删除，清空并结束
    if (!list.includes(currentFile)) {
      reset();
      return;
    }

    if (isDirty) {
      const ok = window.confirm(t('testCase.refreshDiscardConfirm'));
      if (!ok) return;
    }

    const json = await loadFile(currentFile);
    if (json) {
      try {
        importJson(json, currentFile, true);
        markClean();
      } catch (err) {
        console.error('Failed to reload file:', err);
        alert(t('testCase.importFailed', { error: err }));
      }
    }
  }, [refreshFiles, currentFile, isDirty, loadFile, importJson, markClean, reset, t]);

  // 导出当前用例（下载）
  const handleExportCurrentFile = useCallback(() => {
    if (!currentFile) return;
    const json = exportJson(currentFile);
    downloadJson(json, currentFile);
  }, [exportJson, currentFile]);

  // 导入用例（作为组添加到当前用例）
  const handleImportAsGroup = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt) => {
        const json = evt.target?.result as string;
        try {
          // 从文件名提取组名（去掉 .json 后缀）
          const groupName = file.name.replace('.json', '');
          importAsGroup(json, groupName);
          alert(t('testCase.importSuccess', { name: groupName }));
        } catch (err) {
          alert(t('testCase.importFailed', { error: err }));
        }
      };
      reader.readAsText(file);

      // 重置 input 以便重复导入同一文件
      e.target.value = '';
    },
    [importAsGroup],
  );

  // 折叠/展开所有用例
  const handleToggleAllExpanded = useCallback(() => {
    const newExpanded = !allExpanded;
    setAllExpanded(newExpanded);
    walkCases(cases, (c) => {
      updateCase(c.id, { isExpanded: newExpanded });
    });
  }, [allExpanded, cases, updateCase]);

  // 运行选中用例（v1 递归模型：运行整个根用例）
  const handleRun = useCallback(() => {
    if (isRunning) {
      stopExecution();
    } else {
      const root = getRootCase();
      if (root) {
        // 不再传递 root.targetPort，由执行引擎智能解析
        void startExecution();
      }
    }
  }, [isRunning, getRootCase, startExecution, stopExecution]);

  // 运行单个用例
  const handleRunCase = useCallback(
    (caseId: string) => {
      const root = getRootCase();
      if (root && !isRunning) {
        // 不再传递 root.targetPort，由执行引擎智能解析
        void runSingleCase(caseId);
      }
    },
    [getRootCase, isRunning, runSingleCase],
  );

  // 运行单个命令
  // - 普通命令：裸发送模式（只发内容/文件，不校验，发完即结束）
  // - URC 守护：正常运行（保留完整流程）
  const handleRunCommand = useCallback(
    (caseId: string, commandId: string) => {
      const root = getRootCase();
      if (!root || isRunning) return;

      const found = findCommand(cases, commandId);
      if (!found) return;

      if (isUrcGuard(found.command)) {
        // URC 走正常运行逻辑（不再传递 root.targetPort）
        void runSingleCommand(caseId, commandId);
      } else {
        // 普通命令走快速发送（点射，不再传递 root.targetPort）
        void quickSendCommand(found.command as StandardCommand);
      }
    },
    [cases, getRootCase, isRunning, runSingleCommand, quickSendCommand],
  );

  return (
    <div className="flex flex-col h-full">
      {/* 新工具栏：[名称按钮] [新增命令] [新增用例] [刷新] [折叠/展开] [扩展▼] */}
      <div className="flex items-center gap-1.5 p-2 border-b bg-muted/30">
        {/* 当前用例名称按钮 */}
        <button
          className="flex-1 h-8 px-3 text-sm text-left rounded-md border border-input bg-background hover:bg-accent transition-colors truncate"
          onClick={() => setCaseSelectorOpen(true)}
          title={t('testCase.selectCaseFile')}
        >
          {currentFile ? currentFile.replace('.json', '') : t('testCase.selectCaseFilePlaceholder')}
        </button>

        {/* 添加按钮：单击加命令，悬浮出下拉（命令/用例/URC） */}
        <div
          className="relative"
          onMouseEnter={handleAddMouseEnter}
          onMouseLeave={handleAddMouseLeave}
        >
          <button
            className="flex items-center justify-center h-8 w-8 bg-background border border-border rounded-md hover:bg-accent transition-colors disabled:opacity-40"
            onClick={handleAddCommand}
            disabled={cases.length === 0}
            title={t('testCase.addHint')}
          >
            <Plus className="h-4 w-4" />
          </button>

          {addMenuOpen && cases.length > 0 && (
            // 外层透明容器用 pt-1 桥接按钮与菜单之间的间隙，避免鼠标穿越时离开 hover 区域
            <div className="absolute left-0 top-full pt-1 z-50 min-w-[140px]">
              <div className="rounded-md border bg-popover shadow-md py-1">
                <button
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors"
                  onClick={handleAddCommand}
                >
                  <AtCommandIcon />
                  {t('testCase.newCommand')}
                </button>
                <button
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors"
                  onClick={handleAddCase}
                >
                  <Folder className="h-4 w-4 text-blue-500" />
                  {t('testCase.newCase')}
                </button>
                <button
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors"
                  onClick={handleAddUrcGuard}
                >
                  <UrcIcon />
                  {t('testCase.newUrc')}
                </button>
                <button
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors"
                  onClick={handleAddScript}
                >
                  <ScriptIcon />
                  {t('testCase.newScript')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 刷新 */}
        <button
          className="flex items-center justify-center h-8 w-8 bg-background border border-border rounded-md hover:bg-accent transition-colors disabled:opacity-40"
          onClick={() => void handleRefresh()}
          disabled={filesLoading}
          title={t('testCase.refreshFiles')}
        >
          <RefreshCw className={`h-4 w-4 ${filesLoading ? 'animate-spin' : ''}`} />
        </button>

        {/* 折叠/展开 */}
        <button
          className="flex items-center justify-center h-8 w-8 bg-background border border-border rounded-md hover:bg-accent transition-colors disabled:opacity-40"
          onClick={handleToggleAllExpanded}
          disabled={cases.length === 0}
          title={allExpanded ? t('testCase.collapseAll') : t('testCase.expandAll')}
        >
          {allExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>

        {/* 扩展菜单 */}
        <CaseExtensionMenu
          currentFile={currentFile}
          disabled={!currentFile}
          isDirty={isDirty}
          onSave={handleSaveFile}
          onEditCase={handleEditRootCase}
          onDelete={handleDeleteFile}
          onExport={handleExportCurrentFile}
          onImport={handleImportAsGroup}
        />

        <div className="w-px h-5 bg-border mx-1" />

        {/* 运行/停止按钮 */}
        <button
          className={`flex items-center justify-center h-8 w-8 rounded-md transition-colors ${
            isRunning
              ? 'bg-red-500 text-white hover:bg-red-600'
              : 'bg-green-500 text-white hover:bg-green-600 disabled:opacity-40'
          }`}
          onClick={handleRun}
          disabled={cases.length === 0}
          title={isRunning ? t('testCase.stopExecution') : t('testCase.runCase')}
        >
          {isRunning ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
      </div>

      {filesError && <p className="px-2 pt-1 text-xs text-destructive">{filesError}</p>}

      {/* 主区域：用例树占满全宽 */}
      <div
        className="flex-1 overflow-y-auto"
        onContextMenu={(e) => {
          e.preventDefault();
          const root = getRootCase();
          if (root) {
            handleContextMenu(e, root.id, undefined);
          }
        }}
      >
        <TestCaseTree
          cases={cases}
          selectedCaseId={selectedCaseId}
          selectedCommandId={selectedCommandId}
          onSelectCase={selectCase}
          onSelectCommand={selectCommand}
          onToggleExpanded={toggleExpanded}
          onContextMenu={handleContextMenu}
          onEditCase={handleEditCase}
          onEditCommand={handleEditCommand}
          onUpdateCommand={updateCommand}
          onMoveChildRelative={moveChildRelative}
          onMoveChildToPosition={moveChildToPosition}
          onRunCase={handleRunCase}
          onRunCommand={handleRunCommand}
          isRunning={isRunning}
        />
      </div>

      {/* 用例选择对话框 */}
      <CaseSelectorDialog
        open={caseSelectorOpen}
        files={files}
        currentFile={currentFile}
        onClose={() => setCaseSelectorOpen(false)}
        onSelect={handleFileSelect}
        onCreateNew={handleCreateNewFile}
      />

      {/* 隐藏的文件输入（用于导入） */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* 用例编辑弹窗 */}
      {editingCase && editingCaseData && (
        <CaseEditorDialog
          open={!!editingCase}
          case_={editingCaseData}
          onClose={() => setEditingCase(null)}
          onChange={async (caseId, patch) => {
            // 如果是根用例且修改了名称，同时重命名 JSON 文件
            const isRoot = 'targetPort' in editingCaseData;
            if (isRoot && patch.name && patch.name !== editingCaseData.name && currentFile) {
              const newFileName = patch.name.endsWith('.json') ? patch.name : `${patch.name}.json`;
              const success = await renameFile(currentFile, newFileName);
              if (!success) {
                alert(t('testCase.renameFailed', { error: filesError }));
                return;
              }
            }
            // 更新用例数据
            updateCase(caseId, patch);
          }}
        />
      )}

      {/* 命令编辑弹窗 */}
      {editingCommand && editingCommandData && (
        <CommandEditorDialog
          open={!!editingCommand}
          command={editingCommandData.command}
          caseId={editingCommandData.owner.id}
          testcaseName={currentFile?.replace(/\.json$/, '') ?? ''}
          onClose={() => setEditingCommand(null)}
          onChange={updateCommand}
        />
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          caseId={contextMenu.caseId}
          commandId={contextMenu.commandId}
          isSelected={(() => {
            if (contextMenu.commandId) {
              const found = findCommand(cases, contextMenu.commandId);
              return found?.command.selected ?? false;
            } else {
              const c = findCase(cases, contextMenu.caseId);
              return c?.selected ?? false;
            }
          })()}
          onClose={() => setContextMenu(null)}
          onAddCase={addCase}
          onAddCommand={addCommand}
          onRemoveCase={removeCase}
          onRemoveCommand={removeCommand}
          onToggleSelected={handleToggleSelected}
          onEditCase={handleEditCase}
          onEditCommand={handleEditCommand}
        />
      )}

      {/* 未保存修改确认对话框 */}
      <ConfirmDialog
        open={confirmDialog.open}
        title={t('testCase.unsavedChanges')}
        description={t('testCase.unsavedChangesDesc')}
        onSave={async () => {
          const action = confirmDialog.pendingAction;
          setConfirmDialog({ open: false, pendingAction: null });
          await handleSaveFile();
          action?.();
        }}
        onDiscard={() => {
          const action = confirmDialog.pendingAction;
          setConfirmDialog({ open: false, pendingAction: null });
          markClean();
          action?.();
        }}
        onCancel={() => setConfirmDialog({ open: false, pendingAction: null })}
      />
    </div>
  );
}

// 下载 JSON 文件
function downloadJson(content: string, filename: string) {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
