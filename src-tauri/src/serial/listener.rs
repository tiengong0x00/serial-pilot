use crate::error::SerialError;
use crate::state::{classify_io_error, SerialErrorKind, SerialErrorPayload, Severity};
use serialport::SerialPort;
use std::io::Read;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

/// 串口数据事件负载（融合模式：增量流式 + 帧聚合）
///
/// 一帧数据在接收过程中会分多次 emit：
/// - `data` 仅携带**本次新增**的字节（增量），非整帧全量，避免重复传输。
/// - `frame_id` 同一帧内所有增量事件相同；前端据此把增量拼到同一条消息。
/// - `seq` 帧内增量序号（0,1,2...），供前端校验顺序。
/// - `is_final` 该帧是否已结束（静默间隙/上限/取消触发）。收尾事件即使无新增字节也会发出以闭合帧。
/// - `timestamp` 恒为本帧首字节到达的后端时间戳（前端整条采用，语义=接收时间）。
#[derive(Debug, Clone, serde::Serialize)]
pub struct SerialDataPayload {
    pub port_label: String,
    pub data: Vec<u8>,
    pub timestamp: u64,
    pub frame_id: u64,
    pub seq: u32,
    pub is_final: bool,
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

/// 增量刷新时间片（毫秒）——融合模式的核心节流参数
///
/// 帧接收过程中，最多每隔该时长把"这段时间攒下的新字节"作为一次增量 emit。
/// 事件频率被钳在 ~1000/APPEND_INTERVAL_MS ≈ 30 次/秒，与波特率无关：
/// 波特率越高，单次增量携带的字节越多（吞吐随波特率线性放大），事件数不变。
/// 因此显示"整块整块顺畅长出"，感知吞吐 = 波特率，绝不逐字节爬、也不会拖慢。
const APPEND_INTERVAL_MS: u64 = 33;

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
// emit_chunk! 在取消路径展开后紧跟 break，其中对 last_emit 的赋值不再被读，
// 属宏展开的良性误报；精准放行该 lint，不影响其它告警。
#[allow(unused_assignments)]
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
        let mut read_buf = [0u8; 1024];

        // ── 组包状态（融合模式）──────────────────────────────────
        // pending：本帧内已收到但尚未 emit 的增量字节；
        // frame_active：当前是否有一帧正在进行（收到首字节后为 true，定帧后为 false）；
        // frame_ts：本帧首字节到达的后端时间戳；frame_id：帧唯一 id（自增）；
        // seq：本帧内已发出的增量事件计数；
        // frame_len：本帧累计字节数（用于 MAX_FRAME_BYTES 上限判定）；
        // last_recv：最近收到字节时刻（判定静默间隙）；last_emit：最近一次增量 emit 时刻。
        let mut pending: Vec<u8> = Vec::with_capacity(1024);
        let mut frame_active = false;
        let mut frame_ts: u64 = 0;
        let mut frame_id: u64 = 0;
        let mut seq: u32 = 0;
        let mut frame_len: usize = 0;
        let mut last_recv: Option<Instant> = None;
        let mut last_emit = Instant::now();

        // 上限保护：持续数据流下也定期切帧，防止单帧无限增长撑爆内存/延迟。
        const MAX_FRAME_BYTES: usize = 4096;

        // 发出一次增量事件（携带 pending 中的新字节）。`final_frame=true` 时闭合本帧：
        // 即使无新增字节也会发出收尾事件，并重置帧状态，下一字节将开启新帧。
        macro_rules! emit_chunk {
            ($final_frame:expr) => {
                let is_final: bool = $final_frame;
                // 仅在"有新增字节"或"需要闭合帧"时才发，避免空事件刷屏
                if !pending.is_empty() || (is_final && frame_active) {
                    let payload = SerialDataPayload {
                        port_label: port_label.clone(),
                        data: std::mem::take(&mut pending),
                        timestamp: frame_ts,
                        frame_id,
                        seq,
                        is_final,
                    };
                    if let Err(e) = app_handle.emit("serial_data", payload) {
                        eprintln!("Failed to emit serial data [{}]: {}", port_label, e);
                    }
                    seq += 1;
                    last_emit = Instant::now();
                }
                if is_final {
                    // 闭合帧：重置状态，下一字节开新帧
                    frame_active = false;
                    frame_len = 0;
                    last_recv = None;
                }
            };
        }

        loop {
            // 检查取消信号
            if *cancel_rx.borrow() {
                emit_chunk!(true);
                break;
            }

            match port.read(&mut read_buf) {
                Ok(n) if n > 0 => {
                    // 若与上一次收到字节的间隔已超过帧超时，说明上一帧已结束，先闭合
                    if frame_active {
                        if let Some(prev) = last_recv {
                            if prev.elapsed() >= frame_timeout {
                                emit_chunk!(true);
                            }
                        }
                    }
                    // 本帧首字节：开启新帧，分配 frame_id、记录到达时间戳
                    if !frame_active {
                        frame_active = true;
                        frame_id += 1;
                        seq = 0;
                        frame_ts = now_millis();
                        // last_emit 沿用上一次 emit 时刻：若距上帧收尾已 >APPEND_INTERVAL_MS，
                        // 首片会尽快刷出（更跟手）；否则等满时间片，均无副作用。
                    }
                    pending.extend_from_slice(&read_buf[..n]);
                    frame_len += n;
                    last_recv = Some(Instant::now());

                    // 达到上限：闭合本帧（超大流被切成多条 ≤MAX_FRAME_BYTES 消息）
                    if frame_len >= MAX_FRAME_BYTES {
                        emit_chunk!(true);
                    } else if last_emit.elapsed() >= Duration::from_millis(APPEND_INTERVAL_MS) {
                        // 时间片到：把攒下的增量刷出去（帧仍进行中）
                        emit_chunk!(false);
                    }
                }
                Ok(_) => {
                    // 读到 0 字节，忽略
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                    // 读超时：静默达到帧超时则闭合本帧；否则若时间片到也刷一次增量
                    if frame_active {
                        if let Some(prev) = last_recv {
                            if prev.elapsed() >= frame_timeout {
                                emit_chunk!(true);
                            } else if last_emit.elapsed() >= Duration::from_millis(APPEND_INTERVAL_MS) {
                                emit_chunk!(false);
                            }
                        }
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
                            // 致命错误：通知前端，退出循环
                            eprintln!("Serial read fatal error [{}]: {}", port_label, e);

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
