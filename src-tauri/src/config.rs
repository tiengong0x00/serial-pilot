use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock, RwLock};

/// 全局配置单例：路径函数无需层层传参即可读取
static GLOBAL_CONFIG: OnceLock<ConfigStore> = OnceLock::new();

/// 初始化全局配置（在 main 启动早期调用一次）
pub fn init_global() -> &'static ConfigStore {
    GLOBAL_CONFIG.get_or_init(ConfigStore::new)
}

/// 获取全局配置实例（未初始化时惰性初始化）
pub fn global() -> &'static ConfigStore {
    GLOBAL_CONFIG.get_or_init(ConfigStore::new)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    /// 测试用例目录（相对于 exe 或绝对路径），空字符串=默认 testcases/
    #[serde(default)]
    pub testcases_dir: String,

    /// 命令库目录（相对于 exe 或绝对路径），空字符串=默认 commands/
    #[serde(default)]
    pub commands_dir: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            testcases_dir: String::new(),
            commands_dir: String::new(),
        }
    }
}

/// 全局配置实例（启动时加载，运行时读多写少）
pub struct ConfigStore {
    config: Arc<RwLock<AppConfig>>,
    config_path: PathBuf,
}

impl ConfigStore {
    pub fn new() -> Self {
        let config_path = get_exe_dir().join("config.json");
        let config = Self::load_from_file(&config_path).unwrap_or_default();
        Self {
            config: Arc::new(RwLock::new(config)),
            config_path,
        }
    }

    fn load_from_file(path: &PathBuf) -> Option<AppConfig> {
        let content = fs::read_to_string(path).ok()?;
        serde_json::from_str(&content).ok()
    }

    pub fn get(&self) -> AppConfig {
        self.config.read().unwrap().clone()
    }

    pub fn update<F>(&self, f: F) -> Result<(), String>
    where
        F: FnOnce(&mut AppConfig),
    {
        let mut config = self.config.write().unwrap();
        f(&mut config);
        let json = serde_json::to_string_pretty(&*config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        fs::write(&self.config_path, json)
            .map_err(|e| format!("Failed to write config: {}", e))?;
        Ok(())
    }
}

fn get_exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// 解析配置中的路径：空字符串返回 None，相对路径相对于 exe，绝对路径直接返回
pub fn resolve_config_path(config_path: &str) -> Option<PathBuf> {
    if config_path.is_empty() {
        return None;
    }
    let path = PathBuf::from(config_path);
    if path.is_absolute() {
        Some(path)
    } else {
        Some(get_exe_dir().join(path))
    }
}
