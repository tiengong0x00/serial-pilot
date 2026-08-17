import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

interface NetDataEvent {
  connection_id: string;
  data: number[];
  timestamp: number;
  remote_addr?: string;
}

interface NetStatusEvent {
  connection_id: string;
  status: "connected" | "disconnected" | "error";
  message?: string;
  timestamp: number;
}

interface LogEntry {
  timestamp: number;
  direction: "tx" | "rx";
  data: number[];
  remote?: string;
}

const TCP_CONN_ID = "toolbox-tcp";
const UDP_CONN_ID = "toolbox-udp";

export default function NetworkTools() {
  const { t } = useTranslation();
  const [activeTool, setActiveTool] = useState<"tcp" | "udp">("tcp");

  return (
    <div className="h-full flex">
      {/* 左侧工具列表 */}
      <div className="w-48 border-r bg-muted/20 p-3">
        <button
          onClick={() => setActiveTool("tcp")}
          className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
            activeTool === "tcp"
              ? "bg-primary text-primary-foreground font-medium"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          {t("toolbox.network.tcp")}
        </button>
        <button
          onClick={() => setActiveTool("udp")}
          className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors mt-1 ${
            activeTool === "udp"
              ? "bg-primary text-primary-foreground font-medium"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          {t("toolbox.network.udp")}
        </button>
      </div>

      {/* 右侧工具内容 */}
      <div className="flex-1 overflow-y-auto">
        {activeTool === "tcp" && <TcpClient />}
        {activeTool === "udp" && <UdpClient />}
      </div>
    </div>
  );
}

function TcpClient() {
  const { t } = useTranslation();
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("8080");
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("");

  // 本地地址（连接后由后端返回）
  const [localIp, setLocalIp] = useState("");
  const [localPort, setLocalPort] = useState("");

  const [sendData, setSendData] = useState("");
  const [sendFormat, setSendFormat] = useState<"text" | "hex">("text");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [displayFormat, setDisplayFormat] = useState<"text" | "hex">("text");

  useEffect(() => {
    let dataUnlisten: UnlistenFn | null = null;
    let statusUnlisten: UnlistenFn | null = null;

    void (async () => {
      dataUnlisten = await listen<NetDataEvent>("net://data", (event) => {
        if (event.payload.connection_id === TCP_CONN_ID) {
          setLogs((prev) => [
            ...prev,
            {
              timestamp: event.payload.timestamp,
              direction: "rx",
              data: event.payload.data,
            },
          ]);
        }
      });

      statusUnlisten = await listen<NetStatusEvent>("net://status", (event) => {
        if (event.payload.connection_id === TCP_CONN_ID) {
          if (event.payload.status === "disconnected" || event.payload.status === "error") {
            setConnected(false);
            setStatus(event.payload.message || event.payload.status);
          }
        }
      });
    })();

    return () => {
      void dataUnlisten?.();
      void statusUnlisten?.();
    };
  }, []);

  const handleConnect = async () => {
    try {
      const response = await invoke<{ local_ip: string; local_port: number }>(
        "tcp_connect",
        {
          connectionId: TCP_CONN_ID,
          host,
          port: parseInt(port),
        }
      );
      setConnected(true);
      setLocalIp(response.local_ip);
      setLocalPort(String(response.local_port));
      setStatus(t("toolbox.network.connected"));
      setLogs([]);
    } catch (err) {
      setStatus(String(err));
    }
  };

  const handleDisconnect = async () => {
    try {
      await invoke("net_disconnect", { connectionId: TCP_CONN_ID });
      setConnected(false);
      setLocalIp("");
      setLocalPort("");
      setStatus(t("toolbox.network.disconnected"));
    } catch (err) {
      setStatus(String(err));
    }
  };

  const handleSend = async () => {
    if (!sendData.trim()) return;

    try {
      let bytes: number[];
      if (sendFormat === "hex") {
        const hex = sendData.replace(/\s/g, "");
        bytes = [];
        for (let i = 0; i < hex.length; i += 2) {
          bytes.push(parseInt(hex.substr(i, 2), 16));
        }
      } else {
        bytes = Array.from(new TextEncoder().encode(sendData));
      }

      await invoke("tcp_send", {
        connectionId: TCP_CONN_ID,
        data: bytes,
      });

      setLogs((prev) => [
        ...prev,
        {
          timestamp: Date.now(),
          direction: "tx",
          data: bytes,
        },
      ]);
      // 不清空 sendData，保留发送内容
    } catch (err) {
      setStatus(String(err));
    }
  };

  const formatData = (data: number[], format: "text" | "hex"): string => {
    if (format === "hex") {
      return data.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
    }
    return new TextDecoder().decode(new Uint8Array(data));
  };

  return (
    <div className="p-6 space-y-4">
      {/* 连接配置卡片 */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">{t("toolbox.network.tcp")}</h2>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1.5">
              {t("toolbox.network.remoteHost")}
            </label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              disabled={connected}
              className="w-full h-9 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">
              {t("toolbox.network.remotePort")}
            </label>
            <input
              type="text"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              disabled={connected}
              className="w-full h-9 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">
              {t("toolbox.network.localIp")}
            </label>
            <input
              type="text"
              value={connected ? localIp : "—"}
              disabled
              className="w-full h-9 px-3 text-sm rounded-md border border-input bg-muted/30 text-muted-foreground font-mono"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">
              {t("toolbox.network.localPort")}
            </label>
            <input
              type="text"
              value={connected ? localPort : "—"}
              disabled
              className="w-full h-9 px-3 text-sm rounded-md border border-input bg-muted/30 text-muted-foreground font-mono"
            />
          </div>
        </div>

        <div className="flex gap-2 items-center">
          {!connected ? (
            <button
              onClick={() => void handleConnect()}
              className="h-9 px-4 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md text-sm font-medium transition-colors"
            >
              {t("toolbox.network.connect")}
            </button>
          ) : (
            <button
              onClick={() => void handleDisconnect()}
              className="h-9 px-4 bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-md text-sm font-medium transition-colors"
            >
              {t("toolbox.network.disconnect")}
            </button>
          )}
          {status && (
            <span className="text-sm text-muted-foreground">{status}</span>
          )}
        </div>
      </div>

      {connected && (
        <>
          {/* 发送区 */}
          <div className="space-y-2 pt-2 border-t">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                {t("toolbox.network.send")}
              </label>
              <FormatToggle value={sendFormat} onChange={setSendFormat} t={t} />
            </div>
            <textarea
              value={sendData}
              onChange={(e) => setSendData(e.target.value)}
              className="w-full h-20 px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary font-mono resize-none"
              placeholder={sendFormat === "hex" ? "01 02 03 FF" : "Hello"}
            />
            <button
              onClick={() => void handleSend()}
              className="h-9 px-4 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md text-sm font-medium transition-colors"
            >
              {t("toolbox.network.send")}
            </button>
          </div>

          {/* 日志区 */}
          <div className="space-y-2 pt-2 border-t">
            <div className="flex justify-between items-center">
              <label className="text-sm font-medium">
                {t("toolbox.network.log")}
              </label>
              <div className="flex gap-2 items-center">
                <FormatToggle value={displayFormat} onChange={setDisplayFormat} t={t} />
                <button
                  onClick={() => setLogs([])}
                  className="h-7 px-3 text-xs rounded-md border border-input hover:bg-muted transition-colors"
                >
                  {t("toolbox.network.clear")}
                </button>
              </div>
            </div>
            <div className="border border-input rounded-md bg-muted/30 p-2 h-64 overflow-y-auto font-mono text-xs">
              {logs.map((log, i) => (
                <LogLine key={i} log={log} displayFormat={displayFormat} formatData={formatData} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function UdpClient() {
  const { t } = useTranslation();
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("");

  // 本地配置
  const [localPort, setLocalPort] = useState("0");
  const [localIp, setLocalIp] = useState("");
  const [actualLocalPort, setActualLocalPort] = useState("");

  // 对端配置
  const [targetHost, setTargetHost] = useState("127.0.0.1");
  const [targetPort, setTargetPort] = useState("8080");

  const [sendData, setSendData] = useState("");
  const [sendFormat, setSendFormat] = useState<"text" | "hex">("text");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [displayFormat, setDisplayFormat] = useState<"text" | "hex">("text");

  useEffect(() => {
    let dataUnlisten: UnlistenFn | null = null;
    let statusUnlisten: UnlistenFn | null = null;

    void (async () => {
      dataUnlisten = await listen<NetDataEvent>("net://data", (event) => {
        if (event.payload.connection_id === UDP_CONN_ID) {
          setLogs((prev) => [
            ...prev,
            {
              timestamp: event.payload.timestamp,
              direction: "rx",
              data: event.payload.data,
            },
          ]);
        }
      });

      statusUnlisten = await listen<NetStatusEvent>("net://status", (event) => {
        if (event.payload.connection_id === UDP_CONN_ID) {
          if (event.payload.status === "error") {
            setConnected(false);
            setStatus(event.payload.message || "error");
          }
        }
      });
    })();

    return () => {
      void dataUnlisten?.();
      void statusUnlisten?.();
    };
  }, []);

  const handleConnect = async () => {
    try {
      const response = await invoke<{ local_ip: string; local_port: number }>(
        "udp_connect",
        {
          connectionId: UDP_CONN_ID,
          localPort: parseInt(localPort) || 0,
          targetHost,
          targetPort: parseInt(targetPort),
        }
      );
      setConnected(true);
      setLocalIp(response.local_ip);
      setActualLocalPort(String(response.local_port));
      setStatus(t("toolbox.network.connected"));
      setLogs([]);
    } catch (err) {
      setStatus(String(err));
    }
  };

  const handleDisconnect = async () => {
    try {
      await invoke("net_disconnect", { connectionId: UDP_CONN_ID });
      setConnected(false);
      setLocalIp("");
      setActualLocalPort("");
      setStatus(t("toolbox.network.disconnected"));
    } catch (err) {
      setStatus(String(err));
    }
  };

  const handleSend = async () => {
    if (!sendData.trim()) return;

    try {
      let bytes: number[];
      if (sendFormat === "hex") {
        const hex = sendData.replace(/\s/g, "");
        bytes = [];
        for (let i = 0; i < hex.length; i += 2) {
          bytes.push(parseInt(hex.substr(i, 2), 16));
        }
      } else {
        bytes = Array.from(new TextEncoder().encode(sendData));
      }

      await invoke("udp_send", {
        connectionId: UDP_CONN_ID,
        data: bytes,
      });

      setLogs((prev) => [
        ...prev,
        {
          timestamp: Date.now(),
          direction: "tx",
          data: bytes,
        },
      ]);
      // 不清空 sendData，保留发送内容
    } catch (err) {
      setStatus(String(err));
    }
  };

  const formatData = (data: number[], format: "text" | "hex"): string => {
    if (format === "hex") {
      return data.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
    }
    return new TextDecoder().decode(new Uint8Array(data));
  };

  return (
    <div className="p-6 space-y-4">
      {/* 连接配置 */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">{t("toolbox.network.udp")}</h2>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1.5">
              {t("toolbox.network.remoteHost")}
            </label>
            <input
              type="text"
              value={targetHost}
              onChange={(e) => setTargetHost(e.target.value)}
              disabled={connected}
              className="w-full h-9 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">
              {t("toolbox.network.remotePort")}
            </label>
            <input
              type="text"
              value={targetPort}
              onChange={(e) => setTargetPort(e.target.value)}
              disabled={connected}
              className="w-full h-9 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">
              {t("toolbox.network.localIp")}
            </label>
            <input
              type="text"
              value={connected ? localIp : "—"}
              disabled
              className="w-full h-9 px-3 text-sm rounded-md border border-input bg-muted/30 text-muted-foreground font-mono"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">
              {t("toolbox.network.localPort")}
            </label>
            <input
              type="text"
              value={connected ? actualLocalPort : localPort}
              onChange={(e) => setLocalPort(e.target.value)}
              disabled={connected}
              placeholder={t("toolbox.network.autoPort")}
              className="w-full h-9 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:bg-muted/30 disabled:text-muted-foreground font-mono"
            />
          </div>
        </div>

        <div className="flex gap-2 items-center">
          {!connected ? (
            <button
              onClick={() => void handleConnect()}
              className="h-9 px-4 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md text-sm font-medium transition-colors"
            >
              {t("toolbox.network.connect")}
            </button>
          ) : (
            <button
              onClick={() => void handleDisconnect()}
              className="h-9 px-4 bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-md text-sm font-medium transition-colors"
            >
              {t("toolbox.network.disconnect")}
            </button>
          )}
          {status && (
            <span className="text-sm text-muted-foreground">{status}</span>
          )}
        </div>
      </div>

      {connected && (
        <>
          {/* 发送区 */}
          <div className="space-y-2 pt-2 border-t">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                {t("toolbox.network.send")}
              </label>
              <FormatToggle value={sendFormat} onChange={setSendFormat} t={t} />
            </div>
            <textarea
              value={sendData}
              onChange={(e) => setSendData(e.target.value)}
              className="w-full h-20 px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary font-mono resize-none"
              placeholder={sendFormat === "hex" ? "01 02 03 FF" : "Hello"}
            />
            <button
              onClick={() => void handleSend()}
              className="h-9 px-4 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md text-sm font-medium transition-colors"
            >
              {t("toolbox.network.send")}
            </button>
          </div>

          {/* 日志区 */}
          <div className="space-y-2 pt-2 border-t">
            <div className="flex justify-between items-center">
              <label className="text-sm font-medium">
                {t("toolbox.network.log")}
              </label>
              <div className="flex gap-2 items-center">
                <FormatToggle value={displayFormat} onChange={setDisplayFormat} t={t} />
                <button
                  onClick={() => setLogs([])}
                  className="h-7 px-3 text-xs rounded-md border border-input hover:bg-muted transition-colors"
                >
                  {t("toolbox.network.clear")}
                </button>
              </div>
            </div>
            <div className="border border-input rounded-md bg-muted/30 p-2 h-64 overflow-y-auto font-mono text-xs">
              {logs.map((log, i) => (
                <LogLine key={i} log={log} displayFormat={displayFormat} formatData={formatData} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ==================== 共享子组件 ====================

/** Text/Hex 格式切换（分段按钮组，主题 token 配色） */
function FormatToggle({
  value,
  onChange,
  t,
}: {
  value: "text" | "hex";
  onChange: (v: "text" | "hex") => void;
  t: (key: string) => string;
}) {
  return (
    <div className="flex gap-1">
      <button
        onClick={() => onChange("text")}
        className={`h-7 px-3 text-xs rounded-md border transition-colors ${
          value === "text"
            ? "bg-primary text-primary-foreground border-primary"
            : "border-input hover:bg-muted"
        }`}
      >
        {t("toolbox.network.text")}
      </button>
      <button
        onClick={() => onChange("hex")}
        className={`h-7 px-3 text-xs rounded-md border transition-colors ${
          value === "hex"
            ? "bg-primary text-primary-foreground border-primary"
            : "border-input hover:bg-muted"
        }`}
      >
        {t("toolbox.network.hex")}
      </button>
    </div>
  );
}

/** 单条收发日志行（TX 用 primary，RX 用 foreground，来源地址用 muted） */
function LogLine({
  log,
  displayFormat,
  formatData,
}: {
  log: LogEntry;
  displayFormat: "text" | "hex";
  formatData: (data: number[], format: "text" | "hex") => string;
}) {
  return (
    <div className="py-0.5 break-all">
      <span className="text-muted-foreground">
        [{new Date(log.timestamp).toLocaleTimeString()}]
      </span>{" "}
      <span className={`font-semibold ${log.direction === "tx" ? "text-primary" : "text-foreground"}`}>
        {log.direction === "tx" ? "TX" : "RX"}:
      </span>{" "}
      {log.remote && (
        <span className="text-muted-foreground">[{log.remote}]</span>
      )}{" "}
      <span className="text-foreground">{formatData(log.data, displayFormat)}</span>
    </div>
  );
}
