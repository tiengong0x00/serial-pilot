import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from "react";
import { Send, Trash2, Columns2, Rows2, FileUp, X, Download, Square, Clock } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { useTerminalStore, setAutoSaveNotifier } from "@/stores/terminalStore";
import { useSerialStore } from "@/stores/serialStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSerialCommands } from "@/hooks/useSerialCommands";
import { useNotify } from "@/hooks/useNotify";
import { useShortcutAction } from "@/hooks/useShortcuts";
import { useAtAutocomplete } from "@/hooks/useAtAutocomplete";
import { cn } from "@/lib/utils";
import { formatMessagesToText, generateLogFilename, saveLogToPath, getLaunchDir } from "@/lib/logExport";
import { TerminalContextMenu, type TerminalMenuItem } from "./TerminalContextMenu";
import { AtAutocompletePanel } from "./AtAutocompletePanel";
import { SaveCommandDialog } from "./SaveCommandDialog";
import { useCommandLibrary } from "@/stores/commandLibraryStore";
import { HighlightedText } from "./HighlightedText";
import { useHighlightStore } from "@/stores/highlightStore";
import type { TerminalMessage, PortLabel, FileSendProgressPayload } from "@/types/serial";
import type { HighlightRule } from "@/types/terminal";

type DisplayFormat = "text" | "hex";
type LineFeed = "none" | "lf" | "cr" | "crlf";
type TerminalMode = "merged" | "split"; // 合并显示 / 左右分栏
type SendTarget = "P1" | "P2" | "ALL"; // 发送目标

const LINE_FEED_MAP: Record<LineFeed, string> = {
  none: "",
  lf: "\n",
  cr: "\r",
  crlf: "\r\n",
};

// localStorage 键
const STORAGE_KEY_MODE = "serial_terminal_mode";
const STORAGE_KEY_TARGET = "serial_terminal_target";

function getStoredMode(): TerminalMode {
  return (localStorage.getItem(STORAGE_KEY_MODE) as TerminalMode) || "merged";
}

