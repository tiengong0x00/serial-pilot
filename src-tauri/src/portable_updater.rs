use serde::{Deserialize, Serialize};
use minisign_verify::{PublicKey, Signature};
use tauri::Emitter;

/// 从 tauri.conf.json 读取的公钥（编译时内嵌）
const UPDATER_PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDU5MjUxMTcxNTZBNTA1NEYKUldSUEJhVldjUkVsV2FLejMweGVLVGE2cXFCcStKa0VaMXFEd2VDMHZUb0xta2xJUVNLbDNSTGsK";

/// 最大重试次数
const MAX_RETRIES: u32 = 3;

/// 重试间隔（秒）
const RETRY_DELAY_SECS: u64 = 2;

#[derive(Debug, Deserialize)]
struct UpdateManifest {
    version: String,
    #[allow(dead_code)]
    notes: String,
    #[allow(dead_code)]
    pub_date: String,
    platforms: std::collections::HashMap<String, PlatformInfo>,
}

#[derive(Debug, Deserialize)]
struct PlatformInfo {
    url: String,
    signature: String,
}

#[derive(Debug, Serialize)]
pub struct UpdateInfo {
    pub available: bool,
    pub version: Option<String>,
}

/// 下载进度事件
#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
    pub percent: u32,
    pub speed: f64,  // KB/s
}

/// 验证文件签名（minisign）
fn verify_signature(file_data: &[u8], signature_base64: &str) -> Result<(), String> {
    // 解码公钥（Base64 编码的完整 minisign 格式：注释行 + 公钥行）
    let pubkey_bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        UPDATER_PUBKEY
    ).map_err(|e| format!("Failed to decode public key: {}", e))?;

    let pubkey_str = String::from_utf8_lossy(&pubkey_bytes);

    // 使用 decode() 而非 from_base64()，因为我们有完整的 minisign 格式（包含注释行）
    let pubkey = PublicKey::decode(&pubkey_str)
        .map_err(|e| format!("Invalid public key format: {}", e))?;

    // 解码签名：Tauri 的 .sig 文件是「完整 minisign 签名文本」再做一层 Base64 编码
    // 因此需先 Base64 解码得到原始签名文本，再交给 Signature::decode()
    let signature_bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        signature_base64
    ).map_err(|e| format!("Failed to decode signature base64: {}", e))?;

    let signature_str = String::from_utf8_lossy(&signature_bytes);
    let signature = Signature::decode(&signature_str)
        .map_err(|e| format!("Invalid signature format: {}", e))?;

    // 验证签名
    pubkey.verify(file_data, &signature, true)
        .map_err(|e| format!("Signature verification failed: {}", e))?;

    Ok(())
}

/// 检查绿色版更新
#[tauri::command]
pub async fn check_update_portable(_app: tauri::AppHandle) -> Result<UpdateInfo, String> {
    let endpoint = crate::dist_type::DistType::Portable.endpoint();

    // 1. 拉取更新清单（超时延长到 60 秒）
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let manifest: UpdateManifest = client
        .get(endpoint)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch update manifest: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse update manifest: {}", e))?;

    // 2. 对比版本号
    let current_version = env!("CARGO_PKG_VERSION");
    let remote_version = manifest.version.trim_start_matches('v');

    if remote_version == current_version {
        return Ok(UpdateInfo {
            available: false,
            version: None,
        });
    }

    Ok(UpdateInfo {
        available: true,
        version: Some(remote_version.to_string()),
    })
}

