// CLI 模式使用控制台，GUI 模式动态隐藏控制台窗口
// #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod attachments;
mod cli;
mod config;
mod dist_type;
mod error;
mod network;
mod portable_updater;
mod power_monitor;
mod report;
mod serial;
mod script;
mod state;
mod toolbox;

use error::SerialError;
use serial::port_info::get_available_ports;
use state::{AppState, ConnectionStatus, PortInfo, SerialConfig};
use tauri::{Manager, State};
use tauri_plugin_updater::UpdaterExt;
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
    file_packet_size: u32,
    state: State<'_, AppState>,
) -> Result<(), SerialError> {
    state.serial_manager.connect(&port_label, &port_name, &config, file_packet_size)
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
    file_packet_size: u32,
    file_packet_interval: u32,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<WriteResult, SerialError> {
    // 在写入开始前记录时间戳，确保 TX 时序早于其触发的 RX 响应
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let bytes_written = state.serial_manager.write(
        &port_label,
        &data,
        file_packet_size,
        file_packet_interval,
        &app_handle,
    )?;

    Ok(WriteResult {
        bytes_written,
        timestamp,
    })
}

/// 保存附件到磁盘缓存，返回引用（id/name/size）。字节仅上传时走一次 IPC。
/// 用于终端直接上传（不属于任何用例），存储到 attachments/ 扁平目录。
#[tauri::command]
async fn save_attachment(
    data: Vec<u8>,
    name: String,
) -> Result<attachments::AttachmentRef, SerialError> {
    attachments::save_attachment(&data, &name)
}

/// 保存用例附件，存储到 testcases/<用例名>/ 下，id 为相对路径 "用例名/文件名"。
#[tauri::command]
async fn save_testcase_attachment(
    data: Vec<u8>,
    name: String,
    testcase_name: String,
) -> Result<attachments::AttachmentRef, SerialError> {
    attachments::save_testcase_attachment(&data, &name, &testcase_name)
}

/// 检查附件是否存在（执行前校验，缺失给明确提示）
#[tauri::command]
async fn attachment_exists(id: String) -> Result<bool, SerialError> {
    Ok(attachments::attachment_exists(&id))
}

/// 删除附件（取消/移除文件时调用）
#[tauri::command]
async fn delete_attachment(id: String) -> Result<(), SerialError> {
    attachments::delete_attachment(&id)
}

/// 后端流式发送附件：按 id 打开磁盘文件，分块背靠背读盘+发送并 emit 进度事件。
/// block_size=0 按默认 256 处理；interval_ms=0 为连续发送（块间零停顿）。
#[tauri::command]
async fn send_attachment(
    port_label: String,
    id: String,
    block_size: u32,
    interval_ms: u32,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), SerialError> {
    state.serial_manager.send_attachment(&port_label, &id, block_size, interval_ms, app_handle)
}

/// 取消指定端口正在进行的文件发送
#[tauri::command]
async fn cancel_file_send(
    port_label: String,
    state: State<'_, AppState>,
) -> Result<(), SerialError> {
    state.serial_manager.cancel_file_send(&port_label);
    Ok(())
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

/// exe 所在目录
fn get_exe_dir() -> std::path::PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."))
}

/// 获取测试用例文件目录路径。
/// 优先使用配置中的路径（相对/绝对），未配置时用默认 exe 同级 testcases/。
fn get_test_cases_dir() -> std::path::PathBuf {
    let cfg = config::global().get();
    config::resolve_config_path(&cfg.testcases_dir)
        .unwrap_or_else(|| get_exe_dir().join("testcases"))
}

/// 获取命令库文件目录路径。
/// 优先使用配置中的路径（相对/绝对），未配置时用默认 exe 同级 commands/。
fn get_command_libs_dir() -> std::path::PathBuf {
    let cfg = config::global().get();
    config::resolve_config_path(&cfg.commands_dir)
        .unwrap_or_else(|| get_exe_dir().join("commands"))
}

/// 获取脚本文件目录路径（可执行文件同级的 scripts/）
fn get_scripts_dir() -> std::path::PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("scripts")
}

// ============================================================================
// 应用配置命令（路径可配置）
// ============================================================================

/// 读取应用配置（测试用例/命令库路径等）
#[tauri::command]
fn get_app_config() -> config::AppConfig {
    config::global().get()
}

/// 设置测试用例目录路径（空字符串表示恢复默认）
#[tauri::command]
fn set_testcases_dir(path: String) -> Result<(), String> {
    config::global().update(|cfg| cfg.testcases_dir = path)
}

