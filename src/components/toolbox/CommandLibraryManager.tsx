/**
 * 命令库管理工具（工具箱内）
 *
 * 功能：查看、编辑、删除命令库中的命令，管理库文件
 */

import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Search, Plus, Trash2, Edit2, RefreshCw, Database, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useCommandLibrary } from "@/stores/commandLibraryStore";
import type { AtCommand } from "@/lib/atCommands";

interface CommandLibJson {
  version: string;
  name: string;
  commands: AtCommand[];
}

interface LibraryFile {
  filename: string;
  data: CommandLibJson;
}

/** 命令的来源引用：跨库展示时用于精确定位回原库文件 */
interface CommandRef {
  cmd: AtCommand;
  filename: string;  // 所属库文件名
  libName: string;   // 库显示名（标签用）
  index: number;     // 在该库 commands 数组中的真实索引
}

/** "全部命令"视图的哨兵值 */
const ALL_LIBS = "__all__";

const CommandLibraryManager = () => {
  const { t } = useTranslation();
  const refresh = useCommandLibrary((s) => s.refresh);

  const [libraries, setLibraries] = useState<LibraryFile[]>([]);
  const [selectedLib, setSelectedLib] = useState<string>(ALL_LIBS);
  const [search, setSearch] = useState("");
  const [editingCommand, setEditingCommand] = useState<{ libFile: string; index: number; command: AtCommand } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  // 全部视图下新增命令时的目标库
  const [createTargetLib, setCreateTargetLib] = useState<string>("");

  // 加载库文件列表
  const loadLibraries = async () => {
    try {
      const libs = await invoke<Array<{ filename: string; content: string }>>("load_command_libraries");
      const parsed = libs.map(lib => {
        try {
          return { filename: lib.filename, data: JSON.parse(lib.content) as CommandLibJson };
        } catch {
          return null;
        }
      }).filter((x): x is LibraryFile => x !== null);

      setLibraries(parsed);
    } catch (e) {
      console.error("Failed to load libraries:", e);
      toast.error(t("commandLib.loadFailed"));
    }
  };

  useEffect(() => {
    void loadLibraries();
  }, []);

  const isAllView = selectedLib === ALL_LIBS;

  // 当前视图的命令列表（全部视图=所有库聚合，单库视图=该库），每条携带来源引用
  const currentRefs = useMemo<CommandRef[]>(() => {
    const source = isAllView
      ? libraries
      : libraries.filter(l => l.filename === selectedLib);
    const refs: CommandRef[] = [];
    for (const lib of source) {
      lib.data.commands.forEach((cmd, index) => {
        refs.push({ cmd, filename: lib.filename, libName: lib.data.name, index });
      });
    }
    return refs;
  }, [isAllView, selectedLib, libraries]);

  // 搜索过滤
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return currentRefs;
    return currentRefs.filter(
      (r) =>
        r.cmd.command.toLowerCase().includes(q) ||
        r.cmd.description.toLowerCase().includes(q) ||
        r.cmd.category.toLowerCase().includes(q)
    );
  }, [search, currentRefs]);

  // 保存库文件
  const saveLibrary = async (filename: string, data: CommandLibJson) => {
    try {
      await invoke("save_command_library", {
        filename,
        content: JSON.stringify(data, null, 2)
      });
      await loadLibraries();
      await refresh();
      toast.success(t("commandLib.saved"));
    } catch (e) {
      console.error("Failed to save library:", e);
      toast.error(t("commandLib.saveFailed"));
    }
  };

  // 删除命令
  const deleteCommand = async (libFile: string, index: number) => {
    const lib = libraries.find(l => l.filename === libFile);
    if (!lib) return;

    const newCommands = [...lib.data.commands];
    newCommands.splice(index, 1);

    const newData = { ...lib.data, commands: newCommands };
    await saveLibrary(libFile, newData);
  };

  // 更新命令
  const updateCommand = async (libFile: string, index: number, newCommand: AtCommand) => {
    const lib = libraries.find(l => l.filename === libFile);
    if (!lib) return;

    const newCommands = [...lib.data.commands];
    newCommands[index] = newCommand;

    const newData = { ...lib.data, commands: newCommands };
    await saveLibrary(libFile, newData);
    setEditingCommand(null);
  };

  // 新增命令
  const createCommand = async (newCommand: AtCommand) => {
    const targetLib = isAllView ? createTargetLib : selectedLib;
    if (!targetLib || targetLib === ALL_LIBS) {
      toast.error(t("commandLib.selectLib"));
      return;
    }

    const lib = libraries.find(l => l.filename === targetLib);
    if (!lib) return;

    const newData = {
      ...lib.data,
      commands: [...lib.data.commands, newCommand]
    };

    await saveLibrary(targetLib, newData);
    setIsCreating(false);
    setCreateTargetLib("");
  };

  // 删除库文件
  const deleteLibrary = async (filename: string) => {
    if (!confirm(t("commandLib.confirmDeleteLib", { name: filename }))) return;

    try {
      await invoke("delete_command_library", { filename });
      await loadLibraries();
      await refresh();
      toast.success(t("commandLib.libDeleted"));
      if (selectedLib === filename) {
        setSelectedLib(ALL_LIBS);
      }
    } catch (e) {
      console.error("Failed to delete library:", e);
      toast.error(t("commandLib.deleteFailed"));
    }
  };

  return (
    <div className="flex h-full">
      {/* 左侧：库列表 */}
      <div className="w-56 border-r bg-muted/20 flex flex-col">
        <div className="p-3 border-b">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">{t("commandLib.libraries")}</h3>
            <button
              onClick={() => void loadLibraries()}
              className="p-1 hover:bg-accent rounded transition-colors"
              title={t("common.refresh")}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {libraries.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-4">
              {t("commandLib.noLibraries")}
            </div>
          ) : (
            <div className="space-y-1">
              {/* 全部命令 */}
              <button
                onClick={() => setSelectedLib(ALL_LIBS)}
                className={`
                  w-full px-2 py-1.5 text-xs text-left rounded transition-colors flex items-center gap-2
                  ${selectedLib === ALL_LIBS
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted text-foreground"
                  }
                `}
              >
                <Database className="w-3 h-3 shrink-0" />
                <div>
                  <div className="font-medium">{t("commandLib.allCommands")}</div>
                  <div className="text-[10px] opacity-70">
                    {currentRefs.length} {t("commandLib.commands")}
                  </div>
                </div>
              </button>

              <div className="h-px bg-border my-1" />

              {libraries.map(lib => (
                <div key={lib.filename} className="group">
                  <button
                    onClick={() => setSelectedLib(lib.filename)}
                    className={`
                      w-full px-2 py-1.5 text-xs text-left rounded transition-colors flex items-center justify-between
                      ${selectedLib === lib.filename
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted text-foreground"
                      }
                    `}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Database className="w-3 h-3 shrink-0" />
                      <div className="truncate">
                        <div className="font-medium truncate">{lib.data.name}</div>
                        <div className="text-[10px] opacity-70">{lib.data.commands.length} {t("commandLib.commands")}</div>
                      </div>
                    </div>
                    {selectedLib === lib.filename && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteLibrary(lib.filename);
                        }}
                        className="p-0.5 hover:bg-destructive/20 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                        title={t("commandLib.deleteLib")}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 右侧：命令列表 */}
      <div className="flex-1 flex flex-col">
        {libraries.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            <div className="text-center">
              <AlertCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>{t("commandLib.noLibraries")}</p>
            </div>
          </div>
        ) : (
          <>
            {/* 搜索栏 */}
            <div className="p-4 border-b space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">
                  {isAllView
                    ? t("commandLib.allCommands")
                    : libraries.find(l => l.filename === selectedLib)?.data.name
                  }
                </h3>
                <button
                  onClick={() => {
                    setIsCreating(true);
                    if (isAllView && libraries.length > 0) {
                      setCreateTargetLib(libraries[0].filename);
                    }
                  }}
                  className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors flex items-center gap-1.5"
                >
                  <Plus className="w-3 h-3" />
                  {t("commandLib.addCommand")}
                </button>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("commandLib.searchPlaceholder")}
                  className="w-full h-9 pl-9 pr-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="text-xs text-muted-foreground">
                {t("commandLib.showing", { count: filtered.length, total: currentRefs.length })}
              </div>
            </div>

            {/* 命令列表 */}
            <div className="flex-1 overflow-y-auto p-4">
              {filtered.length === 0 ? (
                <div className="text-sm text-muted-foreground py-8 text-center">
                  {search ? t("commandLib.noResults") : t("commandLib.noCommands")}
                </div>
              ) : (
                <div className="space-y-2">
                  {filtered.map((ref, idx) => {
                    const isEditing = editingCommand?.libFile === ref.filename && editingCommand?.index === ref.index;

                    if (isEditing) {
                      return (
                        <CommandEditor
                          key={`${ref.cmd.command}-${idx}`}
                          command={editingCommand.command}
                          onSave={(updated) => void updateCommand(ref.filename, ref.index, updated)}
                          onCancel={() => setEditingCommand(null)}
                        />
                      );
                    }

                    return (
                      <div
                        key={`${ref.cmd.command}-${idx}`}
                        className="p-3 rounded-md border border-input bg-muted/20 hover:bg-muted/40 transition-colors group"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <code className="text-sm font-mono font-semibold">{ref.cmd.command}</code>
                              <span className="text-xs px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                                {ref.cmd.category}
                              </span>
                              {/* 全部视图下显示所属库标签 */}
                              {isAllView && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                                  {ref.libName}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mb-1">{ref.cmd.description}</p>
                            {ref.cmd.example && (
                              <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                {ref.cmd.example}
                              </code>
                            )}
                          </div>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => setEditingCommand({ libFile: ref.filename, index: ref.index, command: ref.cmd })}
                              className="p-1.5 hover:bg-accent rounded transition-colors"
                              title={t("commandLib.edit")}
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => void deleteCommand(ref.filename, ref.index)}
                              className="p-1.5 hover:bg-destructive/20 text-destructive rounded transition-colors"
                              title={t("commandLib.delete")}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* 新建命令表单 */}
        {isCreating && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-background border rounded-lg shadow-lg w-[480px]">
              <CommandEditor
                command={{ command: "", category: "general", description: "", example: "" }}
                onSave={(cmd) => void createCommand(cmd)}
                onCancel={() => {
                  setIsCreating(false);
                  setCreateTargetLib("");
                }}
                isNew
                targetLibSelector={isAllView ? {
                  libraries: libraries.map(l => ({ filename: l.filename, name: l.data.name })),
                  value: createTargetLib,
                  onChange: setCreateTargetLib,
                } : undefined}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// 命令编辑器组件
interface CommandEditorProps {
  command: AtCommand;
  onSave: (command: AtCommand) => void;
  onCancel: () => void;
  isNew?: boolean;
  targetLibSelector?: {
    libraries: Array<{ filename: string; name: string }>;
    value: string;
    onChange: (filename: string) => void;
  };
}

const CommandEditor = ({ command, onSave, onCancel, isNew, targetLibSelector }: CommandEditorProps) => {
  const { t } = useTranslation();
  const [cmd, setCmd] = useState(command.command);
  const [category, setCategory] = useState(command.category);
  const [description, setDescription] = useState(command.description);
  const [example, setExample] = useState(command.example || "");

  const handleSave = () => {
    if (!cmd.trim() || !description.trim()) {
      toast.error(t("commandLib.fillRequired"));
      return;
    }

    if (targetLibSelector && !targetLibSelector.value) {
      toast.error(t("commandLib.selectLib"));
      return;
    }

    onSave({
      command: cmd.trim(),
      category: category.trim(),
      description: description.trim(),
      example: example.trim() || undefined
    });
  };

  return (
    <div className={isNew ? "p-4" : "p-3 rounded-md border border-primary bg-muted/40"}>
      {isNew && (
        <h3 className="text-sm font-semibold mb-3">{t("commandLib.newCommand")}</h3>
      )}
      <div className="space-y-2">
        {/* 全部视图下新增时选择目标库 */}
        {targetLibSelector && (
          <div>
            <label className="text-xs font-medium">{t("commandLib.targetLib")} *</label>
            <select
              value={targetLibSelector.value}
              onChange={(e) => targetLibSelector.onChange(e.target.value)}
              className="mt-1 w-full px-2 py-1.5 text-sm border rounded-md bg-background"
            >
              {targetLibSelector.libraries.map(lib => (
                <option key={lib.filename} value={lib.filename}>
                  {lib.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="text-xs font-medium">{t("commandLib.command")} *</label>
          <input
            type="text"
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            placeholder="AT+CSQ"
            className="mt-1 w-full px-2 py-1.5 text-sm border rounded-md bg-background font-mono"
          />
        </div>

        <div>
          <label className="text-xs font-medium">{t("commandLib.category")} *</label>
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="general"
            className="mt-1 w-full px-2 py-1.5 text-sm border rounded-md bg-background"
          />
        </div>

        <div>
          <label className="text-xs font-medium">{t("commandLib.description")} *</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("commandLib.descriptionPlaceholder")}
            className="mt-1 w-full px-2 py-1.5 text-sm border rounded-md bg-background"
          />
        </div>

        <div>
          <label className="text-xs font-medium">{t("commandLib.example")}</label>
          <input
            type="text"
            value={example}
            onChange={(e) => setExample(e.target.value)}
            placeholder={t("commandLib.examplePlaceholder")}
            className="mt-1 w-full px-2 py-1.5 text-sm border rounded-md bg-background font-mono text-xs"
          />
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleSave}
            className="flex-1 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
          >
            {t("commandLib.save")}
          </button>
          <button
            onClick={onCancel}
            className="flex-1 px-3 py-1.5 text-sm border rounded hover:bg-accent transition-colors"
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CommandLibraryManager;
