#[derive(Debug, Clone, Copy, PartialEq)]
pub enum DistType {
    Nsis,      // 安装版
    Portable,  // 绿色版
}

impl DistType {
    /// 检测当前运行的分发类型
    pub fn detect() -> Self {
        // 1. 检查同目录是否存在 .portable 标记文件
        if Self::has_portable_marker() {
            return DistType::Portable;
        }

        // 2. 检查注册表标记（更新后标记持久化）
        #[cfg(windows)]
        if Self::check_registry_marker() == Some(DistType::Portable) {
            // 恢复标记文件
            let _ = Self::create_portable_marker();
            return DistType::Portable;
        }

        // 3. 回退：检查 exe 路径特征
        if let Ok(exe) = std::env::current_exe() {
            let path_lower = exe.to_string_lossy().to_lowercase();
            if path_lower.contains("program files") || path_lower.contains("programdata") {
                return DistType::Nsis;
            }
        }

        // 默认假设为 NSIS 安装版
        DistType::Nsis
    }

    /// 获取对应的更新 endpoint
    pub fn endpoint(&self) -> &'static str {
        match self {
            DistType::Nsis => {
                "https://github.com/tiengong0x00/serial-pilot/releases/latest/download/latest-nsis.json"
            }
            DistType::Portable => {
                "https://github.com/tiengong0x00/serial-pilot/releases/latest/download/latest-portable.json"
            }
        }
    }

    /// 检查 .portable 标记文件是否存在
    fn has_portable_marker() -> bool {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                return dir.join(".portable").exists();
            }
        }
        false
    }

    /// 创建 .portable 标记文件
    fn create_portable_marker() -> std::io::Result<()> {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                std::fs::write(dir.join(".portable"), "")?;
            }
        }
        Ok(())
    }

    /// 持久化标记到注册表（Windows）
    #[cfg(windows)]
    pub fn persist_marker(&self) -> Result<(), String> {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let key = hkcu
            .create_subkey("Software\\SerialPilot")
            .map_err(|e| format!("Failed to create registry key: {}", e))?
            .0;

        let value = match self {
            DistType::Nsis => "nsis",
            DistType::Portable => "portable",
        };

        key.set_value("DistType", &value)
            .map_err(|e| format!("Failed to set registry value: {}", e))?;

        Ok(())
    }

    /// 从注册表读取标记（Windows）
    #[cfg(windows)]
    fn check_registry_marker() -> Option<DistType> {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let key = hkcu.open_subkey("Software\\SerialPilot").ok()?;
        let value: String = key.get_value("DistType").ok()?;

        match value.as_str() {
            "portable" => Some(DistType::Portable),
            "nsis" => Some(DistType::Nsis),
            _ => None,
        }
    }

    #[cfg(not(windows))]
    pub fn persist_marker(&self) -> Result<(), String> {
        Ok(())
    }
}
