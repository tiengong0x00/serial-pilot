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

/// 分类写入上下文的 I/O 错误
///
/// 与通用 `classify_io_error` 的区别：写入路径已用动态超时保证正常数据能发完，
/// 因此 `WriteZero`（write_all 部分写入）和超时类错误视为**可恢复告警**而非致命，
/// 避免因瞬时缓冲拥塞/流控阻塞误断连。真设备断开仍会以 BrokenPipe/NotConnected 呈现。
pub fn classify_write_error(e: &std::io::Error) -> (SerialErrorKind, Severity) {
    use std::io::ErrorKind::*;
    match e.kind() {
        // 部分写入：动态超时窗口内仍未发完，多为流控阻塞/瞬时拥塞，可恢复
        WriteZero => (SerialErrorKind::WriteError, Severity::Warning),
        TimedOut | WouldBlock => (SerialErrorKind::WriteError, Severity::Warning),
        // 设备真断开 / 权限丢失：致命
        BrokenPipe | NotConnected => (SerialErrorKind::DeviceRemoved, Severity::Fatal),
        ConnectionReset => (SerialErrorKind::ConnectionReset, Severity::Fatal),
        PermissionDenied => (SerialErrorKind::PermissionDenied, Severity::Fatal),
        _ => (SerialErrorKind::Unknown, Severity::Fatal),
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

impl Drop for PortHandle {
    fn drop(&mut self) {
        eprintln!("[PortHandle] Dropping, sending cancel signal and closing port");

        // 1. 发送取消信号给后台读线程
        let _ = self.cancel_tx.send(true);

        // 2. 显式释放串口（serialport 库的 Drop 会调用底层 CloseHandle）
        // 即使底层句柄已失效（如休眠导致），也要告诉操作系统释放资源
        if let Ok(port) = self.port.lock() {
            drop(port);
        }
    }
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

    /// 断开所有串口（电源管理专用）
    pub fn disconnect_all(&self) -> Result<(), String> {
        let mut guard = self.connections.lock()
            .map_err(|e| format!("Failed to acquire lock: {}", e))?;

        let labels: Vec<String> = guard.keys().cloned().collect();

        for label in labels {
            if let Some(handle) = guard.remove(&label) {
                eprintln!("[{}] Disconnecting due to power event", label);
                let _ = handle.cancel_tx.send(true);
                // handle 被移除后自动触发 Drop，释放底层资源
            }
        }

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
        // ── 全局锁最小化 ────────────────────────────────────────────
        // 只在"查表拿端口句柄"期间持有全局 connections 锁：克隆出端口的
        // Arc<Mutex> 后立即释放全局锁。这样 write_all 的阻塞只作用于当前
        // 端口自己的锁，不再卡住其他端口的读写、状态查询与连接管理，
        // 消除"连点发送时全局串行排队"的瓶颈。
        let port_arc = {
            let guard = self.connections.lock()
                .map_err(|e| SerialError::Internal(format!("Failed to acquire lock: {}", e)))?;
            let handle = guard.get(label)
                .ok_or_else(|| SerialError::NotConnected(label.to_string()))?;
            Arc::clone(&handle.port)
        }; // ← 全局锁在此释放

        let mut port_guard = port_arc.lock()
            .map_err(|e| SerialError::Internal(format!("Failed to acquire port lock: {}", e)))?;

        let data_len = data.len();

        // ── 动态写超时 ──────────────────────────────────────────────
        // 背景：serialport 在 Windows 上用固定总超时（打开时设的 100ms）。
        // 该超时是"防死锁的上限"，非"限速"。同步阻塞的 write_all 若在超时窗口内
        // 没发完，会返回部分写入 → WriteZero，被误判为致命错误导致断连。
        //
        // 9600 波特率下 100ms 只够发约 96 字节，故 192+ 字节必然超时。
        //
        // 解法：按数据量和波特率算出理论发送时间，临时把写超时放大到
        // "理论时间 × 3 + 200ms 余量"，写完立即恢复原超时。
        // 数据真发完就返回，无任何人为延迟，性能时序保持真实；
        // 只有真异常（设备卡死/流控阻塞）超过放大后的上限才触发超时。
        let baud = port_guard.baud_rate().unwrap_or(9600).max(1);
        // 每字节按 10 位估算（8N1；含起始/停止位），理论发送时间(ms)
        let theoretical_ms = (data_len as u64 * 10 * 1000) / baud as u64;
        // 放大 3 倍 + 200ms 余量，并夹取到 [100ms, 30s]
        let dynamic_timeout_ms = ((theoretical_ms * 3) + 200).clamp(100, 30_000);
        let dynamic_timeout = std::time::Duration::from_millis(dynamic_timeout_ms);

        // 保存原超时以便写后恢复（获取失败则回退到 100ms 基线）
        let original_timeout = port_guard.timeout();
        // 仅当放大后的超时更大时才临时调整，避免缩小基线超时
        let adjusted = dynamic_timeout > original_timeout;
        if adjusted {
            if let Err(e) = port_guard.set_timeout(dynamic_timeout) {
                eprintln!("[{}] Failed to set dynamic write timeout: {}", label, e);
            }
        }

        // 使用 write_all 确保所有字节都被写入（循环写入直到完成）
        // 移除 flush() 以避免 Windows FlushFileBuffers 在 COM 口上的异常行为
        let write_result = port_guard.write_all(data);

        // 恢复原超时（无论成功失败都恢复，避免污染后续读/写）
        if adjusted {
            let _ = port_guard.set_timeout(original_timeout);
        }

        // 处理写入结果
        match write_result {
            Ok(()) => {
                // write_all 成功表示全部写入完成
                Ok(data_len)
            }
            Err(e) => {
                // 写上下文错误分类：WriteZero（部分写入）和超时类不再当致命错误。
                // 动态超时已保证正常数据发得完；仍失败通常是流控阻塞/瞬时拥塞，
                // 属可恢复告警，保持连接。真断开会表现为 BrokenPipe/NotConnected。
                let (kind, severity) = classify_write_error(&e);
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

                    // 释放端口锁（全局锁已在查表后提前释放）
                    drop(port_guard);

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
