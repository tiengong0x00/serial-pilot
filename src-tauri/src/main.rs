#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod error;
mod network;
mod power_monitor;
mod serial;
mod script;
mod state;
mod toolbox;

use error::SerialError;
use state::{AppState, ConnectionStatus, PortInfo, SerialConfig};
use tauri::State;
use include_dir::{include_dir, Dir};

/// 编译期内嵌的种子测试用例目录
static SEED_TEST_CASES: Dir = include_dir!("$CARGO_MANIFEST_DIR/../testcases");

/// 编译期内嵌的种子命令库目录
static SEED_COMMAND_LIBS: Dir = include_dir!("$CARGO_MANIFEST_DIR/../commands");

/// 编译期内嵌的种子脚本目录
static SEED_SCRIPTS: Dir = include_dir!("$CARGO_MANIFEST_DIR/../scripts");

/// 写入结果：包含写入字节数和后端生成的发送时间戳
///
/// 时间戳由后端在写入完成瞬间生成，与串口读取（RX）时间戳同源，
/// 避免前后端时钟不同步导致 TX/RX 显示顺序错乱。
#[derive(Debug, Clone, serde::Serialize)]
pub struct WriteResult {
    pub bytes_written: usize,
    pub timestamp: u64,
}

#[tauri::command]
async fn get_serial_ports(_state: State<'_, AppState>) -> Result<Vec<PortInfo>, SerialError> {
    serial::port_info::get_available_ports()
}

#[tauri::command]
async fn connect_serial_port(
    port_label: String,
    port_name: String,
    config: SerialConfig,
    state: State<'_, AppState>,
) -> Result<(), SerialError> {
    state.serial_manager.connect(&port_label, &port_name, &config)
}

#[tauri::command]
async fn disconnect_serial_port(
    port_label: String,
    state: State<'_, AppState>,
) -> Result<(), SerialError> {
    state.serial_manager.disconnect(&port_label)
}

#[tauri::command]
async fn get_connection_status(state: State<'_, AppState>) -> Result<ConnectionStatus, SerialError> {
    Ok(state.serial_manager.connection_status())
}

#[tauri::command]
async fn write_serial_data(
    port_label: String,
    data: Vec<u8>,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<WriteResult, SerialError> {
    let t0 = std::time::Instant::now();

    // 在写入开始前记录时间戳，确保 TX 时序早于其触发的 RX 响应
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let t1 = std::time::Instant::now();
    eprintln!("[PERF] write_serial_data entry: label={}, size={}, timestamp_gen={}μs",
        port_label, data.len(), (t1 - t0).as_micros());

    let bytes_written = state.serial_manager.write(&port_label, &data, &app_handle)?;

    let t2 = std::time::Instant::now();
    eprintln!("[PERF] write_serial_data exit: label={}, write_call={}μs, total={}μs",
        port_label, (t2 - t1).as_micros(), (t2 - t0).as_micros());

    Ok(WriteResult {
        bytes_written,
        timestamp,
    })
}

#[tauri::command]
async fn set_serial_dtr(
    port_label: String,
    level: bool,
    state: State<'_, AppState>,
) -> Result<(), SerialError> {
    state.serial_manager.set_dtr(&port_label, level)
}

#[tauri::command]
async fn set_serial_rts(
    port_label: String,
    level: bool,
    state: State<'_, AppState>,
) -> Result<(), SerialError> {
    state.serial_manager.set_rts(&port_label, level)
}

#[tauri::command]
async fn start_serial_listener(
    port_label: String,
    frame_timeout_ms: Option<u64>,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), SerialError> {
    let (port, cancel_rx) = state.serial_manager.get_port_for_listener(&port_label)?;
    // 默认 20ms 帧超时：相邻字节间隔超过该值即视为一包结束
    let frame_timeout_ms = frame_timeout_ms.unwrap_or(20);
    serial::listener::start_listener(port_label, port, cancel_rx, app_handle, frame_timeout_ms)
}

/// 获取测试用例文件目录路径（可执行文件同级的 testcases/）
fn get_test_cases_dir() -> std::path::PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("testcases")
}

/// 获取命令库文件目录路径（可执行文件同级的 commands/）
fn get_command_libs_dir() -> std::path::PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("commands")
}

/// 获取脚本文件目录路径（可执行文件同级的 scripts/）
fn get_scripts_dir() -> std::path::PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("scripts")
}

/// 通用种子释放：目录不存在才创建并释放内嵌文件
///
/// 已存在则完全跳过（尊重用户已有文件）。种子在编译期通过 include_dir! 内嵌，
/// 无需依赖外部资源目录，单 exe 即可自我释放。
///
/// - testcases/commands 目录释放 .json 和 .md 文件
/// - scripts 目录释放所有文件（.py/.sh/.bat/.txt 等）
fn seed_dir_if_absent(
    seed: &Dir,
    target_dir: &std::path::Path,
    tag: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    if target_dir.exists() {
        eprintln!("[Seed] {} directory already exists, skipping", tag);
        return Ok(());
    }

    eprintln!("[Seed] Creating {} directory and extracting seed files", tag);
    std::fs::create_dir_all(target_dir)?;

    let is_scripts = tag == "scripts";

    for entry in seed.files() {
        if let Some(filename) = entry.path().file_name().and_then(|n| n.to_str()) {
            // scripts 目录释放所有文件，其他目录只释放 .json 和 .md
            let should_extract = if is_scripts {
                true
            } else {
                filename.ends_with(".json") || filename.ends_with(".md")
            };

            if should_extract {
                let target_path = target_dir.join(filename);
                std::fs::write(&target_path, entry.contents())?;
                eprintln!("[Seed] Written {}/{}", tag, filename);
            }
        }
    }

    Ok(())
}

