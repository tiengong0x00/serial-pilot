use serde::{Deserialize, Serialize};
use minisign_verify::{PublicKey, Signature};

/// 从 tauri.conf.json 读取的公钥（编译时内嵌）
const UPDATER_PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDU5MjUxMTcxNTZBNTA1NEYKUldSUEJhVldjUkVsV2FLejMweGVLVGE2cXFCcStKa0VaMXFEd2VDMHZUb0xta2xJUVNLbDNSTGsK";

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

    // 1. 拉取更新清单
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
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

    // 1. 重新拉取清单（确保最新）
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
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

    // 3. 下载新版到 .new.exe
    let new_exe = dir.join(format!("{}.new.exe", exe_stem));

    let bytes = client
        .get(&platform_info.url)
        .send()
        .await
        .map_err(|e| format!("Failed to download update: {}", e))?
        .bytes()
        .await
        .map_err(|e| format!("Failed to read update bytes: {}", e))?;

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