/// 设置命令库目录路径（空字符串表示恢复默认）
#[tauri::command]
fn set_commands_dir(path: String) -> Result<(), String> {
    config::global().update(|cfg| cfg.commands_dir = path)
}

/// 打开帮助手册（根据类型和语言打开对应 README，用系统默认程序）
#[tauri::command]
fn open_help_manual(manual_type: String, language: String) -> Result<(), String> {
    let dir = match manual_type.as_str() {
        "testcases" => get_test_cases_dir(),
        "commands" => get_command_libs_dir(),
        _ => return Err(format!("Invalid manual type: {}", manual_type)),
    };

    let filename = if language.starts_with("zh") {
        "README.md"
    } else {
        "README_EN.md"
    };

    let path = dir.join(filename);
    if !path.exists() {
        return Err(format!("Help manual not found: {}", path.display()));
    }

    let path_str = path
        .to_str()
        .ok_or_else(|| "Invalid path encoding".to_string())?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", path_str])
            .spawn()
            .map_err(|e| format!("Failed to open manual: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path_str)
            .spawn()
            .map_err(|e| format!("Failed to open manual: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path_str)
            .spawn()
            .map_err(|e| format!("Failed to open manual: {}", e))?;
    }

    Ok(())
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
    /// 文件名（如 TS_27.007.json），前端按字母序排序决定去重优先级
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

/// 保存命令库文件
///
/// filename: 文件名（如 "custom-commands.json"）
/// content: JSON 字符串内容
#[tauri::command]
fn save_command_library(filename: String, content: String) -> Result<(), String> {
    let dir = get_command_libs_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create directory: {}", e))?;

    let path = dir.join(&filename);
    std::fs::write(&path, content).map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(())
}

/// 删除命令库文件
///
/// filename: 文件名（如 "custom-commands.json"）
#[tauri::command]
fn delete_command_library(filename: String) -> Result<(), String> {
    let dir = get_command_libs_dir();
    let path = dir.join(&filename);

    if !path.exists() {
        return Err(format!("File not found: {}", filename));
    }

    std::fs::remove_file(&path).map_err(|e| format!("Failed to delete file: {}", e))?;
    Ok(())
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

/// 获取工具启动目录（exe 所在目录）
#[tauri::command]
fn get_launch_dir() -> Result<String, String> {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .ok_or_else(|| "Failed to get launch directory".to_string())
        .map(|p| p.to_string_lossy().to_string())
}

/// 保存日志到用户指定的完整路径（用于对话框选择后的路径）
#[tauri::command]
fn save_log_to_path(path: String, content: String) -> Result<(), String> {
    // 确保目录存在
    if let Some(parent) = std::path::Path::new(&path).parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        }
    }

    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to save log: {}", e))
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
        .map_err(|e| format!("Failed to delete file {}: {}", filename, e))?;

    // 同步删除该用例的附件目录（testcases/<用例名>/）
    let case_name = filename.strip_suffix(".json").unwrap_or(&filename);
    let attachment_dir = get_test_cases_dir().join(case_name);
    if attachment_dir.exists() && attachment_dir.is_dir() {
        let _ = std::fs::remove_dir_all(&attachment_dir); // 静默失败，不影响用例删除
    }

    Ok(())
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
        .map_err(|e| format!("Failed to rename file: {}", e))?;

    // 提取用例名（去掉 .json 后缀）
    let old_stem = old_name.strip_suffix(".json").unwrap_or(&old_name);
    let new_stem = new_name.strip_suffix(".json").unwrap_or(&new_name);

    // 重命名附件目录（如果存在）
    let old_dir = dir.join(old_stem);
    let new_dir = dir.join(new_stem);
    if old_dir.exists() && old_dir.is_dir() {
        std::fs::rename(&old_dir, &new_dir)
            .map_err(|e| format!("Failed to rename attachment directory: {}", e))?;
    }

    // 重写 JSON 中的附件 id 路径前缀
    rewrite_attachment_ids(&new_path, old_stem, new_stem)?;

    Ok(())
}

/// 重写 JSON 文件中所有附件 id 的路径前缀（用于重命名用例时同步更新）
fn rewrite_attachment_ids(
    json_path: &std::path::Path,
    old_prefix: &str,
    new_prefix: &str,
) -> Result<(), String> {
    let content = std::fs::read_to_string(json_path)
        .map_err(|e| format!("Failed to read JSON: {}", e))?;

    let mut value: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;

    // 递归替换所有 id 字段中的路径前缀
    replace_id_prefix(&mut value, old_prefix, new_prefix);

    let new_content = serde_json::to_string_pretty(&value)
        .map_err(|e| format!("Failed to serialize JSON: {}", e))?;

    std::fs::write(json_path, new_content)
        .map_err(|e| format!("Failed to write JSON: {}", e))?;

    Ok(())
}

/// 递归替换 JSON 中所有 id 字段的路径前缀
fn replace_id_prefix(value: &mut serde_json::Value, old_prefix: &str, new_prefix: &str) {
    match value {
        serde_json::Value::Object(map) => {
            if let Some(serde_json::Value::String(id)) = map.get_mut("id") {
                let old_path = format!("{}/", old_prefix);
                let new_path = format!("{}/", new_prefix);
                if id.starts_with(&old_path) {
                    *id = id.replacen(&old_path, &new_path, 1);
                }
            }
            for v in map.values_mut() {
                replace_id_prefix(v, old_prefix, new_prefix);
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                replace_id_prefix(v, old_prefix, new_prefix);
            }
        }
        _ => {}
    }
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

/// 统一更新入口：根据分发类型自动选择更新策略
#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Result<portable_updater::UpdateInfo, String> {
    let dist_type = dist_type::DistType::detect();

    match dist_type {
        dist_type::DistType::Nsis => {
            // NSIS 安装版：使用 Tauri 内置 updater
            check_update_nsis(app).await
        }
        dist_type::DistType::Portable => {
            // 绿色版：持久化标记（更新后临时目录仍能识别），使用自定义更新器
            let _ = dist_type.persist_marker();
            portable_updater::check_update_portable(app).await
        }
    }
}

/// 安装更新：根据分发类型执行对应的安装流程
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let dist_type = dist_type::DistType::detect();

    match dist_type {
        dist_type::DistType::Nsis => {
            // NSIS 安装版：使用 Tauri 内置 updater
            install_update_nsis(app).await
        }
        dist_type::DistType::Portable => {
            // 绿色版：使用自定义更新器
            portable_updater::install_update_portable(app).await
        }
    }
}

/// NSIS 版本检查更新（Tauri 内置 updater）
async fn check_update_nsis(app: tauri::AppHandle) -> Result<portable_updater::UpdateInfo, String> {
    let endpoint = dist_type::DistType::Nsis.endpoint();

    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint.parse().map_err(|e| format!("Invalid endpoint: {}", e))?])
        .map_err(|e| format!("Failed to set endpoint: {}", e))?
        .build()
        .map_err(|e| format!("Failed to build updater: {}", e))?;

    match updater.check().await {
        Ok(Some(update)) => {
            Ok(portable_updater::UpdateInfo {
                available: true,
                version: Some(update.version.clone()),
            })
        }
        Ok(None) => {
            Ok(portable_updater::UpdateInfo {
                available: false,
                version: None,
            })
        }
        Err(e) => Err(format!("Update check failed: {}", e)),
    }
}