/// 确保种子测试用例已释放到运行目录
fn ensure_test_cases_seeded() -> Result<(), Box<dyn std::error::Error>> {
    seed_dir_if_absent(&SEED_TEST_CASES, &get_test_cases_dir(), "testcases")
}

/// 确保种子命令库已释放到运行目录
fn ensure_command_libs_seeded() -> Result<(), Box<dyn std::error::Error>> {
    seed_dir_if_absent(&SEED_COMMAND_LIBS, &get_command_libs_dir(), "commands")
}

/// 确保种子脚本已释放到运行目录
fn ensure_scripts_seeded() -> Result<(), Box<dyn std::error::Error>> {
    seed_dir_if_absent(&SEED_SCRIPTS, &get_scripts_dir(), "scripts")
}

/// 命令库文件（对应 cmd/*.json 的一个文件）
///
/// 原样返回给前端，去重与合并在前端完成（保留来源文件信息以便按文件名排序去重）。
#[derive(Debug, Clone, serde::Serialize)]
pub struct CommandLibFile {
    /// 文件名（如 at-general.json），前端按字母序排序决定去重优先级
    pub filename: String,
    /// 文件原始 JSON 内容
    pub content: String,
}

/// 加载 cmd/ 目录下全部命令库文件
///
/// 按文件名排序返回，前端据此合并去重（靠前文件优先）。
/// 目录不存在返回空列表（正常情况 setup 已释放种子）。
#[tauri::command]
fn load_command_libraries() -> Result<Vec<CommandLibFile>, String> {
    let dir = get_command_libs_dir();
    if !dir.exists() {
        return Ok(vec![]);
    }

    let entries = std::fs::read_dir(&dir).map_err(|e| format!("Failed to read command library directory: {}", e))?;

    let mut libs = vec![];
    for entry in entries.flatten() {
        let name = match entry.file_name().to_str() {
            Some(n) if n.ends_with(".json") => n.to_string(),
            _ => continue,
        };
        match std::fs::read_to_string(entry.path()) {
            Ok(content) => libs.push(CommandLibFile { filename: name, content }),
            Err(e) => eprintln!("[Command Library] Failed to read {}: {}", name, e),
        }
    }

    // 按文件名排序：前端去重时靠前文件优先
    libs.sort_by(|a, b| a.filename.cmp(&b.filename));
    Ok(libs)
}

/// 获取日志保存目录（可执行文件路径下的 logs/）
fn get_logs_dir() -> std::path::PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("logs")
}

/// 保存日志到文件
///
/// 自动保存到 logs/ 目录，如果目录不存在则创建。
/// 返回保存的完整路径。
#[tauri::command]
fn save_log_file(filename: String, content: String) -> Result<String, String> {
    // 安全检查：防止路径穿越
    if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
        return Err("Invalid filename".to_string());
    }
    if !filename.ends_with(".txt") && !filename.ends_with(".log") {
        return Err("Filename must end with .txt or .log".to_string());
    }

    let dir = get_logs_dir();
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create log directory: {}", e))?;
    }

    let path = dir.join(&filename);
    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to save log file {}: {}", filename, e))?;

    // 返回完整路径供前端显示
    Ok(path.to_string_lossy().to_string())
}

/// 列出 testcases/ 目录下所有 JSON 文件
#[tauri::command]
fn list_test_case_files() -> Result<Vec<String>, String> {
    let dir = get_test_cases_dir();
    if !dir.exists() {
        return Ok(vec![]);
    }

    let entries = std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut files = vec![];
    for entry in entries.flatten() {
        if let Some(name) = entry.file_name().to_str() {
            if name.ends_with(".json") {
                files.push(name.to_string());
            }
        }
    }
    files.sort();
    Ok(files)
}

/// 读取指定测试用例文件内容
#[tauri::command]
fn load_test_case_file(filename: String) -> Result<String, String> {
    // 安全检查：防止路径穿越
    if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
        return Err("Invalid filename".to_string());
    }

    let path = get_test_cases_dir().join(&filename);
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read file {}: {}", filename, e))
}

/// 保存测试用例文件
#[tauri::command]
fn save_test_case_file(filename: String, content: String) -> Result<(), String> {
    // 安全检查：防止路径穿越
    if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
        return Err("Invalid filename".to_string());
    }
    if !filename.ends_with(".json") {
        return Err("Filename must end with .json".to_string());
    }

    let dir = get_test_cases_dir();
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    let path = dir.join(&filename);
    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to save file {}: {}", filename, e))
}

