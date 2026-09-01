/**
 * 保存命令到库（智能分拣）
 *
 * 精简单步：用户只需选择或新建「目标库」，确认后自动分拣：
 * - 情况A 全局不存在该基础命令 → 目标库新建极简骨架（cmd + 当前输入作为 template）
 * - 情况B 目标库已存在该命令 → 追加当前输入为 template（去重）
 * - 情况C 全局存在但目标库无 → 复制完整命令结构到目标库并追加 template
 * 保存后触发热加载。
 */

import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { AtCommand, CmdTemplate } from "@/lib/atCommands";
import { normalizeCommand } from "@/lib/atCommands";
import { parseBaseCmd, classifyTemplate } from "@/lib/commandTemplate";
import { useCommandLibrary } from "@/stores/commandLibraryStore";

interface CommandLibJson {
  version?: string;
  name?: string;
  commands: unknown[];
}

interface ParsedLib {
  filename: string;
  raw: CommandLibJson;
  /** 归一化后的命令，用于分拣判断 */
  commands: AtCommand[];
}

interface SaveCommandDialogProps {
  command: string;
  onClose: () => void;
  onSaved: () => void;
}

export function SaveCommandDialog({ command, onClose, onSaved }: SaveCommandDialogProps) {
  const { t } = useTranslation();
  const [libraries, setLibraries] = useState<ParsedLib[]>([]);
  const [selectedLib, setSelectedLib] = useState<string>("");
  const [newLibName, setNewLibName] = useState("");
  const [isNewLib, setIsNewLib] = useState(false);
  const [saving, setSaving] = useState(false);

  const findByCmd = useCommandLibrary((s) => s.findByCmd);

  // 归属命令与示例：均为受控输入，预填解析结果但用户可改（不替用户决定）
  const [ownerCmd, setOwnerCmd] = useState("");
  const [exampleContent, setExampleContent] = useState("");
  // 可编辑字段：示例说明 d（始终可编辑）、命令描述与关键词（仅 new 时需用户确认）
  const [tplDesc, setTplDesc] = useState("");
  const [cmdDesc, setCmdDesc] = useState("");
  const [keywords, setKeywords] = useState("");

  // 首次挂载 / 传入命令变化时用解析结果预填（用户可改可清空）
  useEffect(() => {
    const base = parseBaseCmd(command);
    setOwnerCmd(base);
    setExampleContent(command);
    setTplDesc(t(`commandLib.kind${classifyTemplate(command).charAt(0).toUpperCase()}${classifyTemplate(command).slice(1)}`));
    setCmdDesc("");
    setKeywords("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command]);

  const trimmedOwner = ownerCmd.trim();
  // 全局是否已存在该归属命令（跨所有库，取内存合并结果）——随编辑实时重算
  const globalCmd = trimmedOwner ? findByCmd(trimmedOwner) : undefined;

  // 分拣模式：append（目标库已有该命令）/ copy（全局有、目标库无）/ new（全局无）
  const kind = classifyTemplate(exampleContent || command);
  const kindLabel = t(`commandLib.kind${kind.charAt(0).toUpperCase()}${kind.slice(1)}`);
  const inTarget = !isNewLib && !!trimmedOwner && libraries
    .find((l) => l.filename === selectedLib)
    ?.commands.some((c) => c.cmd.toUpperCase() === trimmedOwner.toUpperCase());
  const mode: "append" | "copy" | "new" = inTarget ? "append" : globalCmd ? "copy" : "new";

  useEffect(() => {
    void (async () => {
      try {
        const libs = await invoke<Array<{ filename: string; content: string }>>("load_command_libraries");
        const parsed = libs
          .map((lib) => {
            try {
              const raw = JSON.parse(lib.content) as CommandLibJson;
              const commands = (raw.commands ?? [])
                .map((c) => normalizeCommand(c))
                .filter((c): c is AtCommand => c !== null);
              return { filename: lib.filename, raw, commands };
            } catch {
              return null;
            }
          })
          .filter((x): x is ParsedLib => x !== null);
        setLibraries(parsed);
        if (parsed.length > 0) setSelectedLib(parsed[0].filename);
        else setIsNewLib(true);
      } catch (e) {
        console.error("Failed to load libraries:", e);
      }
    })();
  }, []);

  // 智能分拣保存
  const handleSave = async () => {
    if (isNewLib && !newLibName.trim()) {
      toast.error(t("commandLib.enterLibName"));
      return;
    }
    if (!isNewLib && !selectedLib) {
      toast.error(t("commandLib.selectLib"));
      return;
    }
    if (!trimmedOwner) {
      toast.error(t("commandLib.cmdRequired"));
      return;
    }
    const exampleS = exampleContent.trim();
    if (!exampleS) {
      toast.error(t("commandLib.exampleRequired"));
      return;
    }

    setSaving(true);
    try {
      const filename = isNewLib ? `${newLibName.trim()}.json` : selectedLib;
      // 示例说明留空则回退到「用户补充」默认
      const tplD = tplDesc.trim() || t("commandLib.userAddedTemplate");
      const newTemplate: CmdTemplate = { s: exampleS, d: tplD };
      const parsedKeywords = keywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);

      // 目标库：新建或取现有
      let target: ParsedLib;
      if (isNewLib) {
        target = { filename, raw: { name: newLibName.trim(), commands: [] }, commands: [] };
      } else {
        const existing = libraries.find((l) => l.filename === filename);
        if (!existing) {
          toast.error(t("commandLib.libNotFound"));
          setSaving(false);
          return;
        }
        // 深拷贝 raw 以便修改后写回
        target = { ...existing, raw: JSON.parse(JSON.stringify(existing.raw)) as CommandLibJson };
      }

      const rawCommands = target.raw.commands as Record<string, unknown>[];
      // 目标库内查找该归属命令（用归一化后的 cmd 比较）
      const idxInTarget = target.commands.findIndex((c) => c.cmd.toUpperCase() === trimmedOwner.toUpperCase());

      if (idxInTarget >= 0) {
        // 情况B：目标库已有 → 追加示例（去重）
        const entry = rawCommands[idxInTarget];
        const templates = Array.isArray(entry.templates) ? (entry.templates as Record<string, unknown>[]) : [];
        const dup = templates.some((tpl) => tpl.s === exampleS);
        if (dup) {
          toast.info(t("commandLib.templateExists"));
          setSaving(false);
          return;
        }
        templates.push({ s: newTemplate.s, d: newTemplate.d });
        entry.templates = templates;
      } else if (globalCmd) {
        // 情况C：全局有但目标库无 → 复制完整结构 + 追加示例
        const copy: AtCommand = JSON.parse(JSON.stringify(globalCmd));
        if (!copy.templates.some((tpl) => tpl.s === exampleS)) copy.templates.push(newTemplate);
        rawCommands.push({ cmd: copy.cmd, desc: copy.desc, keywords: copy.keywords, templates: copy.templates });
      } else {
        // 情况A：全局不存在 → 新建骨架（示例原样作 template，描述/关键词用解析确认值，可空）
        rawCommands.push({
          cmd: trimmedOwner,
          desc: cmdDesc.trim() || t("commandLib.userCustomCommand"),
          keywords: parsedKeywords,
          templates: [{ s: exampleS, d: newTemplate.d }],
        });
      }

      await invoke("save_command_library", {
        filename,
        content: JSON.stringify(target.raw, null, 2),
      });

      toast.success(t("commandLib.saved"));
      onSaved();
      onClose();
    } catch (e) {
      console.error("Failed to save command:", e);
      toast.error(t("commandLib.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  // 分拣结果预览文案（复用上方已算出的 mode）
  const dispositionHint =
    mode === "append"
      ? t("commandLib.dispAppend", { cmd: trimmedOwner })
      : mode === "copy"
      ? t("commandLib.dispCopy", { cmd: trimmedOwner })
      : t("commandLib.dispNew", { cmd: trimmedOwner });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg shadow-lg w-[440px] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-sm font-semibold">{t("commandLib.saveCommand")}</h2>
          <button onClick={onClose} className="p-1 hover:bg-accent rounded transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* 归属命令（自动解析预填，可修改；决定分拣去向） */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t("commandLib.ownerCmd")}</label>
            <input
              type="text"
              className="mt-1 w-full px-3 py-2 border rounded-md bg-background text-sm font-mono"
              value={ownerCmd}
              onChange={(e) => setOwnerCmd(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{t("commandLib.ownerCmdHint")}</p>
          </div>

          {/* 示例（用户输入原文，可改为占位符形式；作为该命令下一条 template.s） */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t("commandLib.exampleContent")}</label>
            <input
              type="text"
              className="mt-1 w-full px-3 py-2 border rounded-md bg-background text-sm font-mono"
              value={exampleContent}
              onChange={(e) => setExampleContent(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{t("commandLib.exampleContentHint")}</p>
          </div>

          {/* 示例说明（始终可编辑，预填解析类型，可留空） */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              {t("commandLib.templateDesc")}
              {t("commandLib.optional")}
            </label>
            <input
              type="text"
              className="mt-1 w-full px-3 py-2 border rounded-md bg-background text-sm"
              placeholder={kindLabel}
              value={tplDesc}
              onChange={(e) => setTplDesc(e.target.value)}
            />
          </div>

          {/* 新建命令时的额外字段：命令描述 + 关键词（尝试解析，可留空） */}
          {mode === "new" && (
            <div className="space-y-2 border rounded-md p-3 bg-secondary/20">
              <div className="text-xs font-medium text-muted-foreground">{t("commandLib.newCmdFields")}</div>
              <input
                type="text"
                className="w-full px-3 py-2 border rounded-md bg-background text-sm"
                placeholder={t("commandLib.cmdDescPlaceholder")}
                value={cmdDesc}
                onChange={(e) => setCmdDesc(e.target.value)}
              />
              <input
                type="text"
                className="w-full px-3 py-2 border rounded-md bg-background text-sm"
                placeholder={t("commandLib.keywordsPlaceholder")}
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
              />
            </div>
          )}

          {/* 目标库选择 */}
          <div className="space-y-2">
            {libraries.length > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={!isNewLib} onChange={() => setIsNewLib(false)} />
                {t("commandLib.selectExisting")}
              </label>
            )}
            {!isNewLib && libraries.length > 0 && (
              <select
                className="w-full px-3 py-2 border rounded-md bg-background text-sm"
                value={selectedLib}
                onChange={(e) => setSelectedLib(e.target.value)}
              >
                {libraries.map((lib) => (
                  <option key={lib.filename} value={lib.filename}>
                    {lib.raw.name || lib.filename} ({lib.filename})
                  </option>
                ))}
              </select>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={isNewLib} onChange={() => setIsNewLib(true)} />
              {t("commandLib.createNew")}
            </label>
            {isNewLib && (
              <input
                type="text"
                className="w-full px-3 py-2 border rounded-md bg-background text-sm"
                placeholder={t("commandLib.libNamePlaceholder")}
                value={newLibName}
                onChange={(e) => setNewLibName(e.target.value)}
                autoFocus
              />
            )}
          </div>

          {/* 分拣结果预览 */}
          <div className="text-xs text-muted-foreground bg-secondary/30 rounded px-3 py-2">
            {dispositionHint}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm border rounded hover:bg-accent transition-colors"
          >
            {t("commandLib.back")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {t("commandLib.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
