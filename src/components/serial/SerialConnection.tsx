import { useState, useEffect, useCallback, useRef, useLayoutEffect } from "react";
import type { CSSProperties } from "react";
import { RefreshCw, Plug, PlugZap, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSerialStore } from "@/stores/serialStore";
import { useSerialCommands } from "@/hooks/useSerialCommands";
import { useNotify } from "@/hooks/useNotify";
import { useShortcutAction } from "@/hooks/useShortcuts";
import { Badge } from "@/components/ui/badge";
import type { SerialConfig, PortLabel } from "@/types/serial";

const BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1000000, 1500000, 2000000];
const DATA_BITS = [5, 6, 7, 8] as const;
const STOP_BITS = [1, 2] as const;

/**
 * 自适应缩放 Hook：测量容器可用高度与内容自然高度，
 * 若内容超出则用 transform: scale() 等比缩小到刚好放下，保证无滚动条。
 * 缩放下限 0.6（60%）以保证最低可读性。
 */
function useAutoScale(deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;

    // 纯读测量：transform 不影响元素自身的 scrollHeight（布局盒不变），
    // 因此无需写任何样式，避免与 React style prop 冲突。
    const measure = () => {
      const avail = parent.clientHeight;
      const contentH = el.scrollHeight;
      if (avail <= 0 || contentH <= 0) return;

      // 内容超出则等比缩小（下限 0.6），否则不缩放
      const target = contentH > avail ? Math.max(0.6, avail / contentH) : 1;
      // 阈值去重：变化极小则不更新，杜绝重渲染抖动
      setScale((prev) => (Math.abs(prev - target) < 0.005 ? prev : target));
    };

    measure();
    // 只观察父容器（可用高度变化），不观察内层，
    // 杜绝宽度补偿引起的内容高度变化触发的自反馈循环。
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ref, scale };
}

/**
 * 根据 scale 生成 transform 样式。
 * 补偿宽度 width:(100/s)% + transform-origin: top left，
 * 使缩放后内容正好填满容器宽度，左右无空白。
 */
function scaleStyle(scale: number): CSSProperties {
  if (scale >= 0.99) return {};
  return {
    transform: `scale(${scale})`,
    transformOrigin: "top left",
    width: `${100 / scale}%`,
    // 补偿布局占位高度=父高：transform 不改变布局盒，
    // 缩放后视觉高度=contentH*s=avail=100%，消除下方空白与滚动条。
    height: "100%",
  };
}

interface PortConfigProps {
  portLabel: PortLabel;
  ports: Array<{ port_name: string; friendly_name?: string }>;
  isConnected: boolean;
  hideHeader?: boolean;
  onRefresh: () => Promise<void>;
  onConnect: (portName: string, config: SerialConfig) => Promise<void>;
  onDisconnect: () => Promise<void>;
}

