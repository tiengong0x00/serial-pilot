use crate::error::SerialError;
use serde::{Deserialize, Serialize};
use serialport::SerialPort;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
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
    /// 缓存的波特率，避免每次 write 时调用 port.baud_rate()（Windows 下是系统调用）
    #[allow(dead_code)]
    pub baud_rate: u32,
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
    ///
    /// `file_packet_size`：单包最大字节数（前端设置项）。用于计算一个足够大的
    /// 固定写超时：一次 write_all 最多写一个包，超时 = 该包理论发送时间 × 3 + 500ms 余量。
    /// 连接后固定不变，写入路径不再动态调整超时（避免 Windows SetCommTimeouts 的高开销）。
    pub fn connect(&self, label: &str, name: &str, cfg: &SerialConfig, file_packet_size: u32) -> Result<(), SerialError> {
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

        // 计算固定写超时：按单包最大字节数 + 波特率
        // 理论发送时间(ms) = (file_packet_size × 10位) / 波特率 × 1000
        // 实际超时 = 理论时间 × 3 + 500ms 余量，下限 100ms
        let baud = cfg.baud_rate.max(110); // 防止除零，最低110波特率
        let packet_size = file_packet_size.max(1) as u64; // 防止除零，最小1字节
        let theoretical_ms = (packet_size * 10 * 1000) / baud as u64;
        let write_timeout_ms = ((theoretical_ms * 3) + 500).max(100);
        let write_timeout = std::time::Duration::from_millis(write_timeout_ms);

        // 打开串口
        let mut port = serialport::new(name, cfg.baud_rate)
            .parity(parity)
            .stop_bits(stop_bits)
            .data_bits(data_bits)
            .flow_control(flow_control)
            .timeout(write_timeout)
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
            baud_rate: cfg.baud_rate, // 缓存波特率
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
    pub fn write(
        &self,
        label: &str,
        data: &[u8],
        file_packet_size: u32,
        file_packet_interval: u32,
        _app_handle: &tauri::AppHandle,
    ) -> Result<usize, SerialError> {
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

        // packet_size == 0 表示“不分包”：整包一次性发送。
        let packet_size = if file_packet_size == 0 {
            data.len().max(1)
        } else {
            file_packet_size as usize
        };

        // ── 驱动队列背压参数 ──────────────────────────────────────
        // 问题：write_all 只把数据塞进 Windows 串口驱动的发送队列即返回，
        // 硬件按波特率逐字节发出（9600 下 128B 需 ~133ms）。若连续写入速度
        // 快于硬件发送速度，队列会积压；一旦 WriteFile 在写超时内无法把整包
        // 塞进队列，就返回部分写入 → write_all 报 "failed to write whole buffer"。
        //
        // 对策：写每一小片前，用 bytes_to_write()（Windows COMSTAT.cbOutQue，
        // 只读状态、不清缓冲、无丢数据风险）查询队列积压，超过阈值就轮询等待
        // 硬件排空。等待时间自适应（取决于实际积压），不固定延时、不做全量 flush。
        const WRITE_CHUNK: usize = 64;        // 单次物理写片大小
        const QUEUE_THRESHOLD: u32 = 64;      // 队列积压超过此值先等待（最坏积压 64+64=128，远小于驱动队列容量）
        const DRAIN_TIMEOUT_MS: u64 = 3000;   // 单片排空最大等待，防串口异常时死锁

        let mut total_written = 0;
        let chunks = data.chunks(packet_size);
        let chunk_count = chunks.len();

        for (i, chunk) in chunks.enumerate() {
            // 逻辑包内再按 WRITE_CHUNK 细分，逐片背压写入
            let mut offset = 0;
            while offset < chunk.len() {
                // 队列积压过高则轮询等待硬件排空（单层循环 + 超时兜底）
                let drain_start = std::time::Instant::now();
                loop {
                    let pending = port_guard.bytes_to_write().unwrap_or(0);
                    if pending <= QUEUE_THRESHOLD {
                        break;
                    }
                    if drain_start.elapsed().as_millis() as u64 > DRAIN_TIMEOUT_MS {
                        return Err(SerialError::WriteFailed(
                            "write queue drain timeout (device not transmitting)".to_string(),
                        ));
                    }
                    std::thread::sleep(std::time::Duration::from_millis(1));
                }

                let end = (offset + WRITE_CHUNK).min(chunk.len());
                port_guard
                    .write_all(&chunk[offset..end])
                    .map_err(|e| SerialError::WriteFailed(format!("{}", e)))?;
                total_written += end - offset;
                offset = end;
            }

            // 包间延时（最后一包无需等待）
            if i + 1 < chunk_count && file_packet_interval > 0 {
                std::thread::sleep(std::time::Duration::from_millis(file_packet_interval as u64));
            }
        }

        // 分包发送全部成功
        Ok(total_written)
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