/// NSIS 版本安装更新（Tauri 内置 updater）
async fn install_update_nsis(app: tauri::AppHandle) -> Result<(), String> {
    let endpoint = dist_type::DistType::Nsis.endpoint();

    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint.parse().map_err(|e| format!("Invalid endpoint: {}", e))?])
        .map_err(|e| format!("Failed to set endpoint: {}", e))?
        .build()
        .map_err(|e| format!("Failed to build updater: {}", e))?;

    if let Some(update) = updater.check().await.map_err(|e| format!("Update check failed: {}", e))? {
        update
            .download_and_install(|_, _| {}, || {})
            .await
            .map_err(|e| format!("Update installation failed: {}", e))?;
    }

    Ok(())
}

fn main() {
    use clap::Parser;

    // 解析命令行参数
    let cli = cli::Cli::parse();

    // 在 Windows 上，如果是 GUI 模式（无 CLI 参数），隐藏控制台窗口
    #[cfg(target_os = "windows")]
    if cli.command.is_none() {
        use windows::Win32::System::Console::FreeConsole;
        unsafe {
            let _ = FreeConsole();
        }
    }

    // 如果有 CLI 命令，设置控制台 UTF-8 编码
    #[cfg(target_os = "windows")]
    if cli.command.is_some() {
        use windows::Win32::System::Console::SetConsoleOutputCP;
        unsafe {
            let _ = SetConsoleOutputCP(65001);
        }
    }

    if cli.command.is_some() {
        run_cli_mode(cli);
    } else {
        run_gui_mode();
    }
}

