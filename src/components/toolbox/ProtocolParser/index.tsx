import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Panel, Group, Separator } from "react-resizable-panels";
import type { Layout } from "react-resizable-panels";
import { useProtocolStore } from "../../../stores/protocolStore";
import type { InputMode } from "../../../stores/protocolStore";
import { parseDsl, flattenNodes } from "../../../lib/dsl";
import type { ParsedNode } from "../../../lib/dsl";
import { BUILTIN_PROTOCOLS, parseNative } from "../../../lib/nativeProtocols";
import { ProtocolSelect } from "./ProtocolSelect";
import { HexDump } from "./HexDump";
import { DecodeTree } from "./DecodeTree";
import { DslEditor } from "./DslEditor";

// 解码树 / hexdump 上下分栏比例的持久化
const SPLIT_KEY = "protocol-parser-split";
const loadSplit = (): Layout | undefined => {
  try {
    const raw = localStorage.getItem(SPLIT_KEY);
    return raw ? (JSON.parse(raw) as Layout) : undefined;
  } catch {
    return undefined;
  }
};
const saveSplit = (layout: Layout) => {
  try { localStorage.setItem(SPLIT_KEY, JSON.stringify(layout)); } catch { /* ignore */ }
};

const hexToBytes = (hex: string): number[] => {
  const cleaned = hex.replace(/0x/gi, "").replace(/[^0-9a-fA-F]/g, "");
  const even = cleaned.length % 2 === 0 ? cleaned : cleaned.slice(0, -1);
  const out: number[] = [];
  for (let i = 0; i < even.length; i += 2) out.push(parseInt(even.slice(i, i + 2), 16));
  return out;
};

// 文本按 ASCII/Latin1 逐字符转字节（NMEA 等），> 0xFF 截断
const textToBytes = (text: string): number[] => {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) out.push(text.charCodeAt(i) & 0xff);
  return out;
};

/**
 * 协议解析工具：仿 Nybble / Wireshark。
 * 内置预设（二进制位字段、NMEA/GPS）走原生解析器，用户协议走协议解析 DSL。
 * 上：解码树；下：hexdump 原始数据。两区共用一个边框、单条分割线，双向联动高亮。
 */
const ProtocolParser = () => {
  const { t } = useTranslation();
  const userProtocols = useProtocolStore((s) => s.protocols);
  const activeId = useProtocolStore((s) => s.activeId);
  const updateProtocol = useProtocolStore((s) => s.updateProtocol);

  // 内置预设置顶，其后为用户协议
  const protocols = useMemo(() => [...BUILTIN_PROTOCOLS, ...userProtocols], [userProtocols]);
  const active = protocols.find((p) => p.id === activeId) ?? null;

  const [rawInput, setRawInput] = useState("");
  const [editing, setEditing] = useState(false);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  // 手动切换的输入模式；null 表示跟随协议默认
  const [modeOverride, setModeOverride] = useState<InputMode | null>(null);

  // 切换协议时重置为该协议默认模式
  useEffect(() => { setModeOverride(null); }, [activeId]);

  const inputMode: InputMode = modeOverride ?? active?.inputMode ?? "hex";

  const bytes = useMemo(
    () => (inputMode === "text" ? textToBytes(rawInput) : hexToBytes(rawInput)),
    [rawInput, inputMode]
  );

  const result = useMemo(() => {
    if (!active) return null;
    if (active.native) return parseNative(active.native, bytes, rawInput);
    return parseDsl(active.yaml, bytes);
  }, [active, bytes, rawInput]);

  const activeRange = useMemo<[number, number] | null>(() => {
    if (!result || !activeNodeId) return null;
    const node = flattenNodes(result.root).find((n) => n.id === activeNodeId);
    if (!node || node.byteEnd <= node.byteStart) return null;
    return [node.byteStart, node.byteEnd];
  }, [result, activeNodeId]);

  const handleByteClick = (idx: number) => {
    if (!result) return;
    const ownerId = result.byteOwner[idx];
    if (ownerId) setActiveNodeId(ownerId);
  };

  const handleNodeSelect = (node: ParsedNode) => setActiveNodeId(node.id);

  const modeBtn = (mode: InputMode, label: string) => (
    <button
      onClick={() => setModeOverride(mode)}
      className={"px-2.5 py-1 text-xs rounded border transition-colors " + (inputMode === mode ? "bg-primary text-primary-foreground border-primary" : "border-input hover:bg-muted")}
    >
      {label}
    </button>
  );

  return (
    <div className="p-6 flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold">{t("toolbox.protocolParserTitle")}</h2>
        <ProtocolSelect onEdit={() => setEditing(true)} />
      </div>

      {editing && active && !active.builtin ? (
        <div className="flex flex-col flex-1 min-h-0 gap-2">
          <label className="text-sm font-medium">{t("toolbox.protoYamlLabel")}</label>
          <DslEditor
            value={active.yaml}
            onChange={(text) => updateProtocol(active.id, { yaml: text })}
          />
          <div className="flex justify-end">
            <button onClick={() => setEditing(false)} className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm">
              {t("toolbox.protoDone")}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">
                {inputMode === "text" ? t("toolbox.protoTextInput") : t("toolbox.protoHexInput")}
              </label>
              {active && (
                <span className="text-[11px] font-mono text-muted-foreground mr-auto">
                  {bytes.length} {t("toolbox.bytes")}
                  {result && <> · {t("toolbox.protoConsumed")} {result.bytesConsumed}</>}
                  {result && result.errors.length > 0 && (
                    <span className="text-destructive"> · {result.errors[0]}</span>
                  )}
                </span>
              )}
              {!active && <span className="mr-auto" />}
              {modeBtn("hex", t("toolbox.protoModeHex"))}
              {modeBtn("text", t("toolbox.protoModeText"))}
            </div>
            <textarea
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              placeholder={inputMode === "text" ? "$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,..." : "06 FF FF 00 05 ..."}
              spellCheck={false}
              className="w-full h-20 px-3 py-2 text-sm rounded-md border border-input bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {!active && (
            <p className="text-sm text-muted-foreground">{t("toolbox.protoSelectHint")}</p>
          )}

          {active && (
            <div className="flex-1 min-h-0 border border-input rounded-md overflow-hidden">
              <Group
                orientation="vertical"
                className="h-full w-full"
                defaultLayout={loadSplit()}
                onLayoutChanged={(layout, meta) => { if (meta.isUserInteraction) saveSplit(layout); }}
              >
                {/* 解码树（上） */}
                <Panel id="tree" defaultSize="55" minSize="20">
                  <div className="h-full min-h-0 overflow-auto">
                    <DecodeTree nodes={result?.root ?? []} activeId={activeNodeId} onSelect={handleNodeSelect} />
                  </div>
                </Panel>

                {/* 可拖拽分割线（Wireshark 风格） */}
                <Separator className="h-1 bg-border/50 hover:bg-primary/50 transition-colors cursor-row-resize" />

                {/* hexdump（下） */}
                <Panel id="hex" defaultSize="45" minSize="20">
                  <div className="h-full min-h-0 overflow-auto bg-muted/10">
                    <HexDump bytes={bytes} activeRange={activeRange} onByteClick={handleByteClick} />
                  </div>
                </Panel>
              </Group>
            </div>
          )}

        </>
      )}
    </div>
  );
};

export default ProtocolParser;
