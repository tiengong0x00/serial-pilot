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

/// 生成唯一 id（时间戳纳秒 + 全局计数器，无哈希依赖）
fn generate_id() -> String {
    let ts = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let cnt = ATTACHMENT_COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("{:x}_{:x}", ts, cnt)
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

/// 检查附件是否存在
pub fn attachment_exists(id: &str) -> bool {
    get_attachments_dir().join(id).exists()
}

/// 删除附件（不存在时静默成功）
pub fn delete_attachment(id: &str) -> Result<(), SerialError> {
    let path = get_attachments_dir().join(id);
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|e| SerialError::Internal(format!("Failed to delete attachment {}: {}", id, e)))?;
    }
    Ok(())
}

/// 打开附件文件供流式读取
pub fn open_attachment(id: &str) -> Result<fs::File, SerialError> {
    let path = get_attachments_dir().join(id);
    fs::File::open(&path)
        .map_err(|e| SerialError::NotFound(format!("Attachment {} not found: {}", id, e)))
}

/// 启动时 GC：扫描用例 JSON 收集引用，删除无引用附件
pub fn gc_orphaned_attachments(testcases_dir: &PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    let attachments_dir = get_attachments_dir();
    if !attachments_dir.exists() {
        return Ok(()); // 无附件目录，跳过
    }

    // 收集所有被引用的 id
    let mut referenced_ids = std::collections::HashSet::new();
    if testcases_dir.exists() {
        for entry in fs::read_dir(testcases_dir)?.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if name.ends_with(".json") {
                    if let Ok(content) = fs::read_to_string(entry.path()) {
                        // 简单字符串匹配 "\"id\":\"xxx\"" 模式（避免完整 JSON 解析）
                        for cap in content.match_indices("\"id\":\"") {
                            let start = cap.0 + 6; // 跳过 "id":"
                            if let Some(end) = content[start..].find('"') {
                                referenced_ids.insert(content[start..start + end].to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    // 遍历附件目录，删除无引用文件
    let mut deleted = 0;
    for entry in fs::read_dir(&attachments_dir)?.flatten() {
        if let Some(id) = entry.file_name().to_str() {
            if !referenced_ids.contains(id) {
                if fs::remove_file(entry.path()).is_ok() {
                    deleted += 1;
                }
            }
        }
    }

    if deleted > 0 {
        eprintln!("[Attachments GC] Deleted {} orphaned file(s)", deleted);
    }

    Ok(())
}