fn run_gui_mode() {
    if let Err(e) = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
        .manage(Mutex::new(ReportState { writer: None }))
        .setup(|app| {
            // 初始化全局配置（必须在路径函数被调用之前）
            config::init_global();

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
            // 启动时清理无引用的孤儿附件（崩溃残留、外部删用例等）
            if let Err(e) = attachments::gc_orphaned_attachments(&get_test_cases_dir()) {
                eprintln!("[Attachments GC] failed: {}", e);
            }

            // 启动电源监听器（监听系统休眠/恢复事件）
            power_monitor::setup_power_monitor(app.handle().clone());

            // 启动时检测并持久化分发类型（确保绿色版标识被正确记录）
            let dist = dist_type::DistType::detect();
            if let Err(e) = dist.persist_marker() {
                eprintln!("[DistType] Failed to persist marker: {}", e);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_serial_ports,
            connect_serial_port,
            disconnect_serial_port,
            get_connection_status,
            write_serial_data,
            save_attachment,
            save_testcase_attachment,
            attachment_exists,
            delete_attachment,
            send_attachment,
            cancel_file_send,
            set_serial_dtr,
            set_serial_rts,
            start_serial_listener,
            list_test_case_files,
            load_test_case_file,
            load_test_case_file_cli,
            save_test_case_file,
            delete_test_case_file,
            rename_test_case_file,
            save_log_file,
            get_launch_dir,
            save_log_to_path,
            load_command_libraries,
            save_command_library,
            delete_command_library,
            toolbox::open_toolbox_window,
            tcp_connect,
            tcp_send,
            udp_connect,
            udp_send,
            net_disconnect,
            script::execute_script,
            get_build_type,
            check_update,
            install_update,
            get_app_config,
            set_testcases_dir,
            set_commands_dir,
            open_help_manual,
            portable_updater::check_update_portable,
            portable_updater::install_update_portable,
            start_report,
            write_report_record,
            close_report,
            convert_csv_to_excel,
            get_attachments_dir,
            cleanup_old_excel_reports
        ])
        .run(tauri::generate_context!())
    {
        eprintln!("Tauri application failed to run: {e}");
        std::process::exit(1);
    }
}

/// CLI 专用：读取测试用例文件（支持相对路径和绝对路径）
#[tauri::command]
fn load_test_case_file_cli(filepath: String) -> Result<String, String> {
    use std::path::Path;

    // 将正斜杠统一转换为系统路径分隔符
    let normalized = filepath.replace('/', std::path::MAIN_SEPARATOR_STR);
    let path = Path::new(&normalized);

    // 如果是绝对路径，直接使用
    if path.is_absolute() {
        return std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read file {}: {}", normalized, e));
    }

    // 如果是相对路径，先尝试相对于当前目录
    if path.exists() {
        return std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read file {}: {}", normalized, e));
    }

    // 最后尝试相对于 testcases 目录
    let testcases_path = get_test_cases_dir().join(&normalized);
    std::fs::read_to_string(&testcases_path)
        .map_err(|e| format!("Failed to read file {} (tried current dir and testcases dir): {}", normalized, e))
}

/// CLI 模式：创建隐藏窗口，调用前端逻辑
fn run_cli_mode(cli: cli::Cli) {
    use cli::Commands;
    use tauri::Emitter;

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
        .setup(move |app| {
            // 初始化配置
            config::init_global();

            // 启动时释放种子文件
            let _ = ensure_test_cases_seeded();
            let _ = ensure_command_libs_seeded();
            let _ = ensure_scripts_seeded();
            let _ = attachments::gc_orphaned_attachments(&get_test_cases_dir());

            // 启动电源监听器
            power_monitor::setup_power_monitor(app.handle().clone());

            // 持久化分发类型
            let dist = dist_type::DistType::detect();
            let _ = dist.persist_marker();

            // 关闭默认创建的主窗口（如果存在）
            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.close();
            }

            // 创建 CLI 专用窗口
            let window = tauri::WebviewWindowBuilder::new(
                app,
                "cli-window",
                tauri::WebviewUrl::App("index.html?cli=true".into())
            )
            .title("Serial Pilot CLI")
            .inner_size(1200.0, 800.0)
            .visible(cli.show_window)
            .initialization_script(r#"
                window.__CLI_MODE__ = true;
            "#)
            .build()
            .expect("Failed to create window");

            // 等待前端就绪
            use tauri::Listener;
            use std::sync::{Arc, Mutex};

            let ready = Arc::new(Mutex::new(false));
            let ready_clone = ready.clone();

            let _unlisten_ready = window.listen("cli-ready", move |_event| {
                let mut is_ready = ready_clone.lock().unwrap();
                *is_ready = true;
            });

            // 执行 CLI 命令
            let window_clone = window.clone();
            let cli_clone = cli.clone();
            let ready_clone2 = ready.clone();

            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(1000));

                // 等待 cli-ready 事件
                let ready_timeout = std::time::Duration::from_millis(5000);
                let ready_start = std::time::Instant::now();

                loop {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    let is_ready = ready_clone2.lock().unwrap();
                    if *is_ready {
                        break;
                    }

                    if ready_start.elapsed() > ready_timeout {
                        eprintln!("错误: 前端初始化超时");
                        std::process::exit(1);
                    }
                }

                // 执行对应的 CLI 命令
                match cli_clone.command.unwrap() {
                    Commands::ListPorts => {
                        if let Err(e) = handle_list_ports_cli() {
                            eprintln!("错误: {}", e);
                            std::process::exit(1);
                        }
                        std::process::exit(0);
                    }
                    Commands::Send { command, port, baud, listen, format, line_ending } => {
                        handle_send_command_cli(&window_clone, command, port, baud, listen, format, line_ending);
                    }
                    Commands::Run { test_case, port, baud, output, verbose } => {
                        handle_run_test_case_cli(&window_clone, test_case, port, baud, output, verbose);
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_serial_ports,
            connect_serial_port,
            disconnect_serial_port,
            get_connection_status,
            write_serial_data,
            save_attachment,
            save_testcase_attachment,
            attachment_exists,
            delete_attachment,
            send_attachment,
            cancel_file_send,
            set_serial_dtr,
            set_serial_rts,
            start_serial_listener,
            list_test_case_files,
            load_test_case_file,
            load_test_case_file_cli,
            save_test_case_file,
            delete_test_case_file,
            rename_test_case_file,
            save_log_file,
            get_launch_dir,
            save_log_to_path,
            load_command_libraries,
            save_command_library,
            delete_command_library,
            toolbox::open_toolbox_window,
            tcp_connect,
            tcp_send,
            udp_connect,
            udp_send,
            net_disconnect,
            script::execute_script,
            get_build_type,
            check_update,
            install_update,
            get_app_config,
            set_testcases_dir,
            set_commands_dir,
            open_help_manual,
            portable_updater::check_update_portable,
            portable_updater::install_update_portable
        ])
        .run(tauri::generate_context!())
        .expect("Failed to run CLI mode");
}

/// CLI list-ports: 列出可用串口
fn handle_list_ports_cli() -> Result<(), String> {
    let ports = get_available_ports().map_err(|e| e.to_string())?;

    if ports.is_empty() {
        println!("未检测到可用串口");
    } else {
        println!("可用串口:");
        for port in ports {
            let desc = port.friendly_name.as_deref().unwrap_or("Unknown");
            println!("  {} - {}", port.port_name, desc);
        }
    }

    Ok(())
}

/// CLI send: 通过前端发送单条命令
fn handle_send_command_cli(
    window: &tauri::WebviewWindow,
    command: String,
    port: String,
    baud: u32,
    listen_ms: u64,
    format: String,
    line_ending: String,
) {
    use tauri::Listener;
    use std::sync::{Arc, Mutex};

    let window_clone = window.clone();
    let completed = Arc::new(Mutex::new(false));
    let completed_clone = completed.clone();

    // 监听终端数据
    let _unlisten_terminal = window.listen("cli-terminal-data", move |event| {
        if let Ok(data) = serde_json::from_str::<cli::TerminalData>(event.payload()) {
            format_and_print_terminal_data(&data);
        }
    });

    // 监听命令完成
    let _unlisten_complete = window.clone().listen("cli-command-complete", move |event| {
        let mut done = completed_clone.lock().unwrap();
        *done = true;

        if let Ok(result) = serde_json::from_str::<serde_json::Value>(event.payload()) {
            if let Some(error) = result.get("error") {
                eprintln!("错误: {}", error);
                std::process::exit(1);
            }
        }
    });

    println!("[CLI] Sending command to {} at {} baud...", port, baud);

    // 调用前端函数
    let script = format!(
        r#"window.__cliSendCommand({{
            command: "{}",
            port: "{}",
            baud: {},
            listenMs: {},
            format: "{}",
            lineEnding: "{}"
        }})"#,
        command.replace('"', "\\\""),
        port,
        baud,
        listen_ms,
        format,
        line_ending
    );

    if let Err(e) = window_clone.eval(&script) {
        eprintln!("调用前端函数失败: {}", e);
        std::process::exit(1);
    }

    // 等待命令完成
    let timeout = std::time::Duration::from_millis(listen_ms + 10000);
    let start = std::time::Instant::now();

    loop {
        std::thread::sleep(std::time::Duration::from_millis(100));

        let done = completed.lock().unwrap();
        if *done {
            break;
        }

        if start.elapsed() > timeout {
            eprintln!("\n超时");
            std::process::exit(1);
        }
    }

    std::process::exit(0);
}

