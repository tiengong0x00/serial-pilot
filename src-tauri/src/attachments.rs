use crate::error::SerialError;
use sha2::{Sha256, Digest};
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::SystemTime;

/// 全局计数器（与时间戳拼接生成唯一 id）
static ATTACHMENT_COUNTER: AtomicU64 = AtomicU64::new(0);

/// 附件元信息
#[derive(Debug, Clone, serde::Serialize)]
pub struct AttachmentRef {
    pub id: String,
    pub name: String,
    pub size: u64,
}

/// 获取附件存储目录（exe 同级 data/attachments/）
pub fn get_attachments_dir() -> PathBuf {
    crate::data_layout::attachments_dir()
}

/// 获取测试用例目录（优先配置路径，未配置时用 exe 同级 testcases/）
fn get_testcases_dir() -> PathBuf {
    let cfg = crate::config::global().get();
    crate::config::resolve_config_path(&cfg.testcases_dir).unwrap_or_else(|| {
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."))
            .join("testcases")
    })
}

/// 生成唯一 id（时间戳纳秒 + 全局计数器，无哈希依赖）
fn generate_id() -> String {
    let ts = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let cnt = ATTACHMENT_COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("{:x}_{:x}", ts, cnt)
}

/// 计算数据的 SHA-256 哈希值
fn compute_hash(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

/// 计算文件的 SHA-256 哈希值
fn compute_file_hash(path: &PathBuf) -> Result<String, SerialError> {
    let data = fs::read(path)
        .map_err(|e| SerialError::Internal(format!("Failed to read file for hash: {}", e)))?;
    Ok(compute_hash(&data))
}

/// 同名但内容不同时的文件名：`<名>_<内容哈希前8位>.<扩展名>`，如 `A_3f9c2a1b.txt`。
/// 名字由内容决定，同一内容无论上传多少次都得到同一个文件名。
fn hashed_name(original_name: &str, hash: &str) -> String {
    let path = std::path::Path::new(original_name);
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(original_name);
    let short = &hash[..8.min(hash.len())];
    match path.extension().and_then(|s| s.to_str()) {
        Some(ext) => format!("{}_{}.{}", stem, short, ext),
        None => format!("{}_{}", stem, short),
    }
}

/// 保存附件到磁盘，返回引用
pub fn save_attachment(data: &[u8], name: &str) -> Result<AttachmentRef, SerialError> {
    let dir = get_attachments_dir();
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| SerialError::Internal(format!("Failed to create attachments dir: {}", e)))?;
    }

    let id = generate_id();
    let path = dir.join(&id);

    fs::write(&path, data)
        .map_err(|e| SerialError::Internal(format!("Failed to save attachment {}: {}", id, e)))?;

    Ok(AttachmentRef {
        id,
        name: name.to_string(),
        size: data.len() as u64,
    })
}

/// 保存用例附件到 testcases/<用例名>/ 下，返回引用（id 为相对路径 "用例名/文件名"）
/// 优化：同名文件先对比哈希，内容相同则直接复用，避免重复保存
pub fn save_testcase_attachment(
    data: &[u8],
    original_name: &str,
    testcase_name: &str,
) -> Result<AttachmentRef, SerialError> {
    // 安全检查：用例名和文件名都不能含路径穿越字符
    if testcase_name.contains("..")
        || testcase_name.contains('/')
        || testcase_name.contains('\\')
    {
        return Err(SerialError::Internal(format!(
            "Invalid testcase name: {}",
            testcase_name
        )));
    }
    if original_name.contains("..")
        || original_name.contains('/')
        || original_name.contains('\\')
    {
        return Err(SerialError::Internal(format!(
            "Invalid file name: {}",
            original_name
        )));
    }

    let dir = get_testcases_dir().join(testcase_name);
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| {
            SerialError::Internal(format!("Failed to create testcase dir: {}", e))
        })?;
    }

    let new_hash = compute_hash(data);

    // 1. 原名可用（不存在，或内容相同可复用）→ 用原名
    // 2. 原名被不同内容占用 → 用 `<名>_<哈希8位>.<扩展名>`，该名已存在且内容相同则复用
    let mut final_name = original_name.to_string();
    let original_path = dir.join(original_name);
    if original_path.exists() && compute_file_hash(&original_path)? != new_hash {
        final_name = hashed_name(original_name, &new_hash);
        let hashed_path = dir.join(&final_name);
        // 极少见：同名哈希文件已存在但内容不同（如被手动替换），改用完整哈希避免覆盖
        if hashed_path.exists() && compute_file_hash(&hashed_path)? != new_hash {
            let stem = std::path::Path::new(&final_name);
            let ext = stem.extension().and_then(|s| s.to_str());
            let base = std::path::Path::new(original_name)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(original_name);
            final_name = match ext {
                Some(ext) => format!("{}_{}.{}", base, new_hash, ext),
                None => format!("{}_{}", base, new_hash),
            };
        }
    }

    let final_path = dir.join(&final_name);
    if !final_path.exists() {
        fs::write(&final_path, data).map_err(|e| {
            SerialError::Internal(format!("Failed to save attachment {}: {}", final_name, e))
        })?;
    }

    // id 为相对路径：用例名/文件名（统一用正斜杠）
    let id = format!("{}/{}", testcase_name, final_name);

    Ok(AttachmentRef {
        id,
        name: final_name,
        size: data.len() as u64,
    })
}