function getStoredTarget(): SendTarget {
  const stored = localStorage.getItem(STORAGE_KEY_TARGET) as SendTarget;
  // 如果有存储值直接返回（用户上次选择）
  if (stored) return stored;

  // 无存储值时智能选择：优先 P1，P1 未连接则 P2
  const { connectionStatus } = useSerialStore.getState();
  if (connectionStatus.p1_connected) return "P1";
  if (connectionStatus.p2_connected) return "P2";
  return "P1"; // 都未连接时默认 P1
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

function toHex(data: Uint8Array): string {
  return Array.from(data)
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}

/**
 * 智能文本渲染：混合显示可打印和不可打印字符
 * - 可打印 ASCII (32-126): 直接显示
 * - 换行符 (0x0A, 0x0D): 保留
 * - 其他不可打印字符: 显示为 \xHH 格式
 * - UTF-8 多字节序列: 尝试解码，失败则逐字节显示
 */
function renderTextSmart(data: Uint8Array): string {
  const result: string[] = [];
  let i = 0;

  while (i < data.length) {
    const byte = data[i];

    // 换行符：保留
    if (byte === 0x0A || byte === 0x0D) {
      result.push(String.fromCharCode(byte));
      i++;
      continue;
    }

    // 可打印 ASCII (32-126，包括空格)
    if (byte >= 32 && byte <= 126) {
      result.push(String.fromCharCode(byte));
      i++;
      continue;
    }

    // UTF-8 多字节序列检测
    let utf8Length = 0;
    if ((byte & 0xE0) === 0xC0) utf8Length = 2;       // 110xxxxx
    else if ((byte & 0xF0) === 0xE0) utf8Length = 3;  // 1110xxxx
    else if ((byte & 0xF8) === 0xF0) utf8Length = 4;  // 11110xxx

    // 尝试解码 UTF-8 多字节字符
    if (utf8Length > 0 && i + utf8Length <= data.length) {
      try {
        const utf8Bytes = data.slice(i, i + utf8Length);
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(utf8Bytes);
        // 验证解码成功且不是控制字符
        if (decoded.length > 0 && decoded.charCodeAt(0) >= 32) {
          result.push(decoded);
          i += utf8Length;
          continue;
        }
      } catch {
        // UTF-8 解码失败，按单字节处理
      }
    }

    // 不可打印字符：显示为 \xHH
    result.push(`\\x${byte.toString(16).padStart(2, '0').toUpperCase()}`);
    i++;
  }

  return result.join('');
}

function renderContent(msg: TerminalMessage, format: DisplayFormat): string {
  if (format === "hex") {
    return toHex(msg.data);
  }
  // text 模式：优先用后端解码的文本，失败则用智能混合显示
  return msg.text ?? renderTextSmart(msg.data);
}

/** 端口标签颜色：P1 蓝色，P2 绿色 */
function portLabelClass(port: PortLabel): string {
  return port === "P1" ? "text-blue-500" : "text-emerald-500";
}

/** 格式化字节数为可读文本 */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 单条消息渲染 */
function MessageRow({
  msg,
  format,
  showPort,
  highlightRules,
  showTimestamp,
}: {
  msg: TerminalMessage;
  format: DisplayFormat;
  showPort: boolean;
  highlightRules: HighlightRule[];
  showTimestamp: boolean;
}) {
  const contentClass = msg.type === "TX" ? "terminal-sent" : "terminal-text";
  const content = renderContent(msg, format);
  return (
    <div className="whitespace-pre-wrap break-all">
      {showTimestamp && (
        <>
          <span className="text-muted-foreground/60">[{formatTimestamp(msg.timestamp)}]</span>{" "}
        </>
      )}
      {showPort && msg.port_label && (
        <>
          <span className={portLabelClass(msg.port_label)}>[{msg.port_label}]</span>{" "}
        </>
      )}
      <span
        className={
          msg.type === "TX"
            ? "terminal-sent"
            : msg.type === "SYS"
            ? "text-warning"
            : "terminal-text"
        }
      >
        [{msg.type}]
      </span>{" "}
      {highlightRules.length > 0 ? (
        <HighlightedText text={content} rules={highlightRules} className={contentClass} />
      ) : (
        <span className={contentClass}>{content}</span>
      )}
    </div>
  );
}

/**
 * 虚拟滚动终端视图（合并/分栏各端口复用）
 *
 * 用 @tanstack/react-virtual 动态测量每行高度，只渲染可视区域附近的行。
 * 支持数万条消息不卡顿，满足 24 小时挂测场景。
 * autoScroll 开启时，新消息到达自动滚动到底部。
 */
function VirtualTerminalView({
  messages,
  format,
  showPort,
  autoScroll,
  style,
  onContextMenu,
  showTimestamp,
}: {
  messages: TerminalMessage[];
  format: DisplayFormat;
  showPort: boolean;
  autoScroll: boolean;
  style?: React.CSSProperties;
  onContextMenu?: (e: React.MouseEvent) => void;
  showTimestamp: boolean;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isTestEnv, setIsTestEnv] = useState(false);
  const highlightRules = useHighlightStore((s) => s.rules);

  // 检测测试环境：容器高度为 0 时回退到完整渲染
  useEffect(() => {
    if (parentRef.current) {
      const height = parentRef.current.getBoundingClientRect().height;
      setIsTestEnv(height === 0);
    }
  }, []);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20, // 行高估算值，实际高度由 measureElement 动态测量
    overscan: 20, // 预渲染可视区外的行数，减少快速滚动时的空白
    getItemKey: (index) => messages[index].id,
  });

  // 最后一条消息的字节数：RX 融合模式下增量追加会让最后一条 data 变长而条数不变，
  // 单靠 messages.length 无法触发自动滚动。以此作为额外依赖，覆盖"边收边长"场景。
  const lastMsgBytes = messages.length > 0 ? messages[messages.length - 1].data.length : 0;

  // 自动滚动到底部：消息新增或最后一条内容增长，且开启自动滚动时触发
  useEffect(() => {
    if (isTestEnv) {
      // 测试环境用传统方式滚动
      if (autoScroll && scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    } else {
      // 生产环境用虚拟滚动
      if (autoScroll && messages.length > 0) {
        virtualizer.scrollToIndex(messages.length - 1, { align: "end" });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, lastMsgBytes, autoScroll, isTestEnv]);

  const items = virtualizer.getVirtualItems();

  // Ctrl/Cmd+A：将全选范围限制在当前终端输出区，避免选中整个页面
  const handleSelectAll = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
      e.preventDefault();
      const el = parentRef.current;
      const selection = window.getSelection();
      if (!el || !selection) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }, []);

  return (
    <div
      ref={parentRef}
      tabIndex={0}
      className="flex-1 min-h-0 overflow-y-auto custom-scrollbar terminal-output py-3 font-mono text-xs outline-none"
      style={style}
      onContextMenu={onContextMenu}
      onKeyDown={handleSelectAll}
    >
      {messages.length === 0 ? (
        <div className="text-muted-foreground/50 text-center mt-8">—</div>
      ) : isTestEnv ? (
        // 测试环境：完整渲染所有消息
        <div ref={scrollRef} className="px-3">
          {messages.map((msg) => (
            <MessageRow key={msg.id} msg={msg} format={format} showPort={showPort} highlightRules={highlightRules} showTimestamp={showTimestamp} />
          ))}
        </div>
      ) : (
        // 生产环境：虚拟滚动
        <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
          {items.map((virtualItem) => (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItem.start}px)`,
              }}
              className="px-3"
            >
              <MessageRow msg={messages[virtualItem.index]} format={format} showPort={showPort} highlightRules={highlightRules} showTimestamp={showTimestamp} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const DataTerminal = () => {
  const { t } = useTranslation();
  const { messages, clearMessages, addMessage } = useTerminalStore();
  const { connectionStatus } = useSerialStore();
  const { terminalFontSize, terminalLineHeight, terminalMaxMessages, enterToSend } = useSettingsStore();
  const showTimestamp = useSettingsStore((s) => s.showTimestamp);
  const setShowTimestamp = useSettingsStore((s) => s.setShowTimestamp);
  const setMaxMessages = useTerminalStore((s) => s.setMaxMessages);
  const { writeSerialData, saveAttachment, deleteAttachment, sendAttachment, cancelFileSend } = useSerialCommands();
  const { success, error: notifyError } = useNotify();

  // 同步日志上限设置到 terminalStore（实时生效）
  useEffect(() => {
    setMaxMessages(terminalMaxMessages);
  }, [terminalMaxMessages, setMaxMessages]);

  // 注册日志自动保存通知回调（超限自动保存并清空时提示用户）
  useEffect(() => {
    setAutoSaveNotifier((result) => {
      if (result.success) {
        success(t("terminal.autoSaveSuccess"), { toast: true, log: true });
      } else {
        notifyError(t("terminal.autoSaveFailed"), { toast: true, log: true });
      }
    });
    return () => setAutoSaveNotifier(null);
  }, [success, notifyError, t]);

  // 终端显示样式（字号 + 行高），应用到所有消息区
  const terminalStyle = useMemo(
    () => ({ fontSize: `${terminalFontSize}px`, lineHeight: terminalLineHeight }),
    [terminalFontSize, terminalLineHeight]
  );

  const [format, setFormat] = useState<DisplayFormat>("text");
  const [lineFeed, setLineFeed] = useState<LineFeed>("crlf");
  const [input, setInput] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [terminalMode, setTerminalMode] = useState<TerminalMode>(getStoredMode);
  const [sendTarget, setSendTarget] = useState<SendTarget>(getStoredTarget);

  // 文件发送相关
  // 待发文件：拖入即上传到磁盘缓存，只留引用（id/name/size），不再常驻内存字节
  const [pendingFile, setPendingFile] = useState<{ name: string; size: number; id: string } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSending, setIsSending] = useState(false);
  // 文件发送进度详情：字节量 + 速率 + 剩余时间（由 file_send_progress 事件驱动）
  const [sendStat, setSendStat] = useState<{
    sent: number;
    total: number;
    bps: number;      // 瞬时字节/秒
    etaSec: number;   // 剩余秒数
  } | null>(null);
  // 发送目标端口（用于取消命令）
  const sendTargetRef = useRef<PortLabel | null>(null);

  // 自动循环发送
  const [autoSend, setAutoSend] = useState(false);
  const [autoSendInterval, setAutoSendInterval] = useState(1000); // ms, 范围 10-60000
  const autoSendActiveRef = useRef(false); // 串行循环运行标志

  // 右键菜单
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; target: 'output' | 'input' } | null>(null);

  const isConnected = connectionStatus.p1_connected || connectionStatus.p2_connected;

  // 分栏模式仅在 P2 连接时生效，否则强制合并显示
  const effectiveMode: TerminalMode = connectionStatus.p2_connected ? terminalMode : "merged";

  // 端口标识仅在 P1、P2 同时连接时显示
  const showPortLabel = connectionStatus.p1_connected && connectionStatus.p2_connected;

  // 智能切换发送目标：任一端口断开时，自动切到仍连接的端口
  useEffect(() => {
    // P2 断开且当前目标是 P2 或 ALL → 切到 P1
    if (!connectionStatus.p2_connected && (sendTarget === "P2" || sendTarget === "ALL")) {
      setSendTarget("P1");
    }
    // P1 断开且当前目标是 P1 或 ALL，同时 P2 已连接 → 切到 P2
    if (!connectionStatus.p1_connected && (sendTarget === "P1" || sendTarget === "ALL") && connectionStatus.p2_connected) {
      setSendTarget("P2");
    }
  }, [connectionStatus.p1_connected, connectionStatus.p2_connected, sendTarget]);

  // 保存模式和目标到 localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_MODE, terminalMode);
  }, [terminalMode]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_TARGET, sendTarget);
  }, [sendTarget]);

  // 自动滚动逻辑已下沉到 VirtualTerminalView 内部（各视图独立处理）

  const stats = useMemo(() => {
    let tx = 0;
    let rx = 0;
    for (const m of messages) {
      if (m.type === "TX") tx += m.data.length;
      else if (m.type === "RX") rx += m.data.length;
    }
    return { tx, rx, count: messages.length };
  }, [messages]);

  // 分栏模式：按端口过滤消息
  const p1Messages = useMemo(() => messages.filter((m) => m.port_label === "P1"), [messages]);
  const p2Messages = useMemo(() => messages.filter((m) => m.port_label === "P2"), [messages]);

  // 根据 sendTarget 和连接状态计算实际发送端口
  const resolveTargets = useCallback((): PortLabel[] => {
    const targets: PortLabel[] = [];
    if (sendTarget === "ALL") {
      if (connectionStatus.p1_connected) targets.push("P1");
      if (connectionStatus.p2_connected) targets.push("P2");
    } else if (sendTarget === "P1" && connectionStatus.p1_connected) {
      targets.push("P1");
    } else if (sendTarget === "P2" && connectionStatus.p2_connected) {
      targets.push("P2");
    }
    return targets;
  }, [sendTarget, connectionStatus]);

  // 导出日志
  // - 每次都弹出对话框选择保存位置
  // - 首次：默认路径为工具启动目录下的 logs/
  // - 后续：默认路径为上次选择的目录
  // - 合并模式 / 单串口：导出全部消息到一个文件
  // - 分栏模式（P1+P2 都连接）：P1、P2 各导出一个文件到同一目录
  const handleExport = useCallback(async () => {
    if (messages.length === 0) return;

    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { lastExportDir, setLastExportDir } = useSettingsStore.getState();

      // 确定默认目录：上次选择的目录 或 启动目录/logs
      let defaultDir: string;
      if (lastExportDir) {
        defaultDir = lastExportDir;
      } else {
        const launchDir = await getLaunchDir();
        defaultDir = `${launchDir}/logs`;
      }

      // 生成默认文件名
      const defaultFilename = generateLogFilename(effectiveMode === "split" ? "P1" : undefined);

      // 弹出保存对话框
      const selectedPath = await save({
        defaultPath: `${defaultDir}/${defaultFilename}`,
        filters: [{
          name: 'Text',
          extensions: ['txt', 'log']
        }]
      });

      if (!selectedPath) return; // 用户取消

      // 提取并记住目录
      const pathObj = selectedPath.replace(/\\/g, '/');
      const exportDir = pathObj.substring(0, pathObj.lastIndexOf('/'));
      setLastExportDir(exportDir);

      // 执行导出
      if (effectiveMode === "split") {
        // 分栏模式：分别导出 P1 和 P2 到同一目录
        const p1 = messages.filter((m) => m.port_label === "P1");
        const p2 = messages.filter((m) => m.port_label === "P2");
        let count = 0;
        let lastPath = "";

        if (p1.length > 0) {
          const filename = generateLogFilename("P1");
          lastPath = await saveLogToPath(exportDir, filename, formatMessagesToText(p1, false));
          count++;
        }
        if (p2.length > 0) {
          const filename = generateLogFilename("P2");
          lastPath = await saveLogToPath(exportDir, filename, formatMessagesToText(p2, false));
          count++;
        }

        success(t("terminal.exportSuccess", { count }), { toast: true, log: true });
        if (lastPath) success(lastPath, { toast: false, log: true });
      } else {
        // 合并模式 / 单串口：一个文件
        const filename = generateLogFilename();
        const path = await saveLogToPath(exportDir, filename, formatMessagesToText(messages, showPortLabel));
        success(t("terminal.exportSuccess", { count: 1 }), { toast: true, log: true });
        success(path, { toast: false, log: true });
      }
    } catch (e) {
      notifyError(`${t("terminal.exportFailed")}: ${String(e)}`, { toast: true, log: true });
    }
  }, [messages, effectiveMode, showPortLabel, success, notifyError, t]);

  // 右键菜单处理
  const handleOutputContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, target: 'output' });
  }, []);

  const handleInputContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, target: 'input' });
  }, []);

  const getContextMenuItems = useCallback((): TerminalMenuItem[] => {
    if (!contextMenu) return [];

    if (contextMenu.target === 'output') {
      // 输出区域菜单
      const hasSelection = (window.getSelection()?.toString().length ?? 0) > 0;
      return [
        {
          label: t("terminal.menuCopy"),
          disabled: !hasSelection,
          onClick: async () => {
            const text = window.getSelection()?.toString();
            if (text) {
              try {
                await navigator.clipboard.writeText(text);
                success(t("terminal.copied"), { toast: false, log: false });
              } catch (err) {
                notifyError(t("terminal.copyFailed"), { toast: true, log: false });
              }
            }
          },
        },
        {
          label: t("terminal.menuExportLog"),
          disabled: messages.length === 0,
          onClick: handleExport,
        },
        {
          label: t("terminal.menuClear"),
          disabled: messages.length === 0,
          onClick: clearMessages,
        },
      ];
    } else {
      // 输入框菜单
      const hasSelection = inputRef.current && inputRef.current.selectionStart !== inputRef.current.selectionEnd;
      return [
        {
          label: t("terminal.menuCut"),
          disabled: !hasSelection,
          onClick: async () => {
            if (!inputRef.current) return;
            const { selectionStart, selectionEnd } = inputRef.current;
            if (selectionStart === null || selectionEnd === null) return;
            const selected = input.substring(selectionStart, selectionEnd);
            try {
              await navigator.clipboard.writeText(selected);
              setInput(input.substring(0, selectionStart) + input.substring(selectionEnd));
              success(t("terminal.cut"), { toast: false, log: false });
            } catch (err) {
              notifyError(t("terminal.cutFailed"), { toast: true, log: false });
            }
          },
        },
        {
          label: t("terminal.menuCopy"),
          disabled: !hasSelection,
          onClick: async () => {
            if (!inputRef.current) return;
            const { selectionStart, selectionEnd } = inputRef.current;
            if (selectionStart === null || selectionEnd === null) return;
            const selected = input.substring(selectionStart, selectionEnd);
            try {
              await navigator.clipboard.writeText(selected);
              success(t("terminal.copied"), { toast: false, log: false });
            } catch (err) {
              notifyError(t("terminal.copyFailed"), { toast: true, log: false });
            }
          },
        },
        {
          label: t("terminal.menuPaste"),
          onClick: async () => {
            try {
              const text = await navigator.clipboard.readText();
              if (!inputRef.current) return;
              const { selectionStart, selectionEnd } = inputRef.current;
              if (selectionStart === null || selectionEnd === null) {
                setInput(input + text);
              } else {
                setInput(input.substring(0, selectionStart) + text + input.substring(selectionEnd));
              }
            } catch (err) {
              notifyError(t("terminal.pasteFailed"), { toast: true, log: false });
            }
          },
        },
        {
          label: t("terminal.menuSelectAll"),
          onClick: () => {
            inputRef.current?.select();
          },
        },
      ];
    }
  }, [contextMenu, messages.length, input, handleExport, clearMessages, success, notifyError]);

  const handleSend = useCallback(async () => {
    const sendId = Math.random().toString(36).substr(2, 6);
    const t0 = performance.now();
    console.log(`[PERF] handleSend[${sendId}] entry`);

    if (!input) {
      setErrorMsg(t("terminal.emptyInput"));
      return;
    }
    if (!isConnected) {
      setErrorMsg(t("terminal.notConnected"));
      return;
    }
    setErrorMsg("");

    // 构造发送数据：文本 + 换行符
    const payload = input + LINE_FEED_MAP[lineFeed];
    const bytes = new TextEncoder().encode(payload);

    // 确定发送目标
    const targets = resolveTargets();
    if (targets.length === 0) {
      setErrorMsg(t("terminal.targetNotConnected"));
      return;
    }

    // 1. 立即显示 TX（乐观渲染）
    const txTimestamp = Date.now();
    for (const target of targets) {
      const txMsg: TerminalMessage = {
        id: `${txTimestamp}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'TX',
        port_label: target,
        data: bytes,
        timestamp: txTimestamp,
        text: payload,
      };
      addMessage(txMsg);
    }

    const t1 = performance.now();
    console.log(`[PERF] handleSend[${sendId}] optimistic_render=${(t1-t0).toFixed(2)}ms`);

    // 2. 后台发送（不阻塞界面）
    try {
      for (const target of targets) {
        const t2 = performance.now();
        await writeSerialData(target, bytes);
        const t3 = performance.now();
        console.log(`[PERF] handleSend[${sendId}] writeSerialData[${target}]=${(t3-t2).toFixed(2)}ms`);
        // 成功：无需任何操作（TX 已显示）
      }
      // 发送成功后保留输入内容（不清空），用户可直接覆盖或修改
    } catch (e) {
      const err = e as { message?: string };
      // 失败：TX 保持显示（符合常见软件行为），仅设置错误提示
      setErrorMsg(err.message ?? String(e));
    } finally {
      const t5 = performance.now();
      console.log(`[PERF] handleSend[${sendId}] total=${(t5-t0).toFixed(2)}ms`);
    }
  }, [input, isConnected, lineFeed, resolveTargets, writeSerialData, addMessage, t]);

  // 切换显示格式
  const handleToggleFormat = useCallback(() => {
    setFormat((prev) => (prev === "text" ? "hex" : "text"));
  }, []);

  // 快捷键订阅
  useShortcutAction("send", handleSend);
  useShortcutAction("clearLog", clearMessages);
  useShortcutAction("toggleFormat", handleToggleFormat);

  // handleSend 的最新引用，供定时器读取（避免 input 变化重启定时器）
  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;

  // 自动发送：串行循环——发完上一条才等间隔再发下一条（不重叠、无排队）。
  // input 变化不重启循环，下次迭代通过 ref 读到最新内容，实现"边改边发"。
  useEffect(() => {
    if (!(autoSend && isConnected && !pendingFile)) {
      autoSendActiveRef.current = false;
      return;
    }

    autoSendActiveRef.current = true;
    let stopped = false;

    const loop = async () => {
      while (autoSendActiveRef.current && !stopped) {
        await handleSendRef.current(); // 等真正发完
        if (!autoSendActiveRef.current || stopped) break;
        await sleep(autoSendInterval); // 规定等待
      }
    };
    void loop();

    // 清理：开关关闭、间隔变化、断开连接或卸载时终止循环
    return () => {
      stopped = true;
      autoSendActiveRef.current = false;
    };
  }, [autoSend, isConnected, pendingFile, autoSendInterval]);

  // 串口断开时自动中止文件发送（通知后端停止发送线程）
  useEffect(() => {
    const unlisten = listen<{ port_label: string }>("serial_error", () => {
      if (isSending && sendTargetRef.current) {
        void cancelFileSend(sendTargetRef.current);
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [isSending, cancelFileSend]);

  // AT 命令自动完成
  const autocomplete = useAtAutocomplete(input);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [saveDialogCommand, setSaveDialogCommand] = useState<string | null>(null);
  const refreshCommandLib = useCommandLibrary((s) => s.refresh);

  // 输入框自适应高度：默认单行，随内容增长，超过上限出现滚动条
  const INPUT_MAX_HEIGHT = 140; // 约 6 行，超过则内部滚动
  const autoGrowInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;

    // 空输入时强制恢复单行高度，避免 scrollHeight 误判
    if (!el.value.trim()) {
      el.style.height = "36px"; // 对应 min-h-[36px]
      el.style.overflowY = "hidden";
      return;
    }

    // 先归零再按 scrollHeight 计算，避免累积增长；scrollHeight 含内边距
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, INPUT_MAX_HEIGHT);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > INPUT_MAX_HEIGHT ? "auto" : "hidden";
  }, []);

  // input 内容变化时重算高度（含清空后恢复单行）
  useLayoutEffect(() => {
    autoGrowInput();
  }, [input, autoGrowInput]);

  // 应用选中的候选命令到输入框
  const applyCandidate = useCallback(() => {
    const selected = autocomplete.getSelected();
    if (selected) {
      setInput(selected.command);
      autocomplete.dismiss();
      inputRef.current?.focus();
    }
  }, [autocomplete]);

  // 输入框键盘处理：候选面板打开时拦截导航键
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (autocomplete.isOpen) {
        switch (e.key) {
          case "ArrowDown":
            e.preventDefault();
            autocomplete.moveDown();
            return;
          case "ArrowUp":
            e.preventDefault();
            autocomplete.moveUp();
            return;
          case "Tab":
            e.preventDefault();
            applyCandidate();
            return;
          case "Escape":
            e.preventDefault();
            autocomplete.dismiss();
            return;
          case "Enter":
            // 候选面板打开时，Enter 优先补全而非发送
            e.preventDefault();
            applyCandidate();
            return;
          default:
            break;
        }
      }
      // Ctrl+S 保存当前命令到命令库
      if (e.key === "s" && e.ctrlKey) {
        e.preventDefault();
        const cmd = input.trim();
        if (cmd) {
          setSaveDialogCommand(cmd);
        }
        return;
      }

      // 回车发送：受设置开关控制
      // 启用时：Enter 发送，Shift+Enter 或 Ctrl+Enter 换行
      // 关闭时：Enter 换行，仅能点发送按钮
      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && enterToSend && !pendingFile) {
        e.preventDefault();
        void handleSend();
      }
    },
    [autocomplete, applyCandidate, pendingFile, handleSend, enterToSend, input]
  );

  // 发送文件：下沉后端流式发送，前端只订阅进度事件刷新单行进度条。
  // 终端仅留开始/结束两条 SYS，不再逐片刷屏。多端口时依次发送。
  const handleSendFile = useCallback(async () => {
    if (!pendingFile) return;
    if (!isConnected) {
      setErrorMsg(t("terminal.notConnected"));
      return;
    }
    setErrorMsg("");

    const targets = resolveTargets();
    if (targets.length === 0) {
      setErrorMsg(t("terminal.targetNotConnected"));
      return;
    }

    const { name, size, id } = pendingFile;
    const totalBytes = size;

    setIsSending(true);
    setSendStat({ sent: 0, total: totalBytes, bps: 0, etaSec: 0 });

    let anyCancelled = false;
    try {
      for (const target of targets) {
        sendTargetRef.current = target;

        // 开始 TX 消息
        addMessage({
          id: `file-start-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: "TX",
          port_label: target,
          data: new Uint8Array(),
          timestamp: Date.now(),
          text: t("terminal.fileSendStart", { name, size: formatBytes(totalBytes) }),
        });

        // 订阅该端口进度事件，直到 done/cancelled
        const startTs = performance.now();
        let lastSent = 0;
        let lastTs = startTs;
        const finished = await new Promise<{ cancelled: boolean; sent: number }>((resolve) => {
          let unlistenFn: (() => void) | null = null;
          void listen<FileSendProgressPayload>("file_send_progress", (evt) => {
            const p = evt.payload;
            if (p.port_label !== target) return;

            const now = performance.now();
            const dt = (now - lastTs) / 1000;
            const dBytes = p.sent_bytes - lastSent;
            const bps = dt > 0 ? dBytes / dt : 0;
            const remain = Math.max(0, p.total_bytes - p.sent_bytes);
            const etaSec = bps > 0 ? remain / bps : 0;
            lastSent = p.sent_bytes;
            lastTs = now;

            setSendStat({ sent: p.sent_bytes, total: p.total_bytes, bps, etaSec });

            if (p.done || p.cancelled) {
              if (unlistenFn) unlistenFn();
              resolve({ cancelled: p.cancelled, sent: p.sent_bytes });
            }
          }).then((fn) => { unlistenFn = fn; });

          // 触发后端从缓存文件流式读盘发送
          void sendAttachment(target, id).catch((e) => {
            const err = e as { message?: string };
            setErrorMsg(err.message ?? String(e));
            if (unlistenFn) unlistenFn();
            resolve({ cancelled: true, sent: lastSent });
          });
        });

        // 结束 TX 消息
        const elapsedSec = (performance.now() - startTs) / 1000;
        if (finished.cancelled) {
          anyCancelled = true;
          addMessage({
            id: `file-cancel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: "TX",
            port_label: target,
            data: new Uint8Array(),
            timestamp: Date.now(),
            text: t("terminal.fileSendCancelled", {
              name,
              sent: formatBytes(finished.sent),
              total: formatBytes(totalBytes)
            }),
          });
          break; // 取消后不再发往其他端口
        } else {
          const avgBps = elapsedSec > 0 ? totalBytes / elapsedSec : 0;
          addMessage({
            id: `file-summary-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: "TX",
            port_label: target,
            data: new Uint8Array(),
            timestamp: Date.now(),
            text: t("terminal.fileSentV2", {
              name,
              sent: formatBytes(finished.sent),
              total: formatBytes(totalBytes),
              elapsed: elapsedSec.toFixed(1),
              rate: formatBytes(avgBps),
            }),
          });
        }
      }

      // 完整发完才清空待发文件并删除缓存副本；取消后保留供重发
      if (!anyCancelled) {
        setPendingFile(null);
        void deleteAttachment(id);
      }
    } catch (e) {
      const err = e as { message?: string };
      setErrorMsg(err.message ?? String(e));
    } finally {
      setIsSending(false);
      setSendStat(null);
      sendTargetRef.current = null;
    }
  }, [
    pendingFile,
    isConnected,
    resolveTargets,
    sendAttachment,
    deleteAttachment,
    addMessage,
    t,
  ]);

  // 拖拽处理
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      const file = files[0]; // 只取第一个文件
      try {
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        // 上传到磁盘缓存,只保留引用(终端附件临时,发完/取消/移除即删)
        const ref = await saveAttachment(bytes, file.name);
        setPendingFile({ name: ref.name, size: ref.size, id: ref.id });
        setErrorMsg("");
      } catch (err) {
        const error = err as { message?: string };
        setErrorMsg(t("terminal.fileReadError", { error: error.message ?? String(err) }));
      }
    },
    [saveAttachment, t]
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50 flex-wrap">
        {/* 格式切换 */}
        <div className="flex items-center rounded-md border border-border overflow-hidden">
          <button
            type="button"
            className={`px-2.5 py-1 text-xs ${format === "text" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
            onClick={() => setFormat("text")}
          >
            {t("terminal.formatText")}
          </button>
          <button
            type="button"
            className={`px-2.5 py-1 text-xs ${format === "hex" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
            onClick={() => setFormat("hex")}
          >
            {t("terminal.formatHex")}
          </button>
        </div>

        {/* 模式切换（仅 P2 连接时显示） */}
        {connectionStatus.p2_connected && (
          <div className="flex items-center rounded-md border border-border overflow-hidden">
            <button
              type="button"
              className={`px-2.5 py-1 text-xs inline-flex items-center gap-1 ${terminalMode === "merged" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
              onClick={() => setTerminalMode("merged")}
              title={t("terminal.modeMerged")}
            >
              <Rows2 className="w-3 h-3" />
              {t("terminal.modeMerged")}
            </button>
            <button
              type="button"
              className={`px-2.5 py-1 text-xs inline-flex items-center gap-1 ${terminalMode === "split" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
              onClick={() => setTerminalMode("split")}
              title={t("terminal.modeSplit")}
            >
              <Columns2 className="w-3 h-3" />
              {t("terminal.modeSplit")}
            </button>
          </div>
        )}

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="accent-primary"
          />
          {t("terminal.autoScroll")}
        </label>

        <div className="flex-1" />

        <span className="text-xs text-muted-foreground">
          TX {stats.tx} · RX {stats.rx} · {stats.count}
        </span>
        <button
          type="button"
          className={`h-7 w-7 inline-flex items-center justify-center rounded-md hover:text-primary transition-colors ${
            showTimestamp ? "text-primary" : ""
          }`}
          onClick={() => setShowTimestamp(!showTimestamp)}
          title={t("terminal.toggleTimestamp")}
        >
          <Clock className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:text-primary disabled:opacity-50 transition-colors"
          onClick={handleExport}
          disabled={messages.length === 0}
          title={t("terminal.exportLog")}
        >
          <Download className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:text-primary transition-colors"
          onClick={clearMessages}
          title={t("terminal.clear")}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 消息显示区（虚拟滚动，支持大数据量） */}
      {effectiveMode === "merged" ? (
        // 合并模式：所有消息按时间排列，用端口标签区分
        <VirtualTerminalView
          messages={messages}
          format={format}
          showPort={showPortLabel}
          autoScroll={autoScroll}
          style={terminalStyle}
          onContextMenu={handleOutputContextMenu}
          showTimestamp={showTimestamp}
        />
      ) : (
        // 分栏模式：P1 左、P2 右，独立滚动
        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 flex flex-col min-w-0 border-r border-border/50">
            <div className="px-3 py-1 text-xs font-medium border-b border-border/30 bg-muted/20">
              <span className={portLabelClass("P1")}>P1</span>
            </div>
            <VirtualTerminalView
              messages={p1Messages}
              format={format}
              showPort={false}
              autoScroll={autoScroll}
              style={terminalStyle}
              onContextMenu={handleOutputContextMenu}
              showTimestamp={showTimestamp}
            />
          </div>
          <div className="flex-1 flex flex-col min-w-0">
            <div className="px-3 py-1 text-xs font-medium border-b border-border/30 bg-muted/20">
              <span className={portLabelClass("P2")}>P2</span>
            </div>
            <VirtualTerminalView
              messages={p2Messages}
              format={format}
              showPort={false}
              autoScroll={autoScroll}
              style={terminalStyle}
              onContextMenu={handleOutputContextMenu}
              showTimestamp={showTimestamp}
            />
          </div>
        </div>
      )}

      {/* 发送区 */}
      <div
        className={`border-t border-border/50 p-3 flex flex-col gap-2 relative ${
          isDragging ? "bg-primary/10 border-primary" : ""
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/5 border-2 border-dashed border-primary rounded-md pointer-events-none">
            <div className="flex flex-col items-center gap-2">
              <FileUp className="w-8 h-8 text-primary" />
              <span className="text-sm text-primary font-medium">{t("terminal.dropFile")}</span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">{t("terminal.lineFeed")}</label>
          <select
            className="h-7 px-1.5 text-xs rounded-md border border-input bg-background"
            value={lineFeed}
            onChange={(e) => setLineFeed(e.target.value as LineFeed)}
          >
            <option value="none">{t("terminal.lfNone")}</option>
            <option value="lf">{t("terminal.lfLF")}</option>
            <option value="cr">{t("terminal.lfCR")}</option>
            <option value="crlf">{t("terminal.lfCRLF")}</option>
          </select>

          {/* 自动发送开关和间隔 */}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground ml-2 cursor-pointer">
            <input
              type="checkbox"
              className="w-3.5 h-3.5 rounded border-input"
              checked={autoSend}
              onChange={(e) => setAutoSend(e.target.checked)}
              disabled={!isConnected || !!pendingFile}
            />
            {t("terminal.autoSend")}
          </label>
          <input
            type="text"
            inputMode="numeric"
            className="w-20 h-7 px-1.5 text-xs rounded-md border border-input bg-background disabled:opacity-50"
            value={autoSendInterval}
            onChange={(e) => {
              // 只做数字校验（仅保留纯数字输入），不做范围限制
              const raw = e.target.value;
              if (raw === "") {
                setAutoSendInterval(0);
                return;
              }
              if (/^\d+$/.test(raw)) {
                setAutoSendInterval(parseInt(raw, 10));
              }
            }}
            disabled={!isConnected || autoSend || !!pendingFile}
            placeholder="ms"
          />
          <span className="text-xs text-muted-foreground">ms</span>

          {/* 发送目标选择器（仅 P2 连接时显示） */}
          {connectionStatus.p2_connected && (
            <>
              <label className="text-xs text-muted-foreground ml-2">{t("terminal.sendTarget")}</label>
              <div className="flex items-center rounded-md border border-border overflow-hidden">
                {(["P1", "P2", "ALL"] as SendTarget[]).map((tgt) => (
                  <button
                    key={tgt}
                    type="button"
                    className={`px-2.5 py-1 text-xs ${sendTarget === tgt ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
                    onClick={() => setSendTarget(tgt)}
                  >
                    {tgt}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* 文件芯片（待发送文件）+ 单行进度条 */}
        {pendingFile && (
          <div className="flex items-center gap-2 px-2 py-1.5 bg-secondary/50 rounded-md border border-border">
            <FileUp className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="text-xs truncate max-w-[140px]" title={pendingFile.name}>{pendingFile.name}</span>
            <span className="text-xs text-muted-foreground shrink-0">{formatBytes(pendingFile.size)}</span>

            {isSending && sendStat ? (
              <>
                {/* 进度条 */}
                <div className="flex-1 h-1.5 min-w-[80px] rounded-full bg-border overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-100"
                    style={{ width: `${sendStat.total > 0 ? Math.floor((sendStat.sent / sendStat.total) * 100) : 0}%` }}
                  />
                </div>
                <span className="text-xs text-primary shrink-0 tabular-nums">
                  {sendStat.total > 0 ? Math.floor((sendStat.sent / sendStat.total) * 100) : 0}%
                </span>
                <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                  {formatBytes(sendStat.sent)} / {formatBytes(sendStat.total)}
                </span>
                <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                  {formatBytes(sendStat.bps)}/s
                </span>
                <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                  {t("terminal.fileEta", { sec: Math.ceil(sendStat.etaSec) })}
                </span>
              </>
            ) : (
              <button
                type="button"
                className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-destructive/20 ml-auto shrink-0"
                onClick={() => {
                  void deleteAttachment(pendingFile.id);
                  setPendingFile(null);
                }}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        <div className="flex items-start gap-2 relative">
          <textarea
            ref={inputRef}
            rows={1}
            className="flex-1 min-h-[36px] px-2 py-1.5 text-sm leading-5 rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 resize-y"
            placeholder={
              pendingFile
                ? t("terminal.filePending")
                : enterToSend
                ? t("terminal.placeholderEnterToSend")
                : t("terminal.placeholder")
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleInputKeyDown}
            onBlur={() => autocomplete.dismiss()}
            onContextMenu={handleInputContextMenu}
            disabled={!!pendingFile || isSending}
          />

          {/* AT 命令候选面板 */}
          <AtAutocompletePanel
            visible={autocomplete.isOpen}
            candidates={autocomplete.candidates}
            selectedIndex={autocomplete.selectedIndex}
            onSelect={applyCandidate}
            onHover={autocomplete.setSelectedIndex}
          />

          <button
            type="button"
            className={cn(
              "h-9 px-4 inline-flex items-center gap-2 text-sm font-medium rounded-md disabled:opacity-50 mt-0.5",
              isSending ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground" : "btn-connect"
            )}
            onClick={() => {
              if (isSending) {
                if (sendTargetRef.current) void cancelFileSend(sendTargetRef.current);
              } else {
                void (pendingFile ? handleSendFile() : handleSend());
              }
            }}
            disabled={!isConnected || (!isSending && !input && !pendingFile)}
          >
            {isSending ? (
              <>
                <Square className="w-4 h-4" />
                {t("terminal.cancel")}
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                {pendingFile ? t("terminal.sendFile") : t("terminal.send")}
              </>
            )}
          </button>
        </div>
        {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}
      </div>

      {/* 终端右键菜单 */}
      {contextMenu && (
        <TerminalContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getContextMenuItems()}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* 保存命令对话框 */}
      {saveDialogCommand && (
        <SaveCommandDialog
          command={saveDialogCommand}
          onClose={() => setSaveDialogCommand(null)}
          onSaved={() => {
            void refreshCommandLib();
          }}
        />
      )}
    </div>
  );
};

export default DataTerminal;
