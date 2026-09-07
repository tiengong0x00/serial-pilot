use csv::Writer;
use serde::{Deserialize, Serialize};
use std::io::BufWriter;
use std::path::PathBuf;
use tokio::sync::mpsc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestRecord {
    pub test_case: String,
    pub sequence_number: String,
    pub iteration: u32,
    pub command_name: String,
    pub action: String,
    pub send_data: String,
    pub received_data: String,
    pub expect_condition: String,
    pub result: String,
    pub error_msg: String,
    pub timestamp: String,
    pub duration: u64,
}

pub struct ReportWriter {
    tx: mpsc::UnboundedSender<TestRecord>,
    filepath: PathBuf,
}

impl Clone for ReportWriter {
    fn clone(&self) -> Self {
        Self {
            tx: self.tx.clone(),
            filepath: self.filepath.clone(),
        }
    }
}

impl ReportWriter {
    pub fn new(filepath: PathBuf) -> Result<Self, String> {
        let (tx, mut rx) = mpsc::unbounded_channel::<TestRecord>();
        let filepath_clone = filepath.clone();

        // 异步写入线程
        tokio::spawn(async move {
            let file = match std::fs::File::create(&filepath_clone) {
                Ok(f) => f,
                Err(e) => {
                    eprintln!("[Report] 创建报告文件失败: {}", e);
                    return;
                }
            };

            let buf_writer = BufWriter::with_capacity(8192, file);
            let mut writer = Writer::from_writer(buf_writer);

            let mut count = 0u64;

            while let Some(record) = rx.recv().await {
                if let Err(e) = writer.serialize(&record) {
                    eprintln!("[Report] 写入记录失败: {}", e);
                    continue;
                }

                count += 1;

                // 每 100 条记录刷新一次
                if count % 100 == 0 {
                    let _ = writer.flush();
                }
            }

            // 通道关闭时最终刷新
            let _ = writer.flush();
            println!("[Report] 报告写入完成，共{}条记录", count);
        });

        Ok(Self { tx, filepath })
    }

    // 同步版本，用于 CLI 模式（不依赖 Tokio 运行时）
    pub fn new_sync(filepath: PathBuf) -> Result<Self, String> {
        let (tx, mut rx) = mpsc::unbounded_channel::<TestRecord>();
        let filepath_clone = filepath.clone();

        // 使用标准线程而不是 tokio::spawn
        std::thread::spawn(move || {
            let file = match std::fs::File::create(&filepath_clone) {
                Ok(f) => f,
                Err(e) => {
                    eprintln!("[Report] 创建报告文件失败: {}", e);
                    return;
                }
            };

            let buf_writer = BufWriter::with_capacity(8192, file);
            let mut writer = Writer::from_writer(buf_writer);

            let mut count = 0u64;

            // 使用 blocking_recv 而不是异步 recv
            while let Some(record) = rx.blocking_recv() {
                if let Err(e) = writer.serialize(&record) {
                    eprintln!("[Report] 写入记录失败: {}", e);
                    continue;
                }

                count += 1;

                // 每 100 条记录刷新一次
                if count % 100 == 0 {
                    let _ = writer.flush();
                }
            }

            // 通道关闭时最终刷新
            let _ = writer.flush();
            println!("[Report] 报告写入完成，共{}条记录", count);
        });

        Ok(Self { tx, filepath })
    }

    pub fn write(&self, record: TestRecord) {
        let _ = self.tx.send(record);
    }

    pub fn get_filepath(&self) -> &PathBuf {
        &self.filepath
    }
}

/// 确保 reports 目录存在
pub fn ensure_reports_dir() -> Result<PathBuf, String> {
    use crate::attachments;

    let attachments_dir = attachments::get_attachments_dir();
    let reports_dir = attachments_dir.join("reports");

    std::fs::create_dir_all(&reports_dir)
        .map_err(|e| format!("创建 reports 目录失败: {}", e))?;

    Ok(reports_dir)
}

/// 清理旧的 CSV 报告，只保留最近的 N 个
pub async fn cleanup_old_reports(reports_dir: &PathBuf, max_keep: usize) -> Result<(), String> {
    use tokio::fs;

    let mut entries = fs::read_dir(reports_dir)
        .await
        .map_err(|e| format!("读取目录失败: {}", e))?;

    let mut files = Vec::new();

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| format!("读取目录项失败: {}", e))?
    {
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("csv") {
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
    for (path, _) in files.iter().skip(max_keep) {
        let _ = fs::remove_file(path).await;
    }

    Ok(())
}
