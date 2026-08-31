use crate::error::SerialError;
use serde::{Deserialize, Serialize};
use serialport::SerialPort;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Emitter;
use tokio::sync::watch;

/// 文件发送进度事件负载
///
/// 后端发送线程按时间片（约 33ms）或块数节流 emit，避免事件风暴。
/// 速率/剩余时间由前端按相邻事件时间差自行计算，后端只报原始字节量。
#[derive(Debug, Clone, Serialize)]
pub struct FileSendProgressPayload {
    pub port_label: String,
    pub sent_bytes: u64,
    pub total_bytes: u64,
    pub done: bool,       // 全部发完
    pub cancelled: bool,  // 被取消中止
}

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

/// 监听器读循环使用的短读超时（毫秒）
///
/// 单句柄共享模式下，此超时同时是设备级超时。写操作会在持锁期间临时切换到
/// 写超时、写完恢复此值，保证监听器每次拿锁读时都是短超时（高分辨率帧检测）。
pub const READ_TIMEOUT_MS: u64 = 5;

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

/// 根据要写入的字节数与波特率，估算一个安全的写超时（毫秒）
///
/// 单句柄共享模式下，设备级超时由读写共用。写前临时放大到此值，保证
/// 大块数据能在流控/拥塞下发完；写后由调用方恢复为 `READ_TIMEOUT_MS`。
fn write_timeout_for(len: usize, baud_rate: u32) -> u64 {
    // 每字节约 10 bit（8N1 含起止位）。传输耗时(ms) = len*10*1000/baud。
    // 放 4 倍余量 + 200ms 基础，兜底 500ms、封顶 5s。
    let baud = baud_rate.max(1) as u64;
    let transmit_ms = (len as u64) * 10 * 1000 / baud;
    (transmit_ms * 4 + 200).clamp(500, 5000)
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
    /// 文件发送取消标志（按端口独立，与监听器 cancel_tx 隔离，避免取消发送误杀监听）
    send_cancels: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl SerialManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
            send_cancels: Arc::new(Mutex::new(HashMap::new())),
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
    /// 单句柄共享模式：读写共用同一句柄与同一设备级超时。初始超时设为
    /// `READ_TIMEOUT_MS`（监听器读循环所需的短超时）；写操作在持锁期间临时切换到
    /// 按数据量估算的写超时，写完恢复短超时（详见 `write`）。互斥锁保证读写永不
    /// 并发访问端口，因此监听器每次拿锁时超时都已恢复为短值。`file_packet_size`
    /// 参数保留（调用方兼容），此处不再参与计算。
    pub fn connect(&self, label: &str, name: &str, cfg: &SerialConfig, file_packet_size: u32) -> Result<(), SerialError> {
        let _ = file_packet_size; // 不再按单包算超时，保留签名兼容
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

        // 初始设备级超时 = 监听器读循环所需的短超时。
        // 写路径会在持锁期间临时放大再恢复，故此处不再按大缓冲预置长超时。
        let read_timeout = std::time::Duration::from_millis(READ_TIMEOUT_MS);

        // 打开串口
        let mut port = serialport::new(name, cfg.baud_rate)
            .parity(parity)
            .stop_bits(stop_bits)
            .data_bits(data_bits)
            .flow_control(flow_control)
            .timeout(read_timeout)
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
        let (port_arc, baud_rate) = {
            let guard = self.connections.lock()
                .map_err(|e| SerialError::Internal(format!("Failed to acquire lock: {}", e)))?;
            let handle = guard.get(label)
                .ok_or_else(|| SerialError::NotConnected(label.to_string()))?;
            (Arc::clone(&handle.port), handle.baud_rate)
        }; // ← 全局锁在此释放

        // packet_size == 0 表示“不分包”：整包一次性发送。
        let packet_size = if file_packet_size == 0 {
            data.len().max(1)
        } else {
            file_packet_size as usize
        };

        // 每个逻辑包整包一次 write_all，让驱动内部流式排入 OS 发送缓冲。
        //
        // 不再在包内按小片细分：小片会产生多次 WriteFile 系统调用，且每次阻塞
        // 都会被 Windows 调度量子(~15.6ms)向上取整，凭空放大延迟；整包单次写入
        // 只阻塞 1~2 个量子，贴近物理传输地板。
        //
        // 不再做 bytes_to_write() 背压轮询：部分 USB 转串口驱动(如 XR21V1412)
        // 的 cbOutQue 恒返回 0，轮询是死代码；且写超时已按大缓冲给足，
        // write_all 会阻塞到整包塞入 OS 缓冲，不会出现部分写入。
        // 单句柄共享模式：每包**短持锁**，锁内切换写超时→写入→恢复读超时→释放锁。
        // 这样监听器读循环能在包间隙拿到锁读取，写入不会长期霸占句柄；且互斥锁
        // 保证监听器拿锁时超时已恢复为 READ_TIMEOUT_MS（高分辨率帧检测）。
        let read_timeout = std::time::Duration::from_millis(READ_TIMEOUT_MS);
        let mut total_written = 0;
        let chunks = data.chunks(packet_size);
        let chunk_count = chunks.len();

        for (i, chunk) in chunks.enumerate() {
            {
                let mut port_guard = port_arc.lock()
                    .map_err(|e| SerialError::Internal(format!("Failed to acquire port lock: {}", e)))?;

                // 按本包字节量动态放大写超时，保证流控/拥塞下能整包写完
                let wt = std::time::Duration::from_millis(write_timeout_for(chunk.len(), baud_rate));
                let _ = port_guard.set_timeout(wt);

                let write_res = port_guard.write_all(chunk);

                // 无论成败都恢复短读超时，避免监听器下次读被长超时拖住
                let _ = port_guard.set_timeout(read_timeout);

                write_res.map_err(|e| SerialError::WriteFailed(format!("{}", e)))?;
            } // ← 端口锁在此释放，让监听器有机会读取

            total_written += chunk.len();

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

    /// 获取用于监听器的端口句柄（共享模式）
    ///
    /// 返回端口的 Arc<Mutex> 引用和取消信号接收器。
    /// 监听器将通过短持锁方式读取数据，与写入路径共享同一句柄，
    /// 避免 Windows 下 try_clone() 导致的克隆句柄读失效问题。
    pub fn get_port_for_listener(&self, label: &str) -> Result<(Arc<Mutex<Box<dyn SerialPort>>>, watch::Receiver<bool>), SerialError> {
        let guard = self.connections.lock()
            .map_err(|e| SerialError::Internal(format!("Failed to acquire lock: {}", e)))?;

        let handle = guard.get(label)
            .ok_or_else(|| SerialError::NotConnected(label.to_string()))?;

        let cancel_rx = handle.cancel_tx.subscribe();

        // 直接返回共享的 Arc，不再 try_clone
        Ok((Arc::clone(&handle.port), cancel_rx))
    }

    /// 请求取消指定端口正在进行的文件发送
    ///
    /// 置位该端口的发送取消标志；发送线程在块循环里检测到后停止并 emit 取消事件。
    /// 与监听器 cancel_tx 完全隔离，不影响 RX 监听。
    pub fn cancel_file_send(&self, label: &str) {
        if let Ok(guard) = self.send_cancels.lock() {
            if let Some(flag) = guard.get(label) {
                flag.store(true, Ordering::SeqCst);
            }
        }
    }

    /// 后端流式发送附件（在独立线程执行，不阻塞 IPC）
    ///
    /// 按 `id` 打开磁盘附件文件，分块**读盘 → 背靠背 write_all**——内存恒定、
    /// 支持大文件，且绝不整包一次写入，从根上消除 "failed to write whole buffer"。
    /// `interval_ms==0` 即连续发送（块间零停顿，对齐 sscom "连续发送"语义）。
    /// 进度按 ~33ms 时间片节流 emit。附件不存在时返回 NotFound。
    pub fn send_attachment(
        &self,
        label: &str,
        id: &str,
        block_size: u32,
        interval_ms: u32,
        app_handle: tauri::AppHandle,
    ) -> Result<(), SerialError> {
        // 打开附件文件并取总大小（不存在 → NotFound）
        let mut file = crate::attachments::open_attachment(id)?;
        let total_bytes = file.metadata()
            .map_err(|e| SerialError::Internal(format!("Failed to stat attachment: {}", e)))?
            .len();

        // 拿到端口 Arc 与波特率（释放全局锁后再发送）
        let (port_arc, baud_rate) = {
            let guard = self.connections.lock()
                .map_err(|e| SerialError::Internal(format!("Failed to acquire lock: {}", e)))?;
            let handle = guard.get(label)
                .ok_or_else(|| SerialError::NotConnected(label.to_string()))?;
            (Arc::clone(&handle.port), handle.baud_rate)
        };

        // 注册/重置该端口的取消标志
        let cancel_flag = Arc::new(AtomicBool::new(false));
        {
            let mut guard = self.send_cancels.lock()
                .map_err(|e| SerialError::Internal(format!("Failed to acquire lock: {}", e)))?;
            guard.insert(label.to_string(), Arc::clone(&cancel_flag));
        }

        // 块大小：0 视为默认 256（永不整文件一次写）
        let block = if block_size == 0 { 256 } else { block_size as usize };
        let label_owned = label.to_string();

        std::thread::spawn(move || {
            use std::io::Read;
            const EMIT_INTERVAL_MS: u128 = 33;
            let mut sent: u64 = 0;
            let mut last_emit = std::time::Instant::now();
            let mut cancelled = false;

            // 首个进度事件（0%），让前端立刻显示进度条
            let _ = app_handle.emit("file_send_progress", FileSendProgressPayload {
                port_label: label_owned.clone(),
                sent_bytes: 0,
                total_bytes,
                done: false,
                cancelled: false,
            });

            let read_timeout = std::time::Duration::from_millis(READ_TIMEOUT_MS);
            let mut buffer = vec![0u8; block];
            loop {
                if cancel_flag.load(Ordering::SeqCst) {
                    cancelled = true;
                    break;
                }

                // 从磁盘读一块
                let n = match file.read(&mut buffer) {
                    Ok(0) => break, // EOF
                    Ok(n) => n,
                    Err(_) => {
                        cancelled = true;
                        break;
                    }
                };

                // 单句柄共享模式：每块短持锁——锁内切换写超时→写入→恢复读超时→释放。
                // 块间隙让监听器有机会拿锁读取设备回显/上报，避免大文件发送期间 RX 饿死。
                {
                    let mut port_guard = match port_arc.lock() {
                        Ok(g) => g,
                        Err(_) => { cancelled = true; break; }
                    };
                    let wt = std::time::Duration::from_millis(write_timeout_for(n, baud_rate));
                    let _ = port_guard.set_timeout(wt);
                    let write_res = port_guard.write_all(&buffer[..n]);
                    let _ = port_guard.set_timeout(read_timeout);
                    if write_res.is_err() {
                        cancelled = true;
                        break;
                    }
                } // ← 端口锁在此释放

                sent += n as u64;

                // 块间延时（最后一块由 EOF 判断，此处统一延时）
                if interval_ms > 0 {
                    std::thread::sleep(std::time::Duration::from_millis(interval_ms as u64));
                }

                // 时间片节流 emit 进度
                if last_emit.elapsed().as_millis() >= EMIT_INTERVAL_MS {
                    let _ = app_handle.emit("file_send_progress", FileSendProgressPayload {
                        port_label: label_owned.clone(),
                        sent_bytes: sent,
                        total_bytes,
                        done: false,
                        cancelled: false,
                    });
                    last_emit = std::time::Instant::now();
                }
            }

            // 终态事件
            let _ = app_handle.emit("file_send_progress", FileSendProgressPayload {
                port_label: label_owned.clone(),
                sent_bytes: sent,
                total_bytes,
                done: !cancelled,
                cancelled,
            });
        });

        Ok(())
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
