use crate::error::SerialError;
use crate::state::{classify_io_error, SerialErrorKind, SerialErrorPayload, Severity};
use serialport::SerialPort;
use std::io::Read;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

/// 串口数据事件负载
#[derive(Debug, Clone, serde::Serialize)]
pub struct SerialDataPayload {
    pub port_label: String,
    pub data: Vec<u8>,
    pub timestamp: u64,
}

/// 读循环内部使用的短读超时（毫秒）
///
/// 远小于帧超时，使读循环能以较高分辨率检测字节间的静默间隙。
/// 无数据时 read 会在该时长后返回 TimedOut，从而驱动组包判定与取消检查。
const READ_TIMEOUT_MS: u64 = 5;

/// 帧超时下限保护（毫秒）
///
/// 帧超时必须大于读超时，否则单次读返回的间隔就可能超过帧超时导致误判。
const MIN_FRAME_TIMEOUT_MS: u64 = READ_TIMEOUT_MS + 1;

/// 单包最大累积字节数
///
/// 持续不断的数据流（字节间隔始终小于帧超时）不会触发超时分包，
/// 达到该上限时强制分包，防止缓冲区无限增长、单条消息过大拖垮前端。
const MAX_PACKET_BYTES: usize = 4096;

/// 生成当前毫秒级 Unix 时间戳
fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// 启动串口监听任务
///
/// 接收 try_clone() 后的独立端口句柄，在 tokio::spawn_blocking 中运行阻塞读循环。
/// 监听器拥有端口的独立句柄，不与写入路径共享锁，彻底消除读写抢锁导致的延迟/丢失。
///
/// # 组包机制（纯字符间超时）
///
/// 模组常逐字节回传数据。若每次 read 返回就 emit，一条 AT 响应会被拆成上百条单字符记录。
/// 这里在后端累积字节，直到出现一段静默间隙（≥ frame_timeout_ms）才把整包作为一条消息发出，
/// 使一次完整响应对应一行、一个时间戳。相比按换行分包，纯超时不会误拆包含 CRLF 的多行响应。
///
/// - `frame_timeout_ms`：字符间超时。相邻字节间隔超过该值即视为上一包结束。
pub fn start_listener(
    port_label: String,
    mut port: Box<dyn SerialPort>,
    cancel_rx: watch::Receiver<bool>,
    app_handle: AppHandle,
    frame_timeout_ms: u64,
) -> Result<(), SerialError> {
    // 夹取帧超时下限，保证 frame_timeout > read_timeout
    let frame_timeout = Duration::from_millis(frame_timeout_ms.max(MIN_FRAME_TIMEOUT_MS));

    // 将读超时收紧到较小值，以提高静默间隙的检测分辨率。
    // try_clone 出的句柄独立设置超时，不影响写入路径。
    if let Err(e) = port.set_timeout(Duration::from_millis(READ_TIMEOUT_MS)) {
        eprintln!("Failed to set read timeout [{}]: {}", port_label, e);
    }

    tokio::task::spawn_blocking(move || {
        let mut buffer = [0u8; 1024];
        // 累积中的数据包
        let mut acc: Vec<u8> = Vec::with_capacity(256);
        // 包内第一个字节到达时间（作为该包的时间戳来源）
        let mut packet_started_at: u64 = 0;
        // 最近一次收到字节的时刻（用于计算静默间隙）
        let mut last_byte_at = Instant::now();

        // 把累积缓冲区作为一包发出并清空
        let flush = |acc: &mut Vec<u8>, ts: u64, app: &AppHandle, label: &str| {
            if acc.is_empty() {
                return;
            }
            let payload = SerialDataPayload {
                port_label: label.to_string(),
                data: std::mem::take(acc),
                timestamp: ts,
            };
            if let Err(e) = app.emit("serial_data", payload) {
                eprintln!("Failed to push serial data [{}]: {}", label, e);
            }
        };

        loop {
            // 检查取消信号：退出前把残留数据发出，避免丢最后一包
            if *cancel_rx.borrow() {
                flush(&mut acc, packet_started_at, &app_handle, &port_label);
                break;
            }

            match port.read(&mut buffer) {
                Ok(0) => {
                    // 读到 0 字节：若已有累积数据且静默超过帧超时，则分包
                    if !acc.is_empty() && last_byte_at.elapsed() >= frame_timeout {
                        flush(&mut acc, packet_started_at, &app_handle, &port_label);
                    }
                }
                Ok(n) => {
                    let now = Instant::now();

                    // 若与上一字节的间隔已超过帧超时，先把上一包结算掉，再开新包
                    if !acc.is_empty() && now.duration_since(last_byte_at) >= frame_timeout {
                        flush(&mut acc, packet_started_at, &app_handle, &port_label);
                    }

                    // 新包起点：记录首字节时间戳
                    if acc.is_empty() {
                        packet_started_at = now_millis();
                    }

                    acc.extend_from_slice(&buffer[..n]);
                    last_byte_at = now;

                    // 超长保护：持续不断的数据流强制分包
                    if acc.len() >= MAX_PACKET_BYTES {
                        flush(&mut acc, packet_started_at, &app_handle, &port_label);
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                    // 静默超时：这是纯超时组包的主要分包触发点
                    if !acc.is_empty() && last_byte_at.elapsed() >= frame_timeout {
                        flush(&mut acc, packet_started_at, &app_handle, &port_label);
                    }
                }
                Err(e) => {
                    // 分类错误：警告级重试，致命级退出
                    let (mut kind, severity) = classify_io_error(&e);

                    // 读上下文中将 WriteError 替换为 ReadError
                    if matches!(kind, SerialErrorKind::WriteError) {
                        kind = SerialErrorKind::ReadError;
                    }

                    match severity {
                        Severity::Warning => {
                            // 警告级：打印到控制台后继续重试
                            eprintln!("Serial read warning [{}]: {}", port_label, e);
                            continue;
                        }
                        Severity::Fatal => {
                            // 致命错误：刷新残留数据，通知前端，退出循环
                            eprintln!("Serial read fatal error [{}]: {}", port_label, e);
                            flush(&mut acc, packet_started_at, &app_handle, &port_label);

                            let payload = SerialErrorPayload {
                                port_label: port_label.clone(),
                                kind,
                                severity,
                                message: format!("Read error: {}", e),
                                timestamp: now_millis(),
                            };
                            if let Err(emit_err) = app_handle.emit("serial_error", payload) {
                                eprintln!("[{}] Failed to emit serial_error event: {}", port_label, emit_err);
                            }

                            break;
                        }
                    }
                }
            }
        }
    });

    Ok(())
}
