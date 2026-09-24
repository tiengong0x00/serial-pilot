import { invoke } from '@tauri-apps/api/core';
import { useSerialStore } from '../stores/serialStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useTerminalStore } from '../stores/terminalStore';
import type { PortInfo, SerialConfig, PortLabel } from '../types/serial';

/**
 * 串口短时断连的静默自动恢复。
 *
 * 场景：USB 虚拟串口设备硬件复位时，COM 端口会短时间消失又重新出现。
 * 现有逻辑会把这类掉线当作致命错误直接断开并报错，需要用户手动重连。
 *
 * 本模块在致命错误发生时，于一个很短的时间窗内静默尝试重连（不弹 toast、
 * 不改 UI 文案）：窗口内恢复则用户几乎无感；超时才退回原有的永久断开路径。
 *
 * 设计原则：纯前端、复用已有连接参数、不改 Rust；参数写死为常量（不暴露给用户）。
 */

interface KnownConnection {
  portName: string;
  config: SerialConfig;
  vid?: number;
  pid?: number;
}

// 各端口最近一次"成功连接"的参数，用于自动恢复。仅内存态。
const known = new Map<PortLabel, KnownConnection>();
// 正在重连的端口，避免重复触发的重连循环叠加。
const reconnecting = new Set<PortLabel>();

// 自动恢复时间窗：超过则放弃，退回永久断开。按需求固定 1.5s。
const RECONNECT_WINDOW_MS = 1500;
// 窗口内的探测/重试间隔。
const RECONNECT_PROBE_MS = 200;

/** 底层连接 + 启动监听 + 置前端状态。connectSerialPort 与自动恢复共用，避免逻辑分叉。 */
export async function openPort(
  label: PortLabel,
  portName: string,
  config: SerialConfig
): Promise<void> {
  await invoke('connect_serial_port', {
    portLabel: label,
    portName,
    config,
    filePacketSize: useSettingsStore.getState().filePacketSize,
  });
  await invoke('start_serial_listener', {
    portLabel: label,
    frameTimeoutMs: useSettingsStore.getState().serialFrameTimeout,
  });
  // 封存旧帧，避免新连接 frame_id 重置后与旧帧冲突
  useTerminalStore.getState().sealPortFrames(label);
  const { setPortName, setConnectionStatus, connectionStatus } = useSerialStore.getState();
  setPortName(label, portName);
  setConnectionStatus({
    p1_connected: label === 'P1' ? true : connectionStatus.p1_connected,
    p2_connected: label === 'P2' ? true : connectionStatus.p2_connected,
  });
}

/** 连接成功后记录参数（含 vid/pid，用于复位后换 COM 号时重匹配设备）。 */
export function recordConnection(label: PortLabel, portName: string, config: SerialConfig): void {
  const info = useSerialStore.getState().ports.find((p) => p.port_name === portName);
  known.set(label, { portName, config, vid: info?.vid, pid: info?.pid });
}

/** 用户主动断开时调用，清除记录以阻止自动恢复。 */
export function forgetConnection(label: PortLabel): void {
  known.delete(label);
}

/** 端口重匹配：优先同名，其次同 vid+pid（应对复位后 COM 号变化）。 */
function findTarget(ports: PortInfo[], kc: KnownConnection): string | null {
  const byName = ports.find((p) => p.port_name === kc.portName);
  if (byName) return byName.port_name;
  if (kc.vid != null && kc.pid != null) {
    const byId = ports.find((p) => p.vid === kc.vid && p.pid === kc.pid);
    if (byId) return byId.port_name;
  }
  return null;
}

/**
 * 在 1s 窗口内静默尝试恢复连接。
 * @returns 成功恢复返回 true；无记录 / 已在重连 / 超时返回 false（调用方走永久断开）。
 */
export async function attemptSilentReconnect(label: PortLabel): Promise<boolean> {
  const kc = known.get(label);
  if (!kc) return false;                 // 无记录（如用户已主动断开）
  if (reconnecting.has(label)) return false;
  reconnecting.add(label);
  try {
    // 先确保后端句柄已释放（disconnect 会阻塞等待底层 COM 关闭），避免重连撞句柄
    try {
      await invoke('disconnect_serial_port', { portLabel: label });
    } catch {
      // 可能已被后端清理，忽略
    }

    const start = Date.now();
    while (Date.now() - start < RECONNECT_WINDOW_MS) {
      // 用户在窗口内主动断开 → 记录被清除 → 放弃恢复
      if (!known.has(label)) return false;

      let ports: PortInfo[] = [];
      try {
        ports = await invoke<PortInfo[]>('get_serial_ports');
      } catch {
        ports = [];
      }
      const target = findTarget(ports, kc);
      if (target) {
        try {
          await openPort(label, target, kc.config);
          return true;                   // 静默恢复成功
        } catch {
          // 端口刚出现但尚未就绪，继续在窗口内重试
        }
      }
      await new Promise((r) => setTimeout(r, RECONNECT_PROBE_MS));
    }
    return false;                        // 超时，退回永久断开
  } finally {
    reconnecting.delete(label);
  }
}