/// 删除测试用例文件
#[tauri::command]
fn delete_test_case_file(filename: String) -> Result<(), String> {
    // 安全检查：防止路径穿越
    if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
        return Err("Invalid filename".to_string());
    }

    let path = get_test_cases_dir().join(&filename);
    if !path.exists() {
        return Err("File does not exist".to_string());
    }

    std::fs::remove_file(&path)
        .map_err(|e| format!("Failed to delete file {}: {}", filename, e))
}

/// 重命名测试用例文件
#[tauri::command]
fn rename_test_case_file(old_name: String, new_name: String) -> Result<(), String> {
    // 安全检查：防止路径穿越
    if old_name.contains("..") || old_name.contains('/') || old_name.contains('\\') {
        return Err("Invalid filename".to_string());
    }
    if new_name.contains("..") || new_name.contains('/') || new_name.contains('\\') {
        return Err("Invalid filename".to_string());
    }
    if !new_name.ends_with(".json") {
        return Err("New filename must end with .json".to_string());
    }

    let dir = get_test_cases_dir();
    let old_path = dir.join(&old_name);
    let new_path = dir.join(&new_name);

    if !old_path.exists() {
        return Err("Source file does not exist".to_string());
    }
    if new_path.exists() {
        return Err("Target filename already exists".to_string());
    }

    std::fs::rename(&old_path, &new_path)
        .map_err(|e| format!("Failed to rename file: {}", e))
}

// ============================================================================
// 网络工具命令
// ============================================================================

/// TCP 连接
#[tauri::command]
async fn tcp_connect(
    connection_id: String,
    host: String,
    port: u16,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<network::ConnectResponse, String> {
    state.network_manager.tcp_connect(connection_id, host, port, app_handle).await
}

/// TCP 发送数据
#[tauri::command]
async fn tcp_send(
    connection_id: String,
    data: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    state.network_manager.tcp_send(&connection_id, data).await
}

/// UDP 连接（绑定本地端口 + connect 对端，返回本地 IP/端口）
#[tauri::command]
async fn udp_connect(
    connection_id: String,
    local_port: u16,
    target_host: String,
    target_port: u16,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<network::ConnectResponse, String> {
    state
        .network_manager
        .udp_connect(connection_id, local_port, target_host, target_port, app_handle)
        .await
}

/// UDP 发送数据到已连接对端
#[tauri::command]
async fn udp_send(
    connection_id: String,
    data: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    state.network_manager.udp_send(&connection_id, data).await
}

/// 断开网络连接
#[tauri::command]
async fn net_disconnect(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.network_manager.disconnect(&connection_id)
}

// ============================================================================
// 更新检测相关
// ============================================================================

/// 检测当前运行的版本类型
///
/// 返回值：
/// - "installer" - 安装版（在 Program Files 或 Program Files (x86) 下）
/// - "portable" - 绿色版（在其他位置）
/// - "debug" - Debug 版本（编译时 debug_assertions 开启）
#[tauri::command]
fn get_build_type() -> String {
    // Debug 版本优先判断
    #[cfg(debug_assertions)]
    {
        return "debug".to_string();
    }

    // Release 版本判断是否为安装版
    #[cfg(not(debug_assertions))]
    {
        if let Ok(exe_path) = std::env::current_exe() {
            let path_str = exe_path.to_string_lossy().to_lowercase();
            // 检查是否在 Program Files 目录下
            if path_str.contains("program files") {
                return "installer".to_string();
            }
        }
        "portable".to_string()
    }
}

fn main() {
    if let Err(e) = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::new())
        .setup(|app| {
            // 启动时释放内嵌的种子测试用例（目录不存在才创建）
            if let Err(e) = ensure_test_cases_seeded() {
                eprintln!("[Seed] testcases failed: {}", e);
            }
            // 启动时释放内嵌的种子命令库（目录不存在才创建）
            if let Err(e) = ensure_command_libs_seeded() {
                eprintln!("[Seed] commands failed: {}", e);
            }
            // 启动时释放内嵌的种子脚本（目录不存在才创建）
            if let Err(e) = ensure_scripts_seeded() {
                eprintln!("[Seed] scripts failed: {}", e);
            }

            // 启动电源监听器（监听系统休眠/恢复事件）
            power_monitor::setup_power_monitor(app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_serial_ports,
            connect_serial_port,
            disconnect_serial_port,
            get_connection_status,
            write_serial_data,
            set_serial_dtr,
            set_serial_rts,
            start_serial_listener,
            list_test_case_files,
            load_test_case_file,
            save_test_case_file,
            delete_test_case_file,
            rename_test_case_file,
            save_log_file,
            load_command_libraries,
            toolbox::open_toolbox_window,
            tcp_connect,
            tcp_send,
            udp_connect,
            udp_send,
            net_disconnect,
            script::execute_script,
            get_build_type
        ])
        .run(tauri::generate_context!())
    {
        eprintln!("Tauri application failed to run: {e}");
        std::process::exit(1);
    }
}
