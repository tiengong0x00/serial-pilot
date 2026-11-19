//! WebView 数据目录（localStorage 等）按 exe 实例隔离
//!
//! 绿色版：exe 旁边只放 `data/instance.id`（记录实例 ID 和 exe 所在目录），
//! WebView 数据放在 `%LOCALAPPDATA%\<identifier>\profiles\<ID>`，exe 目录保持干净。
//! - 目录未变：直接使用
//! - 目录变了且原目录已不存在（挪动）：沿用原 ID，配置跟着走
//! - 目录变了但原目录仍在（复制出的副本）：生成新 ID，并以原配置为初始值
//!
//! 安装版、或 exe 目录不可写、或任何异常：返回 None，沿用 Tauri 默认目录（与旧版行为一致）。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::dist_type::DistType;

static DATA_DIR: OnceLock<Option<PathBuf>> = OnceLock::new();

#[derive(Serialize, Deserialize)]
struct InstanceRecord {
    id: String,
    path: String,
}

/// 启动时调用一次。`default_dir` 为 Tauri 默认数据目录（app_local_data_dir）。
pub fn init(default_dir: Option<PathBuf>) -> Option<PathBuf> {
    DATA_DIR
        .get_or_init(|| default_dir.as_deref().and_then(resolve))
        .clone()
}

/// 获取已解析的数据目录（未调用 init 或回退时返回 None，即使用默认目录）
pub fn get() -> Option<PathBuf> {
    DATA_DIR.get().cloned().flatten()
}

fn resolve(default_dir: &Path) -> Option<PathBuf> {
    if DistType::detect() != DistType::Portable {
        return None;
    }
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let id_file = exe_dir.join("data").join("instance.id");
    let profiles = default_dir.join("profiles");
    let current = exe_dir.to_string_lossy().to_string();

    let record = fs::read_to_string(&id_file)
        .ok()
        .and_then(|s| serde_json::from_str::<InstanceRecord>(&s).ok())
        .filter(|r| is_valid_id(&r.id));

    let (id, seed_from) = match record {
        // 目录未变
        Some(r) if same_path(&r.path, &current) => (r.id, None),
        // 目录变了：原目录的 id 文件仍指向同一 ID → 副本；否则 → 挪动
        Some(r) => {
            let original_id_file = Path::new(&r.path).join("data").join("instance.id");
            let original_alive = fs::read_to_string(&original_id_file)
                .ok()
                .and_then(|s| serde_json::from_str::<InstanceRecord>(&s).ok())
                .map(|o| o.id == r.id)
                .unwrap_or(false);
            if original_alive {
                (new_id(&current), Some(profiles.join(&r.id)))
            } else {
                (r.id, None)
            }
        }
        // 首次运行：以旧版默认目录的数据为初始值
        None => (new_id(&current), Some(default_dir.to_path_buf())),
    };

    let profile = profiles.join(&id);
    if let Err(e) = fs::create_dir_all(&profile) {
        eprintln!("[WebviewData] 无法创建 {:?}，回退默认目录: {}", profile, e);
        return None;
    }
    if let Some(src_root) = seed_from {
        copy_local_storage(&src_root, &profile);
    }

    // 写回记录（exe 目录不可写时回退默认目录，避免每次启动都生成新 ID）
    let record = InstanceRecord { id, path: current };
    let json = serde_json::to_string_pretty(&record).ok()?;
    if let Err(e) = fs::create_dir_all(id_file.parent()?).and_then(|_| fs::write(&id_file, json)) {
        eprintln!("[WebviewData] 无法写入 {:?}，回退默认目录: {}", id_file, e);
        return None;
    }
    Some(profile)
}

fn is_valid_id(id: &str) -> bool {
    id.len() == 16 && id.chars().all(|c| c.is_ascii_hexdigit())
}

fn same_path(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.trim_end_matches(['\\', '/']).to_lowercase();
    norm(a) == norm(b)
}

/// 生成 16 位十六进制实例 ID（路径 + 时间 + 进程号，无需额外随机数依赖）
fn new_id(seed: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut hasher = Sha256::new();
    hasher.update(seed.as_bytes());
    hasher.update(nanos.to_le_bytes());
    hasher.update(std::process::id().to_le_bytes());
    hasher
        .finalize()
        .iter()
        .take(8)
        .map(|b| format!("{:02x}", b))
        .collect()
}

/// 复制 Local Storage 作为初始配置（目标已存在则跳过；失败则丢弃，使用默认值启动）
fn copy_local_storage(src_root: &Path, dst_root: &Path) {
    let rel = Path::new("EBWebView").join("Default").join("Local Storage");
    let src = src_root.join(&rel);
    let dst = dst_root.join(&rel);
    if !src.is_dir() || dst.exists() {
        return;
    }
    let tmp = dst_root.join("EBWebView").join("Default").join("Local Storage.migrating");
    let _ = fs::remove_dir_all(&tmp);
    match copy_dir(&src, &tmp).and_then(|_| fs::rename(&tmp, &dst)) {
        Ok(()) => eprintln!("[WebviewData] 已复制初始配置: {:?} -> {:?}", src, dst),
        Err(e) => {
            eprintln!("[WebviewData] 复制初始配置失败，使用默认配置: {}", e);
            let _ = fs::remove_dir_all(&tmp);
        }
    }
}

fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        // LevelDB 锁文件可能被运行中的实例占用，且会自动重建，跳过
        if name == "LOCK" {
            continue;
        }
        let from = entry.path();
        let to = dst.join(&name);
        if entry.file_type()?.is_dir() {
            copy_dir(&from, &to)?;
        } else {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}