/// CLI run: 通过前端执行测试用例
fn handle_run_test_case_cli(
    window: &tauri::WebviewWindow,
    test_case: String,
    port: Option<String>,
    baud: Option<u32>,
    output: Option<String>,
    verbose: bool,
) {
    use tauri::Listener;
    use std::sync::{Arc, Mutex};

    let completed = Arc::new(Mutex::new(false));
    let completed_clone = completed.clone();
    let test_result = Arc::new(Mutex::new(None));
    let test_result_clone = test_result.clone();

    // 监听终端数据
    let _unlisten_terminal = window.listen("cli-terminal-data", move |event| {
        if let Ok(data) = serde_json::from_str::<cli::TerminalData>(event.payload()) {
            format_and_print_terminal_data(&data);
        }
    });

    // 监听执行日志
    let verbose_flag = verbose;
    let _unlisten_log = window.clone().listen("cli-execution-log", move |event| {
        if let Ok(log) = serde_json::from_str::<cli::ExecutionLog>(event.payload()) {
            if verbose_flag || log.level == "error" || log.level == "warning" {
                format_and_print_execution_log(&log);
            }
        }
    });

    // 监听测试完成
    let _unlisten_complete = window.clone().listen("cli-test-complete", move |event| {
        let mut done = completed_clone.lock().unwrap();
        *done = true;

        if let Ok(result) = serde_json::from_str::<cli::TestCompleteResult>(event.payload()) {
            let mut test_res = test_result_clone.lock().unwrap();
            *test_res = Some(result);
        }
    });

    println!("[CLI] Running test case: {}", test_case);

    // 调用前端函数
    let port_str = port.as_deref().unwrap_or("null");
    let baud_str = baud.map(|b| b.to_string()).unwrap_or_else(|| "null".to_string());

    let script = format!(
        r#"window.__cliRunTestCase({{
            testCaseFile: "{}",
            port: {},
            baud: {},
            verbose: {}
        }})"#,
        test_case.replace('"', "\\\""),
        if port.is_some() { format!("\"{}\"", port_str) } else { "null".to_string() },
        baud_str,
        verbose
    );

    if let Err(e) = window.eval(&script) {
        eprintln!("调用前端函数失败: {}", e);
        std::process::exit(1);
    }

    // 等待测试完成（最多 30 分钟）
    let timeout = std::time::Duration::from_secs(1800);
    let start = std::time::Instant::now();

    loop {
        std::thread::sleep(std::time::Duration::from_millis(100));

        let done = completed.lock().unwrap();
        if *done {
            break;
        }

        if start.elapsed() > timeout {
            eprintln!("\n测试执行超时");
            std::process::exit(1);
        }
    }

    // 输出测试结果
    let result = test_result.lock().unwrap();
    if let Some(res) = result.as_ref() {
        println!("\n{}", "=".repeat(50));
        if res.success {
            println!("✓ 测试完成");
            if let (Some(total), Some(success)) = (res.total_commands, res.success_commands) {
                println!("  成功: {}/{}", success, total);
            }
        } else {
            println!("✗ 测试失败");
            if let Some(error) = &res.error {
                println!("  错误: {}", error);
            }
            if let (Some(total), Some(failed)) = (res.total_commands, res.failed_commands) {
                println!("  失败: {}/{}", failed, total);
            }
        }
        println!("{}", "=".repeat(50));

        // 保存结果到文件
        if let Some(output_path) = output {
            if let Ok(json) = serde_json::to_string_pretty(&*result) {
                if let Err(e) = std::fs::write(&output_path, json) {
                    eprintln!("保存结果失败: {}", e);
                } else {
                    println!("结果已保存到: {}", output_path);
                }
            }
        }

        std::process::exit(if res.success { 0 } else { 1 });
    } else {
        eprintln!("未收到测试结果");
        std::process::exit(1);
    }
}