/// 根据 id 解析附件的实际磁盘路径。
/// - id 含 '/' → 新格式，路径为 testcases/<id>
/// - id 不含 '/' → 旧格式，路径为 attachments/<id>
fn resolve_attachment_path(id: &str) -> PathBuf {
    if id.contains('/') {
        get_testcases_dir().join(id)
    } else {
        get_attachments_dir().join(id)
    }
}

/// 检查附件是否存在（兼容新旧格式）
pub fn attachment_exists(id: &str) -> bool {
    resolve_attachment_path(id).exists()
}

/// 删除附件（不存在时静默成功，兼容新旧格式）
pub fn delete_attachment(id: &str) -> Result<(), SerialError> {
    let path = resolve_attachment_path(id);
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|e| SerialError::Internal(format!("Failed to delete attachment {}: {}", id, e)))?;
    }
    Ok(())
}

/// 打开附件文件供流式读取（兼容新旧格式）
pub fn open_attachment(id: &str) -> Result<fs::File, SerialError> {
    let path = resolve_attachment_path(id);
    fs::File::open(&path)
        .map_err(|e| SerialError::NotFound(format!("Attachment {} not found: {}", id, e)))
}

/// 启动时 GC：扫描用例 JSON 收集引用，删除无引用附件（兼容新旧格式）
pub fn gc_orphaned_attachments(testcases_dir: &PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    let mut total_deleted = 0;

    // 1. 收集所有被引用的 id（新旧格式混合）
    let mut referenced_ids = std::collections::HashSet::new();
    if testcases_dir.exists() {
        for entry in fs::read_dir(testcases_dir)?.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if name.ends_with(".json") {
                    if let Ok(content) = fs::read_to_string(entry.path()) {
                        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) {
                            extract_ids(&value, &mut referenced_ids);
                        }
                    }
                }
            }
        }
    }

    // 2. 清理新格式附件：按用例目录扫描
    if testcases_dir.exists() {
        for entry in fs::read_dir(testcases_dir)?.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(case_name) = path.file_name().and_then(|n| n.to_str()) {
                    // 遍历该用例目录下的所有文件
                    if let Ok(files) = fs::read_dir(&path) {
                        for file_entry in files.flatten() {
                            if let Some(filename) = file_entry.file_name().to_str() {
                                let id = format!("{}/{}", case_name, filename);
                                if !referenced_ids.contains(&id) {
                                    if fs::remove_file(file_entry.path()).is_ok() {
                                        total_deleted += 1;
                                    }
                                }
                            }
                        }
                    }
                    // 如果目录为空，删除目录
                    if let Ok(mut dir_iter) = fs::read_dir(&path) {
                        if dir_iter.next().is_none() {
                            let _ = fs::remove_dir(&path);
                        }
                    }
                }
            }
        }
    }

    // 3. 清理旧格式附件：扫描 attachments/ 扁平目录
    let attachments_dir = get_attachments_dir();
    if attachments_dir.exists() {
        for entry in fs::read_dir(&attachments_dir)?.flatten() {
            if let Some(id) = entry.file_name().to_str() {
                if !referenced_ids.contains(id) {
                    if fs::remove_file(entry.path()).is_ok() {
                        total_deleted += 1;
                    }
                }
            }
        }
    }

    if total_deleted > 0 {
        eprintln!("[Attachments GC] Deleted {} orphaned file(s)", total_deleted);
    }

    Ok(())
}

/// 递归提取 JSON 中所有 "id" 字段的字符串值
fn extract_ids(value: &serde_json::Value, ids: &mut std::collections::HashSet<String>) {
    match value {
        serde_json::Value::Object(map) => {
            // 检查当前对象是否有 "id" 字段
            if let Some(serde_json::Value::String(id)) = map.get("id") {
                ids.insert(id.clone());
            }
            // 递归遍历所有子字段
            for v in map.values() {
                extract_ids(v, ids);
            }
        }
        serde_json::Value::Array(arr) => {
            // 递归遍历数组元素
            for v in arr {
                extract_ids(v, ids);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::hashed_name;

    #[test]
    fn hashed_name_keeps_extension_and_uses_8_chars() {
        assert_eq!(hashed_name("A.txt", "3f9c2a1b77aa"), "A_3f9c2a1b.txt");
        assert_eq!(hashed_name("fw.v1.bin", "0123456789"), "fw.v1_01234567.bin");
        assert_eq!(hashed_name("README", "abcdef0123"), "README_abcdef01");
    }
}
