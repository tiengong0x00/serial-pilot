use crate::error::SerialError;
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

/// 获取附件存储目录（exe 同级 attachments/）
pub fn get_attachments_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("attachments")
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

/// 解决文件名冲突：如果文件已存在，尝试添加 (1) ~ (99) 后缀
fn resolve_filename_conflict(dir: &PathBuf, original_name: &str) -> Result<String, SerialError> {
    let path = dir.join(original_name);
    if !path.exists() {
        return Ok(original_name.to_string());
    }

    // 分离文件名和扩展名
    let stem = std::path::Path::new(original_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(original_name);
    let ext = std::path::Path::new(original_name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("");

    // 尝试 (1) ~ (99)
    for i in 1..100 {
        let new_name = if ext.is_empty() {
            format!("{} ({})", stem, i)
        } else {
            format!("{} ({}).{}", stem, i, ext)
        };
        let new_path = dir.join(&new_name);
        if !new_path.exists() {
            return Ok(new_name);
        }
    }

    Err(SerialError::Internal(format!(
        "Failed to resolve filename conflict for '{}': too many duplicates",
        original_name
    )))
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

    // 处理文件名冲突
    let final_name = resolve_filename_conflict(&dir, original_name)?;
    let path = dir.join(&final_name);

    fs::write(&path, data).map_err(|e| {
        SerialError::Internal(format!("Failed to save attachment {}: {}", final_name, e))
    })?;

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
