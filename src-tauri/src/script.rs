use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;
use tauri::command;

#[derive(Serialize, Deserialize, Debug)]
pub struct ScriptExecutionResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
    pub error: Option<String>,
}

/// 获取 scripts 目录路径（可执行文件同级）
fn get_scripts_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("scripts")
}

/// 执行外部脚本
///
/// - `script_path`：脚本文件路径，仅用于确定工作目录（其所在目录）
/// - `command`：在该工作目录下用系统 shell 执行的完整命令行
#[command]
pub async fn execute_script(
    script_path: String,
    command: String,
    timeout_ms: u64,
) -> Result<ScriptExecutionResult, String> {
    // 解析脚本路径（相对路径基于 scripts 目录）
    let path = Path::new(&script_path);
    let resolved_path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        get_scripts_dir().join(path)
    };

    // 工作目录 = 脚本所在目录
    let work_dir = resolved_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));

    // 安全检查：工作目录必须存在
    if !work_dir.exists() {
        return Err(format!("工作目录不存在: {}", work_dir.display()));
    }

    // 限制超时上限为 300 秒
    let timeout_ms = timeout_ms.min(300_000);

    // 用系统 shell 执行完整命令（Windows: cmd /C，Unix: sh -c）
    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(&command);
        c
    } else {
        let mut c = Command::new("sh");
        c.arg("-c").arg(&command);
        c
    };
    cmd.current_dir(&work_dir);

    // 执行（带超时）
    let output = tokio::time::timeout(
        Duration::from_millis(timeout_ms),
        tokio::task::spawn_blocking(move || cmd.output()),
    )
    .await
    .map_err(|_| format!("命令执行超时 ({}ms)", timeout_ms))?
    .map_err(|e| format!("无法启动命令: {}", e))?
    .map_err(|e| format!("命令执行失败: {}", e))?;

    let exit_code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let success = exit_code == 0;

    Ok(ScriptExecutionResult {
        exit_code,
        stdout,
        stderr,
        success,
        error: if success {
            None
        } else {
            Some(format!("退出码: {}", exit_code))
        },
    })
}