/// 下载并安装绿色版更新
#[tauri::command]
pub async fn install_update_portable(app: tauri::AppHandle) -> Result<(), String> {
    let endpoint = crate::dist_type::DistType::Portable.endpoint();

    // 1. 重新拉取清单（确保最新，超时延长到 60 秒）
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let manifest: UpdateManifest = client
        .get(endpoint)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch update manifest: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse update manifest: {}", e))?;

    let platform_info = manifest
        .platforms
        .get("windows-x86_64")
        .ok_or("Platform windows-x86_64 not found in manifest")?;

    // 2. 获取当前 exe 路径
    let exe = std::env::current_exe().map_err(|e| format!("Failed to get current exe: {}", e))?;
    let dir = exe
        .parent()
        .ok_or("Failed to get exe parent directory")?;
    let exe_name = exe
        .file_name()
        .ok_or("Failed to get exe filename")?
        .to_string_lossy();
    let exe_stem = exe
        .file_stem()
        .ok_or("Failed to get exe stem")?
        .to_string_lossy();

    // 3. 下载新版到 .new.exe（带重试和进度）
    let new_exe = dir.join(format!("{}.new.exe", exe_stem));

    let bytes = download_with_progress_and_retry(
        &app,
        &platform_info.url,
        MAX_RETRIES,
    ).await?;

    // 验证签名
    verify_signature(&bytes, &platform_info.signature)?;

    std::fs::write(&new_exe, bytes).map_err(|e| format!("Failed to write new exe: {}", e))?;

    // 4. 生成后台替换脚本
    let bat = dir.join("update_portable.bat");
    let bat_content = format!(
        r#"@echo off
chcp 65001 >nul
echo Updating Serial Pilot...
:WAIT_LOCK
timeout /t 1 /nobreak >nul
ren "{old}" "{old_stem}.old.exe" >nul 2>&1
if errorlevel 1 goto WAIT_LOCK
ren "{new}" "{name}" >nul 2>&1
if errorlevel 1 (
    echo Failed to rename new exe
    ren "{old_stem}.old.exe" "{name}" >nul 2>&1
    pause
    exit /b 1
)
start "" "{target}"
timeout /t 2 /nobreak >nul
del "{old_stem}.old.exe" >nul 2>&1
(goto) 2>nul & del "%~f0"
"#,
        old = exe.display(),
        old_stem = exe_stem,
        new = new_exe.display(),
        name = exe_name,
        target = exe.display()
    );

    std::fs::write(&bat, bat_content)
        .map_err(|e| format!("Failed to write update script: {}", e))?;

    // 5. 启动脚本，立即退出应用
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        std::process::Command::new("cmd")
            .args(&["/C", bat.to_str().unwrap()])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Failed to start update script: {}", e))?;
    }

    #[cfg(not(windows))]
    {
        std::process::Command::new("sh")
            .arg(bat.to_str().unwrap())
            .spawn()
            .map_err(|e| format!("Failed to start update script: {}", e))?;
    }

    // 立即退出应用
    app.exit(0);
    Ok(())
}

/// 带进度和重试的下载函数
async fn download_with_progress_and_retry(
    app: &tauri::AppHandle,
    url: &str,
    max_retries: u32,
) -> Result<Vec<u8>, String> {
    let mut last_error = String::new();

    for attempt in 0..max_retries {
        if attempt > 0 {
            eprintln!("Retry download attempt {}/{}", attempt + 1, max_retries);
            tokio::time::sleep(tokio::time::Duration::from_secs(RETRY_DELAY_SECS)).await;
        }

        match download_with_progress(app, url).await {
            Ok(bytes) => return Ok(bytes),
            Err(e) => {
                last_error = e;
                eprintln!("Download failed: {}", last_error);
            }
        }
    }

    Err(format!("Download failed after {} attempts: {}", max_retries, last_error))
}

/// 流式下载并实时发送进度事件
async fn download_with_progress(
    app: &tauri::AppHandle,
    url: &str,
) -> Result<Vec<u8>, String> {
    // 创建 HTTP 客户端，超时设为 600 秒（10 分钟）
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // 发起请求
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to start download: {}", e))?;

    // 获取文件总大小
    let total_size = response.content_length().unwrap_or(0);

    // 准备下载缓冲区
    let mut buffer = Vec::with_capacity(total_size as usize);
    let mut downloaded: u64 = 0;
    let start_time = std::time::Instant::now();
    let mut last_emit_time = start_time;

    // 分块读取响应体
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("Failed to read chunk: {}", e))?;

        buffer.extend_from_slice(&chunk);
        downloaded += chunk.len() as u64;

        // 计算进度和速度（节流：每 500ms 发送一次进度）
        let now = std::time::Instant::now();
        if now.duration_since(last_emit_time).as_millis() >= 500 || downloaded == total_size {
            let elapsed_secs = start_time.elapsed().as_secs_f64();
            let speed_kbps = if elapsed_secs > 0.0 {
                (downloaded as f64 / 1024.0) / elapsed_secs
            } else {
                0.0
            };

            let percent = if total_size > 0 {
                ((downloaded as f64 / total_size as f64) * 100.0) as u32
            } else {
                0
            };

            let progress = DownloadProgress {
                downloaded,
                total: total_size,
                percent,
                speed: speed_kbps,
            };

            // 发送进度事件（忽略错误）
            let _ = app.emit("download_progress", progress);
            last_emit_time = now;
        }
    }

    // 验证下载完整性
    if total_size > 0 && downloaded != total_size {
        return Err(format!(
            "Incomplete download: expected {} bytes, got {} bytes",
            total_size, downloaded
        ));
    }

    Ok(buffer)
}
