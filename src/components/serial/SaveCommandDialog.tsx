/**
 * 保存命令到库的多级对话框
 *
 * 流程：选择/新建库 → 选择/输入分类 → 填写描述和示例 → 确认保存
 */

import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { AtCommand } from "@/lib/atCommands";

interface CommandLibJson {
  version: string;
  name: string;
  commands: AtCommand[];
}

interface SaveCommandDialogProps {
  command: string;
  onClose: () => void;
  onSaved: () => void;
}

export function SaveCommandDialog({ command, onClose, onSaved }: SaveCommandDialogProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // 第1步：选择或新建库
  const [libraries, setLibraries] = useState<Array<{ filename: string; data: CommandLibJson }>>([]);
  const [selectedLib, setSelectedLib] = useState<string>("");
  const [newLibName, setNewLibName] = useState("");
  const [isNewLib, setIsNewLib] = useState(false);

  // 第2步：选择或输入分类
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [isNewCategory, setIsNewCategory] = useState(false);

  // 第3步：填写描述和示例
  const [description, setDescription] = useState("");
  const [example, setExample] = useState("");

  // 加载现有库
  useEffect(() => {
    void (async () => {
      try {
        const libs = await invoke<Array<{ filename: string; content: string }>>("load_command_libraries");
        const parsed = libs.map(lib => {
          try {
            return { filename: lib.filename, data: JSON.parse(lib.content) as CommandLibJson };
          } catch {
            return null;
          }
        }).filter((x): x is { filename: string; data: CommandLibJson } => x !== null);

        setLibraries(parsed);
        if (parsed.length > 0) {
          setSelectedLib(parsed[0].filename);
        }
      } catch (e) {
        console.error("Failed to load libraries:", e);
      }
    })();
  }, []);

  // 更新分类列表
  useEffect(() => {
    if (step === 2 && !isNewLib && selectedLib) {
      const lib = libraries.find(l => l.filename === selectedLib);
      if (lib) {
        const cats = Array.from(new Set(lib.data.commands.map(c => c.category)));
        setCategories(cats);
        if (cats.length > 0) {
          setSelectedCategory(cats[0]);
        }
      }
    }
  }, [step, isNewLib, selectedLib, libraries]);

  const handleNext = () => {
    if (step === 1) {
      if (isNewLib && !newLibName.trim()) {
        toast.error(t("commandLib.enterLibName"));
        return;
      }
      if (!isNewLib && !selectedLib) {
        toast.error(t("commandLib.selectLib"));
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (isNewCategory && !newCategory.trim()) {
        toast.error(t("commandLib.enterCategory"));
        return;
      }
      if (!isNewCategory && !selectedCategory) {
        toast.error(t("commandLib.selectCategory"));
        return;
      }
      setStep(3);
    }
  };

  const handleSave = async () => {
    if (!description.trim()) {
      toast.error(t("commandLib.enterDescription"));
      return;
    }

    try {
      const filename = isNewLib ? `${newLibName.trim()}.json` : selectedLib;
      const category = isNewCategory ? newCategory.trim() : selectedCategory;

      let libData: CommandLibJson;

      if (isNewLib) {
        libData = {
          version: "1.0",
          name: newLibName.trim(),
          commands: []
        };
      } else {
        const existing = libraries.find(l => l.filename === filename);
        if (!existing) {
          toast.error(t("commandLib.libNotFound"));
          return;
        }
        libData = existing.data;
      }

      // 检查是否已存在相同命令
      const existingIndex = libData.commands.findIndex(
        c => c.command.toUpperCase() === command.toUpperCase()
      );

      const newCommand: AtCommand = {
        command,
        category,
        description: description.trim(),
        example: example.trim() || undefined
      };

      if (existingIndex >= 0) {
        libData.commands[existingIndex] = newCommand;
      } else {
        libData.commands.push(newCommand);
      }

      await invoke("save_command_library", {
        filename,
        content: JSON.stringify(libData, null, 2)
      });

      toast.success(t("commandLib.saved"));
      onSaved();
      onClose();
    } catch (e) {
      console.error("Failed to save command:", e);
      toast.error(t("commandLib.saveFailed"));
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg shadow-lg w-[480px] max-h-[80vh] flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-sm font-semibold">{t("commandLib.saveCommand")}</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-accent rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="p-4 flex-1 overflow-y-auto space-y-4">
          {/* 显示要保存的命令 */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t("commandLib.command")}</label>
            <div className="mt-1 px-3 py-2 bg-muted rounded text-sm font-mono">{command}</div>
          </div>

          {/* 第1步：选择库 */}
          {step === 1 && (
            <div className="space-y-3">
              <div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={!isNewLib}
                    onChange={() => setIsNewLib(false)}
                  />
                  {t("commandLib.selectExisting")}
                </label>
                {!isNewLib && (
                  <select
                    className="mt-2 w-full px-3 py-2 border rounded-md bg-background text-sm"
                    value={selectedLib}
                    onChange={(e) => setSelectedLib(e.target.value)}
                  >
                    {libraries.map(lib => (
                      <option key={lib.filename} value={lib.filename}>
                        {lib.data.name} ({lib.filename})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={isNewLib}
                    onChange={() => setIsNewLib(true)}
                  />
                  {t("commandLib.createNew")}
                </label>
                {isNewLib && (
                  <input
                    type="text"
                    className="mt-2 w-full px-3 py-2 border rounded-md bg-background text-sm"
                    placeholder={t("commandLib.libNamePlaceholder")}
                    value={newLibName}
                    onChange={(e) => setNewLibName(e.target.value)}
                  />
                )}
              </div>
            </div>
          )}

          {/* 第2步：选择分类 */}
          {step === 2 && (
            <div className="space-y-3">
              {categories.length > 0 && (
                <div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      checked={!isNewCategory}
                      onChange={() => setIsNewCategory(false)}
                    />
                    {t("commandLib.selectCategory")}
                  </label>
                  {!isNewCategory && (
                    <select
                      className="mt-2 w-full px-3 py-2 border rounded-md bg-background text-sm"
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                    >
                      {categories.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              <div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={isNewCategory}
                    onChange={() => setIsNewCategory(true)}
                  />
                  {t("commandLib.newCategory")}
                </label>
                {isNewCategory && (
                  <input
                    type="text"
                    className="mt-2 w-full px-3 py-2 border rounded-md bg-background text-sm"
                    placeholder={t("commandLib.categoryPlaceholder")}
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                  />
                )}
              </div>
            </div>
          )}

          {/* 第3步：填写描述和示例 */}
          {step === 3 && (
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">{t("commandLib.description")} *</label>
                <input
                  type="text"
                  className="mt-1 w-full px-3 py-2 border rounded-md bg-background text-sm"
                  placeholder={t("commandLib.descriptionPlaceholder")}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div>
                <label className="text-sm font-medium">{t("commandLib.example")}</label>
                <input
                  type="text"
                  className="mt-1 w-full px-3 py-2 border rounded-md bg-background text-sm"
                  placeholder={t("commandLib.examplePlaceholder")}
                  value={example}
                  onChange={(e) => setExample(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        {/* 按钮区 */}
        <div className="flex items-center justify-between px-4 py-3 border-t">
          <div className="text-xs text-muted-foreground">
            {t("commandLib.step", { current: step, total: 3 })}
          </div>
          <div className="flex gap-2">
            {step > 1 && (
              <button
                onClick={() => setStep((step - 1) as 1 | 2)}
                className="px-3 py-1.5 text-sm border rounded hover:bg-accent transition-colors"
              >
                {t("commandLib.back")}
              </button>
            )}
            {step < 3 ? (
              <button
                onClick={handleNext}
                className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
              >
                {t("commandLib.next")}
              </button>
            ) : (
              <button
                onClick={handleSave}
                className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
              >
                {t("commandLib.save")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
