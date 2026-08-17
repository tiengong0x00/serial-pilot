use crate::error::SerialError;
use serde::{Deserialize, Serialize};
use serialport::SerialPort;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::Emitter;
use tokio::sync::watch;

/// 串口异常事件负载
#[derive(Debug, Clone, Serialize)]
pub struct SerialErrorPayload {
    pub port_label: String,
    pub kind: SerialErrorKind,
    pub severity: Severity,
    pub message: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SerialErrorKind {
    DeviceRemoved,      // 设备移除
    ConnectionReset,    // 连接重置
    PermissionDenied,   // 权限丢失
    ReadError,          // 读取错误
    WriteError,         // 写入错误
    Unknown,            // 未知错误
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Fatal,    // 致命：必须清理资源+断开
    Warning,  // 警告：提示但连接保持
}

/// 分类 I/O 错误
pub fn classify_io_error(e: &std::io::Error) -> (SerialErrorKind, Severity) {
    use std::io::ErrorKind::*;
    match e.kind() {
        BrokenPipe | NotConnected => (SerialErrorKind::DeviceRemoved, Severity::Fatal),
        ConnectionReset => (SerialErrorKind::ConnectionReset, Severity::Fatal),
        PermissionDenied => (SerialErrorKind::PermissionDenied, Severity::Fatal),
        TimedOut | WouldBlock => (SerialErrorKind::WriteError, Severity::Warning),
        _ => (SerialErrorKind::Unknown, Severity::Fatal), // 未知错误保守当致命
    }
}

/// 生成当前毫秒级 Unix 时间戳
fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerialConfig {
    pub baud_rate: u32,
    pub data_bits: u8,
    pub parity: String,
    pub stop_bits: u8,
    pub flow_control: String,
    pub dtr: bool,
    pub rts: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct PortInfo {
    pub port_name: String,
    pub friendly_name: Option<String>,
    pub vid: Option<u16>,
    pub pid: Option<u16>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConnectionStatus {
    pub p1_connected: bool,
    pub p2_connected: bool,
}

pub struct PortHandle {
    pub port: Arc<Mutex<Box<dyn SerialPort>>>,
    pub cancel_tx: watch::Sender<bool>,
}

#[derive(Default)]
pub struct SerialManager {
    connections: Arc<Mutex<HashMap<String, PortHandle>>>,
}

impl SerialManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn connection_status(&self) -> ConnectionStatus {
        match self.connections.lock() {
            Ok(guard) => ConnectionStatus {
                p1_connected: guard.contains_key("P1"),
                p2_connected: guard.contains_key("P2"),
            },
            Err(_) => ConnectionStatus {
                p1_connected: false,
                p2_connected: false,
            },
        }
    }

    /// 连接串口
    pub fn connect(&self, label: &str, name: &str, cfg: &SerialConfig) -> Result<(), SerialError> {
        // 检查是否已连接
        {
            let guard = self.connections.lock()
                .map_err(|e| SerialError::Internal(format!("Failed to acquire lock: {}", e)))?;
            if guard.contains_key(label) {
                return Err(SerialError::AlreadyConnected(label.to_string()));
            }
        }

        // 解析校验位
        let parity = match cfg.parity.to_lowercase().as_str() {
            "none" => serialport::Parity::None,
            "even" => serialport::Parity::Even,
            "odd" => serialport::Parity::Odd,
            _ => return Err(SerialError::ConfigInvalid(format!("Invalid parity: {}", cfg.parity))),
        };

        // 解析停止位
        let stop_bits = match cfg.stop_bits {
            1 => serialport::StopBits::One,
            2 => serialport::StopBits::Two,
            _ => return Err(SerialError::ConfigInvalid(format!("Invalid stop bits: {}", cfg.stop_bits))),
        };

        // 解析数据位
        let data_bits = match cfg.data_bits {
            5 => serialport::DataBits::Five,
            6 => serialport::DataBits::Six,
            7 => serialport::DataBits::Seven,
            8 => serialport::DataBits::Eight,
            _ => return Err(SerialError::ConfigInvalid(format!("Invalid data bits: {}", cfg.data_bits))),
        };

        // 解析流控模式
        let flow_control = match cfg.flow_control.to_lowercase().as_str() {
            "none" => serialport::FlowControl::None,
            "software" => serialport::FlowControl::Software,
            "hardware" => serialport::FlowControl::Hardware,
            _ => return Err(SerialError::ConfigInvalid(format!("Invalid flow control: {}", cfg.flow_control))),
        };

        // 打开串口
        let mut port = serialport::new(name, cfg.baud_rate)
            .parity(parity)
            .stop_bits(stop_bits)
            .data_bits(data_bits)
            .flow_control(flow_control)
            .timeout(std::time::Duration::from_millis(100))
            .open()
            .map_err(|e| SerialError::OpenFailed(format!("{}: {}", name, e)))?;

        // 设置初始 DTR/RTS 电平（硬件流控时 RTS 由驱动接管，此处仍尝试设置以覆盖非流控场景）
        // 忽略设置失败（部分虚拟串口不支持信号线控制），不阻断连接
        let _ = port.write_data_terminal_ready(cfg.dtr);
        let _ = port.write_request_to_send(cfg.rts);

        // 创建取消信号通道
        let (cancel_tx, _cancel_rx) = watch::channel(false);

        let handle = PortHandle {
            port: Arc::new(Mutex::new(port)),
            cancel_tx,
        };

        // 存入连接池
        let mut guard = self.connections.lock()
            .map_err(|e| SerialError::Internal(format!("Failed to acquire lock: {}", e)))?;
        guard.insert(label.to_string(), handle);

        Ok(())
    }

    /// 断开串口
    pub fn disconnect(&self, label: &str) -> Result<(), SerialError> {
        let mut guard = self.connections.lock()
            .map_err(|e| SerialError::Internal(format!("Failed to acquire lock: {}", e)))?;

        let handle = guard.remove(label)
            .ok_or_else(|| SerialError::NotConnected(label.to_string()))?;

        // 发送取消信号（监听器会优雅退出）
        let _ = handle.cancel_tx.send(true);

        Ok(())
    }

    /// 设置 DTR 信号电平
    pub fn set_dtr(&self, label: &str, level: bool) -> Result<(), SerialError> {
        let guard = self.connections.lock()
            .map_err(|e| SerialError::Internal(format!("Failed to acquire lock: {}", e)))?;
        let handle = guard.get(label)
            .ok_or_else(|| SerialError::NotConnected(label.to_string()))?;
        let mut port_guard = handle.port.lock()
            .map_err(|e| SerialError::Internal(format!("Failed to acquire port lock: {}", e)))?;
        port_guard.write_data_terminal_ready(level)
            .map_err(|e| SerialError::WriteFailed(format!("Failed to set DTR on {}: {}", label, e)))?;
        Ok(())
    }

    /// 设置 RTS 信号电平
    pub fn set_rts(&self, label: &str, level: bool) -> Result<(), SerialError> {
        let guard = self.connections.lock()
            .map_err(|e| SerialError::Internal(format!("Failed to acquire lock: {}", e)))?;
        let handle = guard.get(label)
            .ok_or_else(|| SerialError::NotConnected(label.to_string()))?;
        let mut port_guard = handle.port.lock()
            .map_err(|e| SerialError::Internal(format!("Failed to acquire port lock: {}", e)))?;
        port_guard.write_request_to_send(level)
            .map_err(|e| SerialError::WriteFailed(format!("Failed to set RTS on {}: {}", label, e)))?;
        Ok(())
    }

    /// 写入数据到串口
    pub fn write(&self, label: &str, data: &[u8], app_handle: &tauri::AppHandle) -> Result<usize, SerialError> {
        let guard = self.connections.lock()
            .map_err(|e| SerialError::Internal(format!("Failed to acquire lock: {}", e)))?;

        let handle = guard.get(label)
            .ok_or_else(|| SerialError::NotConnected(label.to_string()))?;

        let mut port_guard = handle.port.lock()
            .map_err(|e| SerialError::Internal(format!("Failed to acquire port lock: {}", e)))?;

        let data_len = data.len();

        // 使用 write_all 确保所有字节都被写入（循环写入直到完成）
        // 移除 flush() 以避免 Windows FlushFileBuffers 在 COM 口上的异常行为
        let write_result = port_guard.write_all(data);

        // 处理写入结果
        match write_result {
            Ok(()) => {
                // write_all 成功表示全部写入完成
                Ok(data_len)
            }
            Err(e) => {
                // 分类错误
                let (kind, severity) = classify_io_error(&e);
                let is_fatal = matches!(severity, Severity::Fatal);

                if is_fatal {
                    eprintln!("[{}] Write encountered fatal error: {}", label, e);

                    // 发送错误事件
                    let payload = SerialErrorPayload {
                        port_label: label.to_string(),
                        kind: kind.clone(),
                        severity,
                        message: format!("Write failed: {}", e),
                        timestamp: now_millis(),
                    };

                    // 释放锁
                    drop(port_guard);
                    drop(guard);

                    // 发送事件
                    if let Err(emit_err) = app_handle.emit("serial_error", payload) {
                        eprintln!("[{}] Failed to emit serial_error event: {}", label, emit_err);
                    }

                    // 清理连接
                    self.force_cleanup(label);
                }

                Err(SerialError::WriteFailed(format!("{}: {}", label, e)))
            }
        }
    }

    /// 强制清理连接（供后端异常路径调用）
    ///
    /// 监听器异常退出或写入致命错误时，后端主动清理连接池。
    /// 前端收到 serial_error(Fatal) 事件后应调用 disconnect_serial_port 完成完整清理。
    pub fn force_cleanup(&self, label: &str) {
        if let Ok(mut guard) = self.connections.lock() {
            if let Some(handle) = guard.remove(label) {
                // 发送取消信号（防止监听器未完全退出）
                let _ = handle.cancel_tx.send(true);
                eprintln!("[{}] Connection forcibly cleaned up", label);
            }
        }
    }

    /// 获取用于监听器的独立端口句柄
    ///
    /// 通过 try_clone() 复制底层句柄，使监听器读循环拥有自己的端口，
    /// 与写入路径（原端口）互不抢锁，避免阻塞式 read 持锁导致收发相互延迟/丢失。
    pub fn get_port_for_listener(&self, label: &str) -> Result<(Box<dyn SerialPort>, watch::Receiver<bool>), SerialError> {
        let guard = self.connections.lock()
            .map_err(|e| SerialError::Internal(format!("Failed to acquire lock: {}", e)))?;

        let handle = guard.get(label)
            .ok_or_else(|| SerialError::NotConnected(label.to_string()))?;

        let cancel_rx = handle.cancel_tx.subscribe();

        let port_clone = handle.port.lock()
            .map_err(|e| SerialError::Internal(format!("Failed to acquire port lock: {}", e)))?
            .try_clone()
            .map_err(|e| SerialError::OpenFailed(format!("Failed to clone port: {}", e)))?;

        Ok((port_clone, cancel_rx))
    }
}

pub struct AppState {
    pub serial_manager: SerialManager,
    pub network_manager: crate::network::NetworkManager,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            serial_manager: SerialManager::new(),
            network_manager: crate::network::NetworkManager::new(),
        }
    }
}
