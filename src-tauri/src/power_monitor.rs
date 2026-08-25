//! 电源事件监听模块
//!
//! Windows 电源监听功能暂时禁用（Windows API 兼容性问题）
//! 但保留了核心的资源清理机制（PortHandle Drop trait）

use tauri::AppHandle;

/// 启动电源监听器（当前为占位实现）
pub fn setup_power_monitor(_app_handle: AppHandle) {
    eprintln!("[PowerMonitor] Power monitoring is currently disabled");
    eprintln!("[PowerMonitor] Resource cleanup is handled by PortHandle Drop trait");
}
