import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, Pencil } from "lucide-react";
import { useProtocolStore } from "../../../stores/protocolStore";
import { BUILTIN_PROTOCOLS } from "../../../lib/nativeProtocols";

interface ProtocolSelectProps {
  onEdit: () => void;
}

/** 协议选择条：内置预设置顶（不可编辑/删除）+ 用户协议 + 新建/编辑/删除。 */
export const ProtocolSelect = ({ onEdit }: ProtocolSelectProps) => {
  const { t } = useTranslation();
  const userProtocols = useProtocolStore((s) => s.protocols);
  const activeId = useProtocolStore((s) => s.activeId);
  const setActive = useProtocolStore((s) => s.setActive);
  const addProtocol = useProtocolStore((s) => s.addProtocol);
  const deleteProtocol = useProtocolStore((s) => s.deleteProtocol);

  const all = useMemo(() => [...BUILTIN_PROTOCOLS, ...userProtocols], [userProtocols]);
  const active = all.find((p) => p.id === activeId) ?? null;
  const isBuiltin = !!active?.builtin;

  const handleAdd = () => {
    const name = window.prompt(t("toolbox.protoNamePrompt"));
    if (name && name.trim()) {
      addProtocol(name.trim());
      onEdit();
    }
  };

  const handleDelete = () => {
    if (!activeId || isBuiltin) return;
    if (window.confirm(t("toolbox.protoDeleteConfirm"))) deleteProtocol(activeId);
  };

  return (
    <div className="flex items-center gap-2">
      <select
        value={activeId ?? ""}
        onChange={(e) => setActive(e.target.value || null)}
        className="h-9 px-2 text-sm rounded-md border border-input bg-background min-w-[12rem]"
      >
        <option value="">{t("toolbox.protoNone")}</option>
        <optgroup label={t("toolbox.protoBuiltinGroup")}>
          {BUILTIN_PROTOCOLS.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </optgroup>
        {userProtocols.length > 0 && (
          <optgroup label={t("toolbox.protoUserGroup")}>
            {userProtocols.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </optgroup>
        )}
      </select>
      <button onClick={handleAdd} title={t("toolbox.protoNew")} aria-label={t("toolbox.protoNew")} className="h-9 px-2 rounded-md border border-input hover:bg-muted disabled:opacity-40">
        <Plus className="w-4 h-4" />
      </button>
      <button onClick={onEdit} disabled={!activeId || isBuiltin} title={t("toolbox.protoEdit")} className="h-9 px-2 rounded-md border border-input hover:bg-muted disabled:opacity-40">
        <Pencil className="w-4 h-4" />
      </button>
      <button onClick={handleDelete} disabled={!activeId || isBuiltin} title={t("toolbox.protoDelete")} className="h-9 px-2 rounded-md border border-input hover:bg-muted text-destructive disabled:opacity-40">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
};