/** 单个串口配置面板（P1 或 P2 复用） */
function PortConfigPanel({ portLabel, ports, isConnected, hideHeader, onRefresh, onConnect, onDisconnect }: PortConfigProps) {
  const { t } = useTranslation();
  const { p1Config, p2Config, setConfig, p1SelectedPort, p2SelectedPort, setSelectedPort: setSelectedPortInStore } = useSerialStore();
  const { setSerialDtr, setSerialRts } = useSerialCommands();

  // 根据 portLabel 选择对应的持久化配置
  const savedConfig = portLabel === 'P1' ? p1Config : p2Config;
  const connectedPortName = portLabel === 'P1' ? useSerialStore((s) => s.p1PortName) : useSerialStore((s) => s.p2PortName);
  const persistedSelectedPort = portLabel === 'P1' ? p1SelectedPort : p2SelectedPort;

  const { success, error } = useNotify();
  // ✅ 本地选中端口初始化自持久化值；变更时同步回 store，切换标签页/断开后仍保留用户选择
  const [selectedPort, setSelectedPortLocal] = useState<string>(persistedSelectedPort ?? "");
  // 统一的端口选择设置器：同时更新本地状态和持久化 store
  const setSelectedPort = useCallback((port: string) => {
    setSelectedPortLocal(port);
    setSelectedPortInStore(portLabel, port || null);
  }, [portLabel, setSelectedPortInStore]);
  const [baudRate, setBaudRate] = useState<number>(savedConfig.baud_rate);
  const [dataBits, setDataBits] = useState<5 | 6 | 7 | 8>(savedConfig.data_bits);
  const [parity, setParity] = useState<"none" | "even" | "odd">(savedConfig.parity);
  const [stopBits, setStopBits] = useState<1 | 2>(savedConfig.stop_bits);
  const [dtr, setDtr] = useState<boolean>(savedConfig.dtr);
  const [rts, setRts] = useState<boolean>(savedConfig.rts);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [isCustomBaudRate, setIsCustomBaudRate] = useState(false);

  // 同步 store 配置到本地状态（StatusFooter 修改配置后联动更新）
  useEffect(() => {
    setBaudRate(savedConfig.baud_rate);
    setDataBits(savedConfig.data_bits);
    setParity(savedConfig.parity);
    setStopBits(savedConfig.stop_bits);
    setDtr(savedConfig.dtr);
    setRts(savedConfig.rts);
  }, [savedConfig]);

  // ✅ 统一状态源：已连接时始终显示 store 中的端口，未连接时才使用本地状态
  // 修复标签页切换后显示错误端口的 bug
  const displayPort = isConnected && connectedPortName ? connectedPortName : selectedPort;

  // 端口列表变化时验证并同步 selectedPort（仅未连接时）
  useEffect(() => {
    if (!isConnected) {
      if (ports.length === 0) {
        // 无端口时清空选择
        setSelectedPort('');
      } else if (persistedSelectedPort) {
        // 优先使用持久化的选择
        const portExists = ports.some(p => p.port_name === persistedSelectedPort);
        if (portExists) {
          // 持久化端口仍存在，恢复该选择
          setSelectedPortLocal(persistedSelectedPort);
        } else {
          // 持久化端口已不存在，回退到第一个可用端口
          setSelectedPort(ports[0].port_name);
        }
      } else if (!selectedPort || !ports.some(p => p.port_name === selectedPort)) {
        // 本地无选择或已失效，选第一个
        setSelectedPort(ports[0].port_name);
      }
    }
  }, [ports, isConnected, persistedSelectedPort, selectedPort, setSelectedPort]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setErrorMsg("");
    try {
      await onRefresh();
      success(t("connection.refreshSuccess"), { portLabel, toast: true, log: false });
    } catch (e) {
      const errMsg = `${t("connection.refreshFailed")}: ${String(e)}`;
      setErrorMsg(errMsg);
      error(errMsg, { portLabel, toast: true, log: true });
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefresh, t, success, error, portLabel]);

  const handleConnect = useCallback(async () => {
    // ✅ 使用 displayPort 确保连接时用的是正确的端口
    const portToConnect = isConnected && connectedPortName ? connectedPortName : selectedPort;
    if (!portToConnect) return;
    setIsConnecting(true);
    setErrorMsg("");
    const config: SerialConfig = {
      baud_rate: baudRate,
      data_bits: dataBits,
      parity,
      stop_bits: stopBits,
      flow_control: savedConfig.flow_control,
      dtr,
      rts,
    };
    try {
      await onConnect(portToConnect, config);
      // 连接成功后保存配置到 store
      setConfig(portLabel, config);
      success(t("connection.connectSuccess", { port: portToConnect }), { portLabel, toast: true, log: true });
    } catch (e) {
      const err = e as { message?: string };
      const errMsg = `${t("connection.connectFailed")}: ${err.message ?? String(e)}`;
      setErrorMsg(errMsg);
      error(errMsg, { portLabel, toast: true, log: true });
    } finally {
      setIsConnecting(false);
    }
  }, [isConnected, connectedPortName, selectedPort, baudRate, dataBits, parity, stopBits, dtr, rts, savedConfig.flow_control, onConnect, setConfig, portLabel, t, success, error]);

  const handleDtrToggle = useCallback(async (checked: boolean) => {
    setDtr(checked);
    // 更新持久化配置（复选框值=初始基准）
    const newConfig = { ...savedConfig, dtr: checked };
    setConfig(portLabel, newConfig);
    // 已连接时立即下发
    if (isConnected) {
      try {
        await setSerialDtr(portLabel, checked);
      } catch (e) {
        error(`Failed to set DTR: ${String(e)}`, { portLabel, toast: true, log: true });
      }
    }
  }, [savedConfig, setConfig, portLabel, isConnected, setSerialDtr, error]);

  const handleRtsToggle = useCallback(async (checked: boolean) => {
    setRts(checked);
    const newConfig = { ...savedConfig, rts: checked };
    setConfig(portLabel, newConfig);
    if (isConnected) {
      try {
        await setSerialRts(portLabel, checked);
      } catch (e) {
        error(`Failed to set RTS: ${String(e)}`, { portLabel, toast: true, log: true });
      }
    }
  }, [savedConfig, setConfig, portLabel, isConnected, setSerialRts, error]);

  const handleDisconnect = useCallback(async () => {
    setErrorMsg("");
    try {
      await onDisconnect();
      success(t("connection.disconnectSuccess"), { portLabel, toast: true, log: true });
    } catch (e) {
      const errMsg = String(e);
      setErrorMsg(errMsg);
      error(errMsg, { portLabel, toast: true, log: true });
    }
  }, [onDisconnect, success, error, portLabel, t]);

  return (
    <div className="flex flex-col gap-4">
      {/* 状态徽章 */}
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">{portLabel}</span>
          <Badge variant={isConnected ? "success" : "secondary"}>
            {isConnected ? t("connection.connected") : t("connection.disconnected")}
          </Badge>
        </div>
      )}

      {/* 端口选择 + 刷新 */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t("connection.port")}</label>
        <div className="flex items-center gap-2">
          <select
            className="flex-1 h-9 px-2 text-sm rounded-md border border-input bg-background disabled:opacity-50"
            value={displayPort}
            onChange={(e) => setSelectedPort(e.target.value)}
            disabled={isConnected}
          >
            {ports.length === 0 ? (
              <option value="">{t("connection.noPorts")}</option>
            ) : (
              ports.map((p) => (
                <option key={p.port_name} value={p.port_name}>
                  {p.friendly_name ?? p.port_name}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-border hover:bg-secondary disabled:opacity-50"
            onClick={() => void handleRefresh()}
            disabled={isRefreshing || isConnected}
            title={t("connection.refresh")}
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* 波特率 */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">
          {t("connection.baudRate")}
          {!isConnected && (
            <span className="ml-1.5 text-[10px] text-muted-foreground/60">
              {t("connection.baudRateHint")}
            </span>
          )}
        </label>
        {isCustomBaudRate ? (
          <input
            type="number"
            className="h-9 px-2 text-sm rounded-md border border-input bg-background disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary"
            value={baudRate}
            onChange={(e) => setBaudRate(Number(e.target.value))}
            onBlur={() => setIsCustomBaudRate(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") {
                setIsCustomBaudRate(false);
              }
            }}
            disabled={isConnected}
            autoFocus
            min={300}
            max={4000000}
          />
        ) : (
          <select
            className="h-9 px-2 text-sm rounded-md border border-input bg-background disabled:opacity-50 cursor-pointer"
            value={BAUD_RATES.includes(baudRate) ? baudRate : "custom"}
            onChange={(e) => {
              const val = e.target.value;
              if (val !== "custom") {
                setBaudRate(Number(val));
              }
            }}
            onDoubleClick={() => !isConnected && setIsCustomBaudRate(true)}
            disabled={isConnected}
          >
            {BAUD_RATES.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
            {!BAUD_RATES.includes(baudRate) && (
              <option value="custom">{t("connection.customBaudRate", { baudRate })}</option>
            )}
          </select>
        )}
      </div>

      {/* 数据位 / 停止位 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">{t("connection.dataBits")}</label>
          <select
            className="h-9 px-2 text-sm rounded-md border border-input bg-background disabled:opacity-50"
            value={dataBits}
            onChange={(e) => setDataBits(Number(e.target.value) as 5 | 6 | 7 | 8)}
            disabled={isConnected}
          >
            {DATA_BITS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">{t("connection.stopBits")}</label>
          <select
            className="h-9 px-2 text-sm rounded-md border border-input bg-background disabled:opacity-50"
            value={stopBits}
            onChange={(e) => setStopBits(Number(e.target.value) as 1 | 2)}
            disabled={isConnected}
          >
            {STOP_BITS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* 校验位 */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">{t("connection.parity")}</label>
        <select
          className="h-9 px-2 text-sm rounded-md border border-input bg-background disabled:opacity-50"
          value={parity}
          onChange={(e) => setParity(e.target.value as "none" | "even" | "odd")}
          disabled={isConnected}
        >
          <option value="none">{t("connection.parityNone")}</option>
          <option value="even">{t("connection.parityEven")}</option>
          <option value="odd">{t("connection.parityOdd")}</option>
        </select>
      </div>

      {/* 硬件信号：RTS / DTR 复选框（已连接时勾选立即生效） */}
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1.5 text-sm cursor-pointer" title={t("connection.rtsHint")}>
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={rts}
            onChange={(e) => void handleRtsToggle(e.target.checked)}
          />
          {t("connection.rts")}
        </label>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer" title={t("connection.dtrHint")}>
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={dtr}
            onChange={(e) => void handleDtrToggle(e.target.checked)}
          />
          {t("connection.dtr")}
        </label>
      </div>

      {/* 连接/断开按钮 */}
      <button
        type="button"
        className={`h-10 mt-2 inline-flex items-center justify-center gap-2 text-sm font-medium rounded-md transition-spring ${
          isConnected
            ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
            : "btn-connect"
        } disabled:opacity-50`}
        onClick={isConnected ? () => void handleDisconnect() : () => void handleConnect()}
        disabled={isConnecting || (!isConnected && !displayPort)}
      >
        {isConnecting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : isConnected ? (
          <PlugZap className="w-4 h-4" />
        ) : (
          <Plug className="w-4 h-4" />
        )}
        {isConnecting
          ? t("connection.connecting")
          : isConnected
          ? t("connection.disconnect")
          : t("connection.connect")}
      </button>

      {/* 错误提示 */}
      {errorMsg && (
        <p className="text-xs text-destructive break-words">{errorMsg}</p>
      )}
    </div>
  );
}

/** 主组件：P1 + 可折叠 P2 */
const SerialConnection = () => {
  const { t } = useTranslation();
  const { ports, connectionStatus } = useSerialStore();
  const { getSerialPorts, connectSerialPort, disconnectSerialPort } = useSerialCommands();
  const [p2Expanded, setP2Expanded] = useState(false);

  // 首次挂载自动刷新端口
  useEffect(() => {
    void getSerialPorts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = useCallback(async () => {
    await getSerialPorts();
  }, [getSerialPorts]);

  // 快捷键订阅：Ctrl+R 刷新串口
  useShortcutAction("refreshPorts", handleRefresh);

  const handleConnectP1 = useCallback(async (portName: string, config: SerialConfig) => {
    await connectSerialPort("P1", portName, config);
  }, [connectSerialPort]);

  const handleDisconnectP1 = useCallback(async () => {
    await disconnectSerialPort("P1");
  }, [disconnectSerialPort]);

  const handleConnectP2 = useCallback(async (portName: string, config: SerialConfig) => {
    await connectSerialPort("P2", portName, config);
  }, [connectSerialPort]);

  const handleDisconnectP2 = useCallback(async () => {
    await disconnectSerialPort("P2");
  }, [disconnectSerialPort]);

  const { ref, scale } = useAutoScale([p2Expanded]);

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden custom-scrollbar">
      <div ref={ref} className="flex flex-col min-h-full" style={scaleStyle(scale)}>
        <div className="p-4">
          {/* P1 配置 */}
          <PortConfigPanel
            portLabel="P1"
            ports={ports}
            isConnected={connectionStatus.p1_connected}
            onRefresh={handleRefresh}
            onConnect={handleConnectP1}
            onDisconnect={handleDisconnectP1}
          />
        </div>

        {/* 占位，将 P2 推到底部（仅在折叠时） */}
        {!p2Expanded && <div className="flex-1" />}

        {/* 分隔线 */}
        <div className="border-t border-border" />

        {/* P2 可折叠区 */}
        <div className="p-4">
          <button
            type="button"
            className="w-full flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-secondary transition-colors"
            onClick={() => setP2Expanded(!p2Expanded)}
          >
            <div className="flex items-center gap-2">
              {p2Expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              <span className="text-sm font-medium">P2</span>
            </div>
            <Badge variant={connectionStatus.p2_connected ? "success" : "secondary"} className="text-xs">
              {connectionStatus.p2_connected ? t("connection.connected") : t("connection.disconnected")}
            </Badge>
          </button>

          {p2Expanded && (
            <div className="mt-4">
              <PortConfigPanel
                portLabel="P2"
                ports={ports}
                isConnected={connectionStatus.p2_connected}
                hideHeader
                onRefresh={handleRefresh}
                onConnect={handleConnectP2}
                onDisconnect={handleDisconnectP2}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SerialConnection;
