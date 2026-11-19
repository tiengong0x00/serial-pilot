//! exe 目录布局
//!
//! 顶层只放用户维护的内容：testcases/、commands/、scripts/（以及 .portable 标记）。
//! 软件生成的内容统一放在 data/：config.json、attachments/、reports/、logs/、instance.id。
//!
//! 启动时 `migrate_legacy_layout` 把旧布局改名到新位置；改名失败时，
//! 各路径函数会继续返回旧位置（新位置不存在且旧位置存在），保证不丢数据、不报错。

use std::fs;
use std::path::{Path, PathBuf};

/// exe 所在目录
pub fn exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// 软件生成内容的根目录：<exe>/data
pub fn data_dir() -> PathBuf {
    exe_dir().join("data")
}

/// 新位置不存在而旧位置存在时，沿用旧位置（迁移失败的兜底）
fn pick(new: PathBuf, old: PathBuf) -> PathBuf {
    if !new.exists() && old.exists() {
        old
    } else {
        new
    }
}

/// 应用配置文件（用例目录、命令库目录）
pub fn config_file() -> PathBuf {
    pick(data_dir().join("config.json"), exe_dir().join("config.json"))
}

/// 用例附件目录
pub fn attachments_dir() -> PathBuf {
    pick(data_dir().join("attachments"), exe_dir().join("attachments"))
}

/// 测试报告目录（CSV 与 Excel）
pub fn reports_dir() -> PathBuf {
    pick(
        data_dir().join("reports"),
        exe_dir().join("attachments").join("reports"),
    )
}

/// 自动保存的终端日志目录
pub fn logs_dir() -> PathBuf {
    pick(data_dir().join("logs"), exe_dir().join("logs"))
}

/// 启动时调用一次：把旧布局迁移到 data/（同盘改名，速度快；失败只记录，不中断启动）
pub fn migrate_legacy_layout() {
    let exe = exe_dir();
    let data = data_dir();
    if let Err(e) = fs::create_dir_all(&data) {
        eprintln!("[DataLayout] 无法创建 {:?}，保持旧布局: {}", data, e);
        return;
    }

    move_if_absent(&exe.join("config.json"), &data.join("config.json"));
    // 报告先于附件迁移，避免随附件目录一起被搬走
    move_if_absent(&exe.join("attachments").join("reports"), &data.join("reports"));
    move_legacy_excel_reports(&exe.join("attachments"), &data.join("reports"));
    move_if_absent(&exe.join("attachments"), &data.join("attachments"));
    move_if_absent(&exe.join("logs"), &data.join("logs"));
}

/// 旧版 Excel 报告直接放在 attachments/ 根目录，逐个移入 reports/
fn move_legacy_excel_reports(old_attachments: &Path, reports: &Path) {
    let Ok(entries) = fs::read_dir(old_attachments) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_xlsx = path.is_file()
            && path
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| s.eq_ignore_ascii_case("xlsx"))
                .unwrap_or(false);
        if !is_xlsx {
            continue;
        }
        if fs::create_dir_all(reports).is_err() {
            return;
        }
        move_if_absent(&path, &reports.join(entry.file_name()));
    }
}

fn move_if_absent(old: &Path, new: &Path) {
    if !old.exists() || new.exists() {
        return;
    }
    match fs::rename(old, new) {
        Ok(()) => eprintln!("[DataLayout] 已迁移 {:?} -> {:?}", old, new),
        Err(e) => eprintln!("[DataLayout] 迁移 {:?} 失败，继续使用旧位置: {}", old, e),
    }
}
