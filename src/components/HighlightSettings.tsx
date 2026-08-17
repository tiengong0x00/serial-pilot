import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { useHighlightStore } from "@/stores/highlightStore";
import { clearRegexCache } from "@/lib/highlightMatcher";
import type { HighlightRule, HighlightMatchType } from "@/types/terminal";

const DEFAULT_STYLE = { color: "#ff5555", backgroundColor: "", fontWeight: "normal" as const, fontStyle: "normal" as const };

/** 校验正则是否合法 */
function isValidRegex(pattern: string): boolean {
  if (!pattern) return true;
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/** 单条规则编辑行 */
function RuleRow({ rule, index, total }: { rule: HighlightRule; index: number; total: number }) {
  const { t } = useTranslation();
  const { updateRule, deleteRule, reorderRules, toggleRule } = useHighlightStore();

  const patch = (updates: Partial<HighlightRule>) => {
    clearRegexCache();
    updateRule(rule.id, updates);
  };

  const patchStyle = (s: Partial<HighlightRule["style"]>) => {
    updateRule(rule.id, { style: { ...rule.style, ...s } });
  };

  const regexInvalid = rule.matchType === "regex" && !isValidRegex(rule.pattern);

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 bg-muted/20">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={() => toggleRule(rule.id)}
          className="h-4 w-4"
          title={t("settings.highlightEnabled")}
        />
        <input
          type="text"
          value={rule.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder={t("settings.highlightRuleNamePlaceholder")}
          className="flex-1 h-8 px-2 text-sm rounded border bg-background"
        />
        <button
          onClick={() => index > 0 && reorderRules(index, index - 1)}
          disabled={index === 0}
          className="p-1 rounded hover:bg-muted disabled:opacity-30"
          title={t("settings.highlightMoveUp")}
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          onClick={() => index < total - 1 && reorderRules(index, index + 1)}
          disabled={index === total - 1}
          className="p-1 rounded hover:bg-muted disabled:opacity-30"
          title={t("settings.highlightMoveDown")}
        >
          <ChevronDown className="h-4 w-4" />
        </button>
        <button
          onClick={() => deleteRule(rule.id)}
          className="p-1 rounded hover:bg-destructive/10 text-destructive"
          title={t("settings.highlightDelete")}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <select
          value={rule.matchType}
          onChange={(e) => patch({ matchType: e.target.value as HighlightMatchType })}
          className="h-8 px-2 text-sm rounded border bg-background"
        >
          <option value="text">{t("settings.highlightMatchText")}</option>
          <option value="regex">{t("settings.highlightMatchRegex")}</option>
        </select>
        <input
          type="text"
          value={rule.pattern}
          onChange={(e) => patch({ pattern: e.target.value })}
          placeholder={
            rule.matchType === "regex"
              ? t("settings.highlightPatternRegexPlaceholder")
              : t("settings.highlightPatternTextPlaceholder")
          }
          className={`flex-1 h-8 px-2 text-sm rounded border bg-background font-mono ${
            regexInvalid ? "border-destructive" : ""
          }`}
        />
      </div>
      {regexInvalid && (
        <p className="text-xs text-destructive">{t("settings.highlightInvalidRegex")}</p>
      )}

      <div className="flex items-center gap-3 flex-wrap text-sm">
        {rule.matchType === "text" && (
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={rule.caseSensitive ?? false}
              onChange={(e) => patch({ caseSensitive: e.target.checked })}
              className="h-4 w-4"
            />
            {t("settings.highlightCaseSensitive")}
          </label>
        )}
        <label className="flex items-center gap-1.5">
          {t("settings.highlightColor")}
          <input
            type="color"
            value={rule.style.color || "#000000"}
            onChange={(e) => patchStyle({ color: e.target.value })}
            className="h-7 w-9 rounded border cursor-pointer"
          />
        </label>
        <label className="flex items-center gap-1.5">
          {t("settings.highlightBgColor")}
          <input
            type="color"
            value={rule.style.backgroundColor || "#ffffff"}
            onChange={(e) => patchStyle({ backgroundColor: e.target.value })}
            className="h-7 w-9 rounded border cursor-pointer"
          />
          <button
            onClick={() => patchStyle({ backgroundColor: "" })}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            {t("settings.highlightColorNone")}
          </button>
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={rule.style.fontWeight === "bold"}
            onChange={(e) => patchStyle({ fontWeight: e.target.checked ? "bold" : "normal" })}
            className="h-4 w-4"
          />
          {t("settings.highlightBold")}
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={rule.style.fontStyle === "italic"}
            onChange={(e) => patchStyle({ fontStyle: e.target.checked ? "italic" : "normal" })}
            className="h-4 w-4"
          />
          {t("settings.highlightItalic")}
        </label>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t("settings.highlightPreview")}:</span>
        <span
          className="font-mono px-1"
          style={{
            color: rule.style.color || undefined,
            backgroundColor: rule.style.backgroundColor || undefined,
            fontWeight: rule.style.fontWeight === "bold" ? "bold" : undefined,
            fontStyle: rule.style.fontStyle === "italic" ? "italic" : undefined,
          }}
        >
          {t("settings.highlightPreviewText")}
        </span>
      </div>
    </div>
  );
}

/** 高亮设置面板 */
export function HighlightSettings() {
  const { t } = useTranslation();
  const rules = useHighlightStore((s) => s.rules);
  const addRule = useHighlightStore((s) => s.addRule);
  const [, forceRender] = useState(0);

  const handleAdd = () => {
    addRule({
      enabled: true,
      name: "",
      matchType: "text",
      pattern: "",
      caseSensitive: false,
      style: { ...DEFAULT_STYLE },
    });
    forceRender((n) => n + 1);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t("settings.highlightDesc")}</p>
        <button
          onClick={handleAdd}
          className="flex items-center gap-1.5 h-8 px-3 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          {t("settings.highlightAddRule")}
        </button>
      </div>

      {rules.length === 0 ? (
        <div className="text-sm text-muted-foreground/60 text-center py-8 border border-dashed rounded-md">
          {t("settings.highlightNoRules")}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {rules.map((rule, i) => (
            <RuleRow key={rule.id} rule={rule} index={i} total={rules.length} />
          ))}
        </div>
      )}
    </div>
  );
}
