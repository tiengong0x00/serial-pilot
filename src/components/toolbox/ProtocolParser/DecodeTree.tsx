import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, ChevronDown, AlertTriangle, Copy } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { ParsedNode } from "../../../lib/dsl";

interface DecodeTreeProps {
  nodes: ParsedNode[];
  activeId: string | null;
  onSelect: (node: ParsedNode) => void;
}

interface FlatRow {
  node: ParsedNode;
  depth: number;
  hasChildren: boolean;
  open: boolean;
}

const rangeLabel = (node: ParsedNode): string => {
  if (node.byteEnd <= node.byteStart) return "";
  if (node.bitLen != null) return node.byteStart + " ·" + node.bitOffset + "+" + node.bitLen + "b";
  return node.byteStart + ".." + (node.byteEnd - 1);
};

// 组节点摘要：子节点数 + 字节范围
const groupSummary = (node: ParsedNode): string => {
  const count = node.children?.length ?? 0;
  const span = node.byteEnd > node.byteStart ? " · " + (node.byteEnd - node.byteStart) + "B" : "";
  return count + " fields" + span;
};

/** 解码树：整列展示解析结果，支持全部展开/折叠、逐行复制，与 hexdump 联动。 */
export const DecodeTree = ({ nodes, activeId, onSelect }: DecodeTreeProps) => {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const activeRef = useRef<HTMLDivElement | null>(null);

  // 计算可见行（跳过已折叠节点的子孙），实现真正的列对齐
  const rows = useMemo<FlatRow[]>(() => {
    const out: FlatRow[] = [];
    const walk = (ns: ParsedNode[], depth: number) => {
      for (const n of ns) {
        const hasChildren = !!n.children && n.children.length > 0;
        const open = hasChildren && !collapsed.has(n.id);
        out.push({ node: n, depth, hasChildren, open });
        if (open) walk(n.children!, depth + 1);
      }
    };
    walk(nodes, 0);
    return out;
  }, [nodes, collapsed]);

  useEffect(() => {
    if (activeId && activeRef.current) activeRef.current.scrollIntoView({ block: "nearest" });
  }, [activeId, rows]);

  if (nodes.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">—</div>;
  }

  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => {
    const all = new Set<string>();
    const walk = (ns: ParsedNode[]) => {
      for (const n of ns) {
        if (n.children && n.children.length > 0) {
          all.add(n.id);
          walk(n.children);
        }
      }
    };
    walk(nodes);
    setCollapsed(all);
  };

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const copyValue = (node: ParsedNode) => {
    const text = node.isGroup ? node.rawHex ?? "" : String(node.value ?? "");
    navigator.clipboard?.writeText(text);
    toast.success(t("toolbox.protoCopied"));
  };

  return (
    <div className="flex flex-col h-full">
      {/* 工具条 */}
      <div className="flex items-center gap-2 px-2 py-1 border-b border-border/50 shrink-0">
        <button onClick={expandAll} className="text-[11px] px-1.5 py-0.5 rounded hover:bg-muted text-muted-foreground">
          {t("toolbox.protoExpandAll")}
        </button>
        <button onClick={collapseAll} className="text-[11px] px-1.5 py-0.5 rounded hover:bg-muted text-muted-foreground">
          {t("toolbox.protoCollapseAll")}
        </button>
      </div>

      {/* 行列表 */}
      <div className="flex-1 min-h-0 overflow-auto p-1">
        {rows.map(({ node, depth, hasChildren, open }) => {
          const active = node.id === activeId;
          const range = rangeLabel(node);
          return (
            <div
              key={node.id}
              ref={active ? activeRef : undefined}
              onClick={() => onSelect(node)}
              className={
                "group grid items-center gap-x-2 py-0.5 pr-1 cursor-pointer rounded-sm text-sm " +
                (active ? "bg-primary/15" : "hover:bg-muted")
              }
              style={{ gridTemplateColumns: "minmax(7rem,1.5fr) minmax(3rem,auto) minmax(0,2fr) auto auto" }}
            >
              {/* 列1：名称（缩进 + 折叠箭头） */}
              <div className="flex items-center gap-1 min-w-0" style={{ paddingLeft: depth * 14 }}>
                <span
                  className="w-4 shrink-0 text-muted-foreground"
                  onClick={(e) => { e.stopPropagation(); if (hasChildren) toggle(node.id); }}
                >
                  {hasChildren ? (open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />) : null}
                </span>
                <span className={"font-medium truncate " + (node.error ? "text-destructive" : "")}>{node.name}</span>
              </div>

              {/* 列2：类型 */}
              <div className="text-xs text-muted-foreground truncate">{node.typeLabel}</div>

              {/* 列3：值（+含义）或组摘要 */}
              <div className={"font-mono text-xs truncate " + (node.error ? "text-destructive" : "text-foreground")}>
                {node.isGroup ? (
                  <span className="text-muted-foreground">{groupSummary(node)}</span>
                ) : (
                  <>
                    {node.value}
                    {node.meaning ? <span className="text-muted-foreground"> ({node.meaning})</span> : null}
                  </>
                )}
              </div>

              {/* 列4：告警图标（tooltip）+ 复制按钮 */}
              <div className="flex items-center gap-1 shrink-0">
                {node.warning && (
                  <span title={node.warning} className="inline-flex">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  </span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); copyValue(node); }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                  title={t("toolbox.protoCopyValue")}
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>

              {/* 列5：字节范围 */}
              <div className="font-mono text-[10px] text-muted-foreground shrink-0 text-right min-w-[3.5rem]">
                {range && "@" + range}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
