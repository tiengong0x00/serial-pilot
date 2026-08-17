// 串口相关类型定义

export interface PortInfo {
  port_name: string;
  friendly_name?: string;
  vid?: number;
  pid?: number;
}

export interface SerialConfig {
  baud_rate: number;
  data_bits: 5 | 6 | 7 | 8;
  parity: 'none' | 'even' | 'odd';
  stop_bits: 1 | 2;
  flow_control: 'none' | 'software' | 'hardware';
  dtr: boolean;  // DTR 初始状态
  rts: boolean;  // RTS 初始状态
}

export interface ConnectionStatus {
  p1_connected: boolean;
  p2_connected: boolean;
}

export type PortLabel = 'P1' | 'P2';

export interface SerialError {
  kind: 'PortNotFound' | 'OpenFailed' | 'WriteFailed' | 'ReadFailed' |
        'AlreadyConnected' | 'NotConnected' | 'ConfigInvalid' | 'Internal';
  message: string;
}

// 串口数据事件负载（后端推送）
export interface SerialDataPayload {
  port_label: PortLabel;
  data: number[];
  timestamp: number;
}

// 串口异常类型
export type SerialErrorKind =
  | 'device_removed'      // 设备移除
  | 'connection_reset'    // 连接重置
  | 'permission_denied'   // 权限丢失
  | 'read_error'          // 读取错误
  | 'write_error'         // 写入错误
  | 'unknown';            // 未知错误

// 异常严重级别
export type Severity = 'fatal' | 'warning';

// 串口异常事件负载（后端推送）
export interface SerialErrorPayload {
  port_label: PortLabel;
  kind: SerialErrorKind;
  severity: Severity;
  message: string;
  timestamp: number;
}

// 终端消息类型
export type MessageType = 'TX' | 'RX' | 'SYS';

export interface TerminalMessage {
  id: string;
  type: MessageType;
  port_label?: PortLabel;
  data: Uint8Array;
  timestamp: number;
  text?: string; // UTF-8 解码后的文本（如果解码成功）
  sequence?: number; // 序列号，用于时间戳相同时的排序
}

