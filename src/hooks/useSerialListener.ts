import { useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useTerminalStore } from '../stores/terminalStore';
import { useSerialStore } from '../stores/serialStore';
import { useSettingsStore } from '../stores/settingsStore';
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
 *
 * # RX 智能追加逻辑（v2 架构）
 * 后端零延迟转发字节流，前端根据 serialFrameTimeout 设置决定追加策略：
 * - 与上一条 RX 间隔 < serialFrameTimeout：追加到上一条消息末尾
 * - 否则：新起一行
 */
export function useSerialListener() {
  const addMessage = useTerminalStore((s) => s.addMessage);
  const { setConnectionStatus, setPortName } = useSerialStore();
  const serialFrameTimeout = useSettingsStore((s) => s.serialFrameTimeout);

  // 追踪最后一条 RX 消息，用于智能追加判断
  const lastRxRef = useRef<{
    portLabel: PortLabel;
    timestamp: number;
    messageId: string;
  } | null>(null);

  useEffect(() => {
    let unlistenData: UnlistenFn | undefined;
    let unlistenError: UnlistenFn | undefined;
    let isMounted = true;

    const setupListeners = async () => {
      // 数据事件监听
      unlistenData = await listen<SerialDataPayload>('serial_data', (event) => {
        const t0 = performance.now();
        const receiveTs = Date.now();
        if (!isMounted) return;
        const payload = event.payload;

        console.log(`[PERF] serial_data event: label=${payload.port_label}, bytes=${payload.data.length}, backend_ts=${payload.timestamp}, receive_ts=${receiveTs}, backend_to_frontend=${receiveTs - payload.timestamp}ms`);

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

        const t1 = performance.now();
        const data = new Uint8Array(payload.data);

        // 尝试 UTF-8 解码
        let text: string | undefined;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(data);
        } catch {
          // 解码失败，保持 undefined
        }

        const t2 = performance.now();
        const now = Date.now();
        const lastRx = lastRxRef.current;

        // 智能追加判断：与上一条 RX 间隔 < serialFrameTimeout 则追加
        const shouldMerge =
          lastRx !== null &&
          lastRx.portLabel === payload.port_label &&
          now - lastRx.timestamp < serialFrameTimeout;

        if (shouldMerge) {
          // 追加到上一条 RX 消息的末尾
          const messages = useTerminalStore.getState().messages;
          const targetIdx = messages.findIndex((m) => m.id === lastRx.messageId);
          if (targetIdx !== -1) {
            const target = messages[targetIdx];
            // 合并数据和文本
            const mergedData = new Uint8Array(target.data.length + data.length);
            mergedData.set(target.data);
            mergedData.set(data, target.data.length);
            const mergedText = (target.text || '') + (text || '');

            useTerminalStore.setState({
              messages: [
                ...messages.slice(0, targetIdx),
                {
                  ...target,
                  data: mergedData,
                  text: mergedText || undefined,
                },
                ...messages.slice(targetIdx + 1),
              ],
            });

            // 更新追踪（时间戳更新为当前，ID 保持不变）
            lastRxRef.current = {
              portLabel: payload.port_label,
              timestamp: now,
              messageId: lastRx.messageId,
            };

            const t3 = performance.now();
            console.log(
              `[PERF] serial_data[${payload.port_label}] MERGE: validation=${(t1 - t0).toFixed(2)}ms, decode=${(t2 - t1).toFixed(2)}ms, merge=${(t3 - t2).toFixed(2)}ms, total=${(t3 - t0).toFixed(2)}ms`
            );
            return;
          }
        }

        // 新起一行
        // 使用前端接收时刻 now，而非后端 payload.timestamp，
        // 保证与 TX（用户点击时刻）在同一时间基准下正确排序
        const t3 = performance.now();
        const message: TerminalMessage = {
          id: `${now}-${Math.random().toString(36).substr(2, 9)}`,
          type: 'RX',
          port_label: payload.port_label,
          data,
          timestamp: now,
          text,
        };

        const t4 = performance.now();
        addMessage(message);
        const t5 = performance.now();

        // 更新追踪
        lastRxRef.current = {
          portLabel: payload.port_label,
          timestamp: now,
          messageId: message.id,
        };

        console.log(
          `[PERF] serial_data[${payload.port_label}] NEW: validation=${(t1 - t0).toFixed(2)}ms, decode=${(t2 - t1).toFixed(2)}ms, prepare=${(t4 - t3).toFixed(2)}ms, addMessage=${(t5 - t4).toFixed(2)}ms, total=${(t5 - t0).toFixed(2)}ms`
        );
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
  }, [addMessage, setConnectionStatus, setPortName, serialFrameTimeout]);
}

// 供其他模块引用的端口标签类型（保持导出一致性）
export type { PortLabel };