/// 格式化并打印终端数据
fn format_and_print_terminal_data(data: &cli::TerminalData) {
    let direction = if data.direction == "TX" { "→" } else { "←" };
    let port = &data.port;

    let content = if data.format == "hex" {
        data.data.iter()
            .map(|b| format!("{:02X}", b))
            .collect::<Vec<_>>()
            .join(" ")
    } else {
        String::from_utf8_lossy(&data.data).to_string()
    };

    let timestamp = format_timestamp(data.timestamp as f64);
    println!("[{}] {} {}: {}", timestamp, direction, port, content);
}

/// 格式化并打印执行日志
fn format_and_print_execution_log(log: &cli::ExecutionLog) {
    let level_symbol = match log.level.as_str() {
        "error" => "✗",
        "warning" => "⚠",
        "info" => "ℹ",
        _ => "·",
    };

    let timestamp = format_timestamp(log.timestamp as f64);
    println!("[{}] {} {}", timestamp, level_symbol, log.message);
}

/// 格式化时间戳为 HH:MM:SS.mmm
fn format_timestamp(timestamp: f64) -> String {
    use chrono::{DateTime, Local};
    let secs = (timestamp / 1000.0) as i64;
    let millis = (timestamp % 1000.0) as u32;

    if let Some(dt) = DateTime::from_timestamp(secs, millis * 1_000_000) {
        let local: DateTime<Local> = dt.into();
        format!("{}.{:03}", local.format("%H:%M:%S"), millis)
    } else {
        format!("{:.3}", timestamp / 1000.0)
    }
}

