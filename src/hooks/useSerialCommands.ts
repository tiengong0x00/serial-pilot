import { invoke } from '@tauri-apps/api/core';
import { useCallback } from 'react';
import { useSerialStore } from '../stores/serialStore';
import { useSettingsStore } from '../stores/settingsStore';
import type { PortInfo, SerialConfig, ConnectionStatus, PortLabel } from '../types/serial';

/**
 * 封装 Tauri 串口命令调用的 Hook
 */
export function useSerialCommands() {
  const { setPorts, setConnectionStatus, setPortName } = useSerialStore();

  /**
   * 获取可用串口列表
   */
  const getSerialPorts = useCallback(async (): Promise<PortInfo[]> => {
    const ports = await invoke<PortInfo[]>('get_serial_ports');
    setPorts(ports);
    return ports;
  }, [setPorts]);

  /**
   * 连接串口并启动监听器
   */
  const connectSerialPort = useCallback(async (
    portLabel: PortLabel,
    portName: string,
    config: SerialConfig
  ): Promise<void> => {
    await invoke('connect_serial_port', {
      portLabel,
      portName,
      config,
    });
    // 连接成功后启动监听器，传入组包帧超时（从设置读取最新值）
    await invoke('start_serial_listener', {
      portLabel,
      frameTimeoutMs: useSettingsStore.getState().serialFrameTimeout,
    });

    // ✅ 连接成功后直接设置前端状态，消除竞态
    setPortName(portLabel, portName);
    const currentStatus = useSerialStore.getState().connectionStatus;
    setConnectionStatus({
      p1_connected: portLabel === 'P1' ? true : currentStatus.p1_connected,
      p2_connected: portLabel === 'P2' ? true : currentStatus.p2_connected,
    });
  }, [setConnectionStatus, setPortName]);

  /**
   * 断开串口
   */
  const disconnectSerialPort = useCallback(async (portLabel: PortLabel): Promise<void> => {
    await invoke('disconnect_serial_port', { portLabel });
    // 清除端口名
    setPortName(portLabel, null);
    // ✅ 断开后直接设置状态
    const currentStatus = useSerialStore.getState().connectionStatus;
    setConnectionStatus({
      p1_connected: portLabel === 'P1' ? false : currentStatus.p1_connected,
      p2_connected: portLabel === 'P2' ? false : currentStatus.p2_connected,
    });
  }, [setConnectionStatus, setPortName]);

  /**
   * 发送数据，返回后端生成的发送时间戳（与 RX 时间戳同源，避免前后端时钟不同步）
   */
  const writeSerialData = useCallback(async (
    portLabel: PortLabel,
    data: Uint8Array
  ): Promise<{ bytes_written: number; timestamp: number }> => {
    // ✅ 发送前检查本地状态
    const { connectionStatus } = useSerialStore.getState();
    const isConnected = portLabel === 'P1'
      ? connectionStatus.p1_connected
      : connectionStatus.p2_connected;

    if (!isConnected) {
      throw new Error(`${portLabel} not connected`);
    }

    return await invoke<{ bytes_written: number; timestamp: number }>('write_serial_data', {
      portLabel,
      data: Array.from(data),
    });
  }, []);

  /**
   * 获取连接状态
   */
  const getConnectionStatus = useCallback(async (): Promise<ConnectionStatus> => {
    const status = await invoke<ConnectionStatus>('get_connection_status');
    setConnectionStatus(status);
    return status;
  }, [setConnectionStatus]);

  /**
   * 设置 DTR 信号电平（已连接时立即下发）
   */
  const setSerialDtr = useCallback(async (portLabel: PortLabel, level: boolean): Promise<void> => {
    await invoke('set_serial_dtr', { portLabel, level });
  }, []);

  /**
   * 设置 RTS 信号电平（已连接时立即下发）
   */
  const setSerialRts = useCallback(async (portLabel: PortLabel, level: boolean): Promise<void> => {
    await invoke('set_serial_rts', { portLabel, level });
  }, []);

  return {
    getSerialPorts,
    connectSerialPort,
    disconnectSerialPort,
    writeSerialData,
    getConnectionStatus,
    setSerialDtr,
    setSerialRts,
  };
}
