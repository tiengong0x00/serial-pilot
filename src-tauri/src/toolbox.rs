use tauri::{AppHandle, Manager};

/// 打开工具箱窗口（如已打开则聚焦）
///
/// 注意：必须是 async 命令。Tauri v2 中同步命令(`fn`)运行在主线程上，
/// 而 `build()` 创建 webview 需要主线程事件循环处理消息，
/// 若在主线程同步 build 会死锁。async 命令运行在独立线程，可避免死锁。
#[tauri::command]
pub async fn open_toolbox_window(app: AppHandle) -> Result<(), String> {
    // 已存在则聚焦
    if let Some(window) = app.get_webview_window("toolbox") {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    tauri::WebviewWindowBuilder::new(
        &app,
        "toolbox",
        tauri::WebviewUrl::App("toolbox.html".into()),
    )
    .title("工具箱 - Serial Pilot")
    .inner_size(850.0, 720.0)
    .min_inner_size(700.0, 600.0)
    .resizable(true)
    .decorations(false) // 禁用系统原生标题栏，改用前端自定义 WindowControls
    .center()
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}
