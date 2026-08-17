import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useTerminalStore } from '../stores/terminalStore';
import { useSerialStore } from '../stores/serialStore';
import { toast } from 'sonner';
import type {
  SerialDataPayload,
  SerialErrorPayload,
  TerminalMessage,
  PortLabel,
} from '../types/serial';

/**
 * 监听串口数据与异常事件的 Hook
 *
 * - serial_data：接收数据，解码为 UTF-8 并写入 terminalStore
 * - serial_error：串口异常，按严重级别分派处理
 *   - fatal：清理后端资源 + 更新状态为未连接 + console.error + toast
 *   - warning：仅 console.warn，不显示、不 toast
 */
export function useSerialListener() {
  const addMessage = useTerminalStore((s) => s.addMessage);
  const { setConnectionStatus, setPortName } = useSerialStore();

  useEffect(() => {
    let unlistenData: UnlistenFn | undefined;
    let unlistenError: UnlistenFn | undefined;
    let isMounted = true;

    const setupListeners = async () => {
      // 数据事件监听
      unlistenData = await listen<SerialDataPayload>('serial_data', (event) => {
        if (!isMounted) return;
        const payload = event.payload;

        // ✅ 接收时验证连接状态：状态不符则丢弃僵尸数据
        const { connectionStatus } = useSerialStore.getState();
        const isConnected =
          payload.port_label === 'P1'
            ? connectionStatus.p1_connected
            : connectionStatus.p2_connected;

        if (!isConnected) {
          console.warn(
            `[${payload.port_label}] Received data but port marked as disconnected, discarding ${payload.data.length} bytes`
          );
          return;
        }

        const data = new Uint8Array(payload.data);

        // 尝试 UTF-8 解码
        let text: string | undefined;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(data);
        } catch {
          // 解码失败，保持 undefined
        }

        const message: TerminalMessage = {
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: 'RX',
          port_label: payload.port_label,
          data,
          timestamp: payload.timestamp,
          text,
        };

        addMessage(message);
      });

      // 异常事件监听
      unlistenError = await listen<SerialErrorPayload>('serial_error', async (event) => {
        if (!isMounted) return;
        const { port_label, kind, severity, message } = event.payload;

        if (severity === 'fatal') {
          // 致命错误：清理资源 + 更新状态
          console.error(`[${port_label}] Connection interrupted (${kind}): ${message}`);

          // 清理后端资源（force_cleanup 可能已清理，这里保证完整清理）
          try {
            await invoke('disconnect_serial_port', { portLabel: port_label });
          } catch (err) {
            // 后端可能已通过 force_cleanup 移除，忽略 NotConnected 错误
            console.debug(`[${port_label}] Cleanup resources (may have been cleaned by backend):`, err);
          }

          // 更新前端状态为未连接
          setPortName(port_label, null);
          const currentStatus = useSerialStore.getState().connectionStatus;
          setConnectionStatus({
            p1_connected: port_label === 'P1' ? false : currentStatus.p1_connected,
            p2_connected: port_label === 'P2' ? false : currentStatus.p2_connected,
          });

          // 提示用户（toast，不写终端）
          toast.error(`${port_label} disconnected: ${message}`);
        } else {
          // 警告级：仅控制台，不显示、不 toast
          console.warn(`[${port_label}] Warning (${kind}): ${message}`);
        }
      });
    };

    void setupListeners();

    return () => {
      isMounted = false;
      if (unlistenData) void unlistenData();
      if (unlistenError) void unlistenError();
    };
  }, [addMessage, setConnectionStatus, setPortName]);
}

// 供其他模块引用的端口标签类型（保持导出一致性）
export type { PortLabel };
