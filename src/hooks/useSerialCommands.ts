import { invoke } from '@tauri-apps/api/core';
import { useCallback } from 'react';
import { useSerialStore } from '../stores/serialStore';
import { useSettingsStore } from '../stores/settingsStore';
import type { PortInfo, SerialConfig, ConnectionStatus, PortLabel, AttachmentRef } from '../types/serial';

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
      // 传入单包大小用于后端计算固定写超时
      filePacketSize: useSettingsStore.getState().filePacketSize,
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

    // 从设置读取分包参数
    const { filePacketSize, filePacketInterval } = useSettingsStore.getState();

    const result = await invoke<{ bytes_written: number; timestamp: number }>('write_serial_data', {
      portLabel,
      data: Array.from(data),
      filePacketSize,
      filePacketInterval,
    });
    return result;
  }, []);

  /**
   * 保存附件到磁盘缓存,返回引用(id/name/size)。字节仅上传时走一次 IPC。
   */
  const saveAttachment = useCallback(async (
    data: Uint8Array,
    name: string
  ): Promise<AttachmentRef> => {
    return await invoke<AttachmentRef>('save_attachment', {
      data: Array.from(data),
      name,
    });
  }, []);

  /**
   * 检查附件是否存在(执行前校验)
   */
  const attachmentExists = useCallback(async (id: string): Promise<boolean> => {
    return await invoke<boolean>('attachment_exists', { id });
  }, []);

  /**
   * 删除附件(取消/移除文件时调用)
   */
  const deleteAttachment = useCallback(async (id: string): Promise<void> => {
    await invoke('delete_attachment', { id });
  }, []);

  /**
   * 发送附件:后端按 id 流式读盘分块发送并 emit 进度事件。
   * 前端订阅 file_send_progress 更新进度条,不再逐片 invoke。
   */
  const sendAttachment = useCallback(async (
    portLabel: PortLabel,
    id: string
  ): Promise<void> => {
    const { connectionStatus } = useSerialStore.getState();
    const isConnected = portLabel === 'P1'
      ? connectionStatus.p1_connected
      : connectionStatus.p2_connected;
    if (!isConnected) {
      throw new Error(`${portLabel} not connected`);
    }

    // filePacketSize 复用为"写入块大小",filePacketInterval 复用为"块间延时"
    const { filePacketSize, filePacketInterval } = useSettingsStore.getState();

    await invoke('send_attachment', {
      portLabel,
      id,
      blockSize: filePacketSize,
      intervalMs: filePacketInterval,
    });
  }, []);

  /**
   * 取消指定端口正在进行的文件发送
   */
  const cancelFileSend = useCallback(async (portLabel: PortLabel): Promise<void> => {
    await invoke('cancel_file_send', { portLabel });
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
    saveAttachment,
    attachmentExists,
    deleteAttachment,
    sendAttachment,
    cancelFileSend,
    getConnectionStatus,
    setSerialDtr,
    setSerialRts,
  };
}