// ==================== 报告管理命令 ====================

use std::sync::Mutex;

pub struct ReportState {
    pub writer: Option<report::ReportWriter>,
}

#[tauri::command]
async fn start_report(
    test_case: String,
    state: State<'_, Mutex<ReportState>>,
) -> Result<String, String> {
    // 确保目录存在
    let reports_dir = report::ensure_reports_dir()?;

    // 异步清理旧报告（不阻塞）
    let reports_dir_clone = reports_dir.clone();
    tokio::spawn(async move {
        let _ = report::cleanup_old_reports(&reports_dir_clone, 10).await;
    });

    // 生成报告文件名
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let filename = format!("report_{}_{}.csv", test_case, timestamp);
    let filepath = reports_dir.join(&filename);

    // 创建写入器
    let writer = report::ReportWriter::new(filepath.clone())
        .map_err(|e| format!("Failed to create report writer: {}", e))?;
    let filepath_str = filepath.to_string_lossy().to_string();

    // 保存到状态
    let mut state = state.lock().unwrap();
    state.writer = Some(writer);

    Ok(filepath_str)
}

#[tauri::command]
fn write_report_record(
    record: report::TestRecord,
    state: State<'_, Mutex<ReportState>>,
) -> Result<(), String> {
    let state = state.lock().unwrap();

    if let Some(writer) = &state.writer {
        writer.write(record);
        Ok(())
    } else {
        Err("报告写入器未初始化".to_string())
    }
}

#[tauri::command]
fn close_report(state: State<'_, Mutex<ReportState>>) -> Result<(), String> {
    let mut state = state.lock().unwrap();
    state.writer = None; // 释放writer，触发通道关闭和最终刷新
    Ok(())
}

