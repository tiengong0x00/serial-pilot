import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Circle, FileText, Trash2 } from "lucide-react";
import { useSerialStore } from "@/stores/serialStore";
import { useTerminalStore } from "@/stores/terminalStore";
import { useExecutionStore } from "@/stores/executionStore";
import { useSerialCommands } from "@/hooks/useSerialCommands";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import CriticalEventList from "@/components/execution/CriticalEventList";
import type { PortLabel } from "@/types/serial";

/** 快速配置下拉菜单 */
function QuickConfigDropdown({
  portLabel,
  isConnected,
  portName,
  selectedPort,
  baudRate,
  onConnect,
  onDisconnect,
  onSelectPort,
  onSelectBaudRate,
}: {
  portLabel: PortLabel;
  isConnected: boolean;
  portName: string | null;
  selectedPort: string | null;
  baudRate: number;
  onConnect: () => void;
  onDisconnect: () => void;
  onSelectPort: (port: string) => void;
  onSelectBaudRate: (baud: number) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [menuType, setMenuType] = useState<'port' | 'baud' | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { getSerialPorts } = useSerialCommands();
  const [availablePorts, setAvailablePorts] = useState<string[]>([]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setMenuType(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // 刷新串口列表
  const refreshPorts = useCallback(async () => {
    const ports = await getSerialPorts();
    setAvailablePorts(ports.map(p => p.port_name));
  }, [getSerialPorts]);

  const handlePortClick = async () => {
    await refreshPorts();
    setMenuType('port');
    setOpen(true);
  };

  const handleBaudClick = () => {
    setMenuType('baud');
    setOpen(true);
  };

  const commonBaudRates = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1000000, 1500000, 2000000];

  // 显示端口：已连接用实际端口名，未连接用持久化选择；波特率始终显示
  const displayPort = isConnected && portName ? portName : selectedPort;
  // 是否可切换/连接（有可用端口）
  const canConnect = !isConnected && !!selectedPort;

  return (
    <div className="relative inline-flex items-center gap-1" ref={dropdownRef}>
      {/* 连接灯 + P1/P2 标签（合并为大点击区：已连接→断开，未连接→连接） */}
      <button
        type="button"
        onClick={isConnected ? onDisconnect : (canConnect ? onConnect : undefined)}
        disabled={!isConnected && !canConnect}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${
          isConnected || canConnect
            ? 'cursor-pointer hover:bg-muted/60'
            : 'cursor-default'
        }`}
        title={isConnected ? t('statusFooter.clickToDisconnect') : (canConnect ? t('statusFooter.clickToConnect') : '')}
      >
        <Circle
          className={`w-2 h-2 ${
            isConnected
              ? "fill-success text-success"
              : "fill-muted-foreground/30 text-muted-foreground/30"
          }`}
        />
        <span className="font-mono text-xs">{portLabel}:</span>
      </button>

      {/* COM 口（点击切换） */}
      <button
        type="button"
        onClick={handlePortClick}
        className="font-mono text-xs hover:text-primary hover:underline cursor-pointer"
        title={t('statusFooter.clickToSwitchPort')}
      >
        {displayPort || t("app.disconnected")}
      </button>

      {/* 波特率（点击修改，始终显示） */}
      <button
        type="button"
        onClick={handleBaudClick}
        className="font-mono text-xs text-muted-foreground hover:text-primary hover:underline cursor-pointer"
        title={t('statusFooter.clickToChangeBaud')}
      >
        {baudRate}
      </button>

      {/* 下拉菜单 */}
      {open && menuType && (
        <div className="absolute bottom-full left-0 mb-1 min-w-[120px] bg-popover border rounded-md shadow-lg z-50 py-1">
          {menuType === 'port' && (
            <>
              {availablePorts.length > 0 ? (
                availablePorts.map(port => (
                  <button
                    key={port}
                    type="button"
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors"
                    onClick={() => {
                      onSelectPort(port);
                      setOpen(false);
                      setMenuType(null);
                    }}
                  >
                    {port}
                  </button>
                ))
              ) : (
                <div className="px-3 py-1.5 text-xs text-muted-foreground">
                  {t('statusFooter.noPortsAvailable')}
                </div>
              )}
            </>
          )}

          {menuType === 'baud' && (
            <>
              {commonBaudRates.map(baud => (
                <button
                  key={baud}
                  type="button"
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors ${
                    baud === baudRate ? 'bg-accent/50 font-medium' : ''
                  }`}
                  onClick={() => {
                    onSelectBaudRate(baud);
                    setOpen(false);
                    setMenuType(null);
                  }}
                >
                  {baud}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const StatusFooter = () => {
  const { t } = useTranslation();
  const { connectionStatus, p1PortName, p2PortName, p1Config, p2Config, setConfig, p1SelectedPort, p2SelectedPort, setSelectedPort } = useSerialStore();
  const { connectSerialPort, disconnectSerialPort } = useSerialCommands();
  const systemLogs = useTerminalStore((s) => s.systemLogs);
  const clearSystemLogs = useTerminalStore((s) => s.clearSystemLogs);
  const criticalEvents = useExecutionStore((s) => s.criticalEvents);
  const clearCriticalEvents = useExecutionStore((s) => s.clearCriticalEvents);
  const [logDialogOpen, setLogDialogOpen] = useState(false);

  // 清除全部日志（连接日志 + 执行关键事件）
  const handleClearLogs = () => {
    clearSystemLogs();
    clearCriticalEvents();
  };

  // 最新一条系统日志（头插，最新在 [0]；systemLogs 全部为 SYS 类型）
  const lastSystemMessage = systemLogs.length > 0 ? systemLogs[0] : undefined;

  // 合并系统日志和关键事件，按时间戳排序（最新在前）
  const mergedLogs = [
    ...systemLogs.map((log) => ({ type: 'system' as const, timestamp: log.timestamp, data: log })),
    ...criticalEvents.map((event) => ({ type: 'critical' as const, timestamp: event.timestamp, data: event })),
  ].sort((a, b) => b.timestamp - a.timestamp);

  // 快速断开
  const handleDisconnect = useCallback(async (portLabel: PortLabel) => {
    try {
      await disconnectSerialPort(portLabel);
    } catch (err) {
      console.error(`Failed to disconnect ${portLabel}:`, err);
    }
  }, [disconnectSerialPort]);

  // 快速连接（未连接时点击标签区触发，使用持久化选中的端口）
  const handleConnect = useCallback(async (portLabel: PortLabel) => {
    try {
      const config = portLabel === 'P1' ? p1Config : p2Config;
      const port = portLabel === 'P1' ? p1SelectedPort : p2SelectedPort;
      if (!port) return;
      await connectSerialPort(portLabel, port, config);
    } catch (err) {
      console.error(`Failed to connect ${portLabel}:`, err);
    }
  }, [p1Config, p2Config, p1SelectedPort, p2SelectedPort, connectSerialPort]);

  // 快速切换端口
  const handleSelectPort = useCallback(async (portLabel: PortLabel, portName: string) => {
    try {
      const config = portLabel === 'P1' ? p1Config : p2Config;
      const isConnected = portLabel === 'P1' ? connectionStatus.p1_connected : connectionStatus.p2_connected;

      // 记住用户选择（持久化）
      setSelectedPort(portLabel, portName);

      if (isConnected) {
        // 已连接：先断开再连新端口
        await disconnectSerialPort(portLabel);
        await connectSerialPort(portLabel, portName, config);
      }
      // 未连接：仅记录选择，不自动连接（由用户点击标签区连接）
    } catch (err) {
      console.error(`Failed to switch port for ${portLabel}:`, err);
    }
  }, [p1Config, p2Config, connectionStatus, setSelectedPort, disconnectSerialPort, connectSerialPort]);

  // 快速修改波特率
  const handleSelectBaudRate = useCallback(async (portLabel: PortLabel, baudRate: number) => {
    try {
      const config = portLabel === 'P1' ? p1Config : p2Config;
      const portName = portLabel === 'P1' ? p1PortName : p2PortName;
      const newConfig = { ...config, baud_rate: baudRate };

      // 更新配置（无论是否连接都持久化）
      setConfig(portLabel, newConfig);

      // 如果已连接，重新连接以应用新波特率
      const isConnected = portLabel === 'P1' ? connectionStatus.p1_connected : connectionStatus.p2_connected;
      if (isConnected && portName) {
        await disconnectSerialPort(portLabel);
        await connectSerialPort(portLabel, portName, newConfig);
      }
      // 未连接时：仅更新配置，下次连接时生效
    } catch (err) {
      console.error(`Failed to change baud rate for ${portLabel}:`, err);
    }
  }, [p1Config, p2Config, p1PortName, p2PortName, connectionStatus, setConfig, disconnectSerialPort, connectSerialPort]);

  return (
    <>
      <footer className="h-7 app-header px-4 flex items-center justify-between text-xs text-muted-foreground border-t border-border/50">
        {/* 左侧：连接状态（快速配置） */}
        <div className="flex items-center gap-4">
          {/* P1 快速配置 */}
          <QuickConfigDropdown
            portLabel="P1"
            isConnected={connectionStatus.p1_connected}
            portName={p1PortName}
            selectedPort={p1SelectedPort}
            baudRate={p1Config.baud_rate}
            onConnect={() => handleConnect('P1')}
            onDisconnect={() => handleDisconnect('P1')}
            onSelectPort={(port) => handleSelectPort('P1', port)}
            onSelectBaudRate={(baud) => handleSelectBaudRate('P1', baud)}
          />

          {/* P2 快速配置 */}
          <QuickConfigDropdown
            portLabel="P2"
            isConnected={connectionStatus.p2_connected}
            portName={p2PortName}
            selectedPort={p2SelectedPort}
            baudRate={p2Config.baud_rate}
            onConnect={() => handleConnect('P2')}
            onDisconnect={() => handleDisconnect('P2')}
            onSelectPort={(port) => handleSelectPort('P2', port)}
            onSelectBaudRate={(baud) => handleSelectBaudRate('P2', baud)}
          />
        </div>

        {/* 中间：最后一条系统消息（可点击查看完整日志） */}
        <div className="flex-1 mx-4 flex items-center justify-center">
          {lastSystemMessage && (
            <button
              type="button"
              className="flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-muted/50 transition-colors cursor-pointer"
              onClick={() => setLogDialogOpen(true)}
              title={t("statusFooter.clickToViewLogs")}
            >
              <FileText className="w-3 h-3" />
              <span className="truncate max-w-md">
                {lastSystemMessage.text || new TextDecoder().decode(lastSystemMessage.data)}
              </span>
            </button>
          )}
        </div>

        {/* 右侧：预留扩展区（如统计信息） */}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground/70">
            {systemLogs.length} {t("statusFooter.messages")}
          </span>
        </div>
      </footer>

      {/* 日志查看对话框 */}
      <Dialog open={logDialogOpen} onOpenChange={setLogDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <div className="flex items-center justify-between pr-6">
              <DialogTitle>{t("statusFooter.systemLogs")}</DialogTitle>
              <button
                type="button"
                onClick={handleClearLogs}
                disabled={mergedLogs.length === 0}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t("statusFooter.clearLogs")}
              </button>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-auto bg-muted/30 rounded-md p-4">
            {mergedLogs.length > 0 ? (
              <div className="space-y-2">
                {mergedLogs.map((item) => {
                  if (item.type === 'system') {
                    // 系统日志（连接相关）
                    const log = item.data;
                    const date = new Date(log.timestamp);
                    const time = date.toLocaleTimeString("zh-CN", {
                      hour12: false,
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    });
                    const ms = date.getMilliseconds().toString().padStart(3, "0");
                    const content = log.text || new TextDecoder().decode(log.data);
                    return (
                      <div key={`sys-${log.id}`} className="font-mono text-xs">
                        <span className="text-muted-foreground">[{time}.{ms}]</span>{" "}
                        <span>{content}</span>
                      </div>
                    );
                  } else {
                    // 关键事件（执行摘要）
                    return (
                      <div key={`critical-${item.data.id}`}>
                        <CriticalEventList events={[item.data]} />
                      </div>
                    );
                  }
                })}
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-8 text-sm">
                {t("statusFooter.noSystemLogs")}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default StatusFooter;
