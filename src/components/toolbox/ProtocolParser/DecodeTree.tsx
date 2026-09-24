import { useEffect, useRef } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { useState } from "react";
import type { ParsedNode } from "../../../lib/protocolParser";

interface DecodeTreeProps {
  nodes: ParsedNode[];
  activeId: string | null;
  onSelect: (node: ParsedNode) => void;
}

/** 单个树节点（可递归） */
const TreeRow = ({
  node,
  depth,
  activeId,
  onSelect,
}: {
  node: ParsedNode;
  depth: number;
  activeId: string | null;
  onSelect: (node: ParsedNode) => void;
}) => {
  const [open, setOpen] = useState(true);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const hasChildren = !!node.children && node.children.length > 0;
  const active = node.id === activeId;

  useEffect(() => {
    if (active && rowRef.current) {
      rowRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [active]);

  const range =
    node.byteEnd > node.byteStart
      ? node.bitLen != null
        ? node.byteStart + " ·" + node.bitOffset + "+" + node.bitLen + "b"
        : node.byteStart + ".." + (node.byteEnd - 1)
      : "";

  return (
    <>
      <div
        ref={rowRef}
        onClick={() => onSelect(node)}
        className={"flex items-center gap-1 py-0.5 pr-2 cursor-pointer rounded-sm text-sm " + (active ? "bg-primary/15" : "hover:bg-muted")}
        style={{ paddingLeft: depth * 14 + 4 }}
      >
        <span
          className="w-4 shrink-0 text-muted-foreground"
          onClick={(e) => { e.stopPropagation(); if (hasChildren) setOpen((o) => !o); }}
        >
          {hasChildren ? (open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />) : null}
        </span>
        <span className={"font-medium " + (node.error ? "text-destructive" : "")}>{node.name}</span>
        <span className="text-xs text-muted-foreground">: {node.typeLabel}</span>
        {!node.isGroup && (
          <span className={"font-mono text-xs " + (node.error ? "text-destructive" : "text-foreground")}>
            {" = "}{node.value}
            {node.meaning ? " (" + node.meaning + ")" : ""}
          </span>
        )}
        {range && <span className="ml-auto font-mono text-[10px] text-muted-foreground shrink-0">@{range}</span>}
      </div>
      {hasChildren && open &&
        node.children!.map((c) => (
          <TreeRow key={c.id} node={c} depth={depth + 1} activeId={activeId} onSelect={onSelect} />
        ))}
    </>
  );
};

/** 解码树：树形展示解析结果，与 hexdump 联动。 */
export const DecodeTree = ({ nodes, activeId, onSelect }: DecodeTreeProps) => {
  if (nodes.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">—</div>;
  }
  return (
    <div className="p-1 overflow-auto">
      {nodes.map((n) => (
        <TreeRow key={n.id} node={n} depth={0} activeId={activeId} onSelect={onSelect} />
      ))}
    </div>
  );
};