#[tauri::command]
async fn convert_csv_to_excel(
    csv_path: String,
    excel_path: String,
) -> Result<(), String> {
    use rust_xlsxwriter::*;

    // 读取CSV
    let mut reader = csv::Reader::from_path(&csv_path)
        .map_err(|e| format!("读取CSV失败: {}", e))?;

    let records: Vec<report::TestRecord> = reader
        .deserialize()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("解析CSV记录失败: {}", e))?;

    if records.is_empty() {
        return Err("CSV文件为空".to_string());
    }

    // 创建Excel
    let mut workbook = Workbook::new();

    // Sheet 1: 摘要
    let summary_sheet = workbook.add_worksheet();
    summary_sheet.set_name("Summary").map_err(|e| e.to_string())?;

    // 计算统计数据
    let total = records.len();
    let passed = records.iter().filter(|r| r.result == "PASS").count();
    let failed = total - passed;
    let test_case = records.first().map(|r| r.test_case.clone()).unwrap_or_default();
    let start_time = records.first().map(|r| r.timestamp.clone()).unwrap_or_default();
    let end_time = records.last().map(|r| r.timestamp.clone()).unwrap_or_default();
    let total_duration: u64 = records.iter().map(|r| r.duration).sum();
    let overall_result = if failed == 0 { "PASS" } else { "FAIL" };

    // 写入摘要
    summary_sheet.write_string(0, 0, "Test Case").map_err(|e| e.to_string())?;
    summary_sheet.write_string(0, 1, &test_case).map_err(|e| e.to_string())?;
    summary_sheet.write_string(1, 0, "Total Commands").map_err(|e| e.to_string())?;
    summary_sheet.write_number(1, 1, total as f64).map_err(|e| e.to_string())?;
    summary_sheet.write_string(2, 0, "Passed").map_err(|e| e.to_string())?;
    summary_sheet.write_number(2, 1, passed as f64).map_err(|e| e.to_string())?;
    summary_sheet.write_string(3, 0, "Failed").map_err(|e| e.to_string())?;
    summary_sheet.write_number(3, 1, failed as f64).map_err(|e| e.to_string())?;
    summary_sheet.write_string(4, 0, "Result").map_err(|e| e.to_string())?;
    summary_sheet.write_string(4, 1, overall_result).map_err(|e| e.to_string())?;
    summary_sheet.write_string(5, 0, "Start Time").map_err(|e| e.to_string())?;
    summary_sheet.write_string(5, 1, &start_time).map_err(|e| e.to_string())?;
    summary_sheet.write_string(6, 0, "End Time").map_err(|e| e.to_string())?;
    summary_sheet.write_string(6, 1, &end_time).map_err(|e| e.to_string())?;
    summary_sheet.write_string(7, 0, "Total Duration (ms)").map_err(|e| e.to_string())?;
    summary_sheet.write_number(7, 1, total_duration as f64).map_err(|e| e.to_string())?;

    // Sheet 2: 详细数据
    let detail_sheet = workbook.add_worksheet();
    detail_sheet.set_name("Details").map_err(|e| e.to_string())?;

    // 写入表头
    let headers = vec![
        "TestCase", "Iteration", "SequenceNumber", "CommandIndex", "CommandName", "Action",
        "SendData", "ReceivedData", "ExpectCondition", "Result", "ErrorMsg",
        "Timestamp", "Duration(ms)"
    ];
    for (col, header) in headers.iter().enumerate() {
        detail_sheet.write_string(0, col as u16, *header).map_err(|e| e.to_string())?;
    }

    // 写入数据
    for (row, record) in records.iter().enumerate() {
        let row = (row + 1) as u32;
        detail_sheet.write_string(row, 0, &record.test_case).map_err(|e| e.to_string())?;
        detail_sheet.write_number(row, 1, record.iteration as f64).map_err(|e| e.to_string())?;
        detail_sheet.write_string(row, 2, &record.sequence_number).map_err(|e| e.to_string())?;
        detail_sheet.write_number(row, 3, record.command_index as f64).map_err(|e| e.to_string())?;
        detail_sheet.write_string(row, 4, &record.command_name).map_err(|e| e.to_string())?;
        detail_sheet.write_string(row, 5, &record.action).map_err(|e| e.to_string())?;
        detail_sheet.write_string(row, 6, &record.send_data).map_err(|e| e.to_string())?;
        detail_sheet.write_string(row, 7, &record.received_data).map_err(|e| e.to_string())?;
        detail_sheet.write_string(row, 8, &record.expect_condition).map_err(|e| e.to_string())?;
        detail_sheet.write_string(row, 9, &record.result).map_err(|e| e.to_string())?;
        detail_sheet.write_string(row, 10, &record.error_msg).map_err(|e| e.to_string())?;
        detail_sheet.write_string(row, 11, &record.timestamp).map_err(|e| e.to_string())?;
        detail_sheet.write_number(row, 12, record.duration as f64).map_err(|e| e.to_string())?;
    }

    // 保存
    workbook
        .save(&excel_path)
        .map_err(|e| format!("保存Excel失败: {}", e))?;

    Ok(())
}

#[tauri::command]
fn get_attachments_dir() -> Result<String, String> {
    let dir = attachments::get_attachments_dir();
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
async fn cleanup_old_excel_reports(dir: String, keep_count: usize) -> Result<(), String> {
    use std::path::Path;
    use tokio::fs;

    let dir_path = Path::new(&dir);
    let mut entries = fs::read_dir(dir_path)
        .await
        .map_err(|e| format!("读取目录失败: {}", e))?;

    let mut files = Vec::new();

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| format!("读取目录项失败: {}", e))?
    {
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("xlsx") {
            if let Ok(metadata) = entry.metadata().await {
                if let Ok(modified) = metadata.modified() {
                    files.push((path, modified));
                }
            }
        }
    }

    // 按修改时间排序（最新的在前）
    files.sort_by(|a, b| b.1.cmp(&a.1));

    // 删除超出数量的文件
    for (path, _) in files.iter().skip(keep_count) {
        let _ = fs::remove_file(path).await;
    }

    Ok(())
}

