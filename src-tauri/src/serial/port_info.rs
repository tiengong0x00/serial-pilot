use crate::error::SerialError;
use crate::state::PortInfo;

/// 获取系统可用串口列表
pub fn get_available_ports() -> Result<Vec<PortInfo>, SerialError> {
    let ports = serialport::available_ports()
        .map_err(|e| SerialError::Internal(format!("Failed to enumerate serial ports: {}", e)))?;

    let mut result = Vec::new();

    for port in ports {
        let port_name = port.port_name.clone();

        #[cfg(windows)]
        let friendly_name = get_friendly_name_windows(&port_name);

        #[cfg(not(windows))]
        let friendly_name = None;

        let (vid, pid) = match &port.port_type {
            serialport::SerialPortType::UsbPort(info) => (Some(info.vid), Some(info.pid)),
            _ => (None, None),
        };

        result.push(PortInfo {
            port_name,
            friendly_name,
            vid,
            pid,
        });
    }

    Ok(result)
}

#[cfg(windows)]
fn get_friendly_name_windows(port_name: &str) -> Option<String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

    // 1. 从 SERIALCOMM 获取设备路径
    let device_map = hklm
        .open_subkey(r"HARDWARE\DEVICEMAP\SERIALCOMM")
        .ok()?;

    let mut device_path: Option<String> = None;
    for (name, value) in device_map.enum_values().flatten() {
        let v = value.to_string();
        if v == port_name {
            device_path = Some(name);
            break;
        }
    }

    let device_path = device_path?;

    // 2. 从设备路径提取硬件ID（例如：\Device\VCP0 -> 查找对应的注册表项）
    // 设备路径格式示例：\Device\0000012a, \Device\VCP0
    // 需要在 Enum 子键下搜索匹配的 FriendlyName

    let enum_key = hklm
        .open_subkey(r"SYSTEM\CurrentControlSet\Enum")
        .ok()?;

    // 3. 动态枚举 Enum 下的所有总线类型（USB / FTDIBUS / com0com / PCI 等），
    //    不硬编码，保证任意设备驱动都能被覆盖
    let bus_types = enum_key.enum_keys().flatten().collect::<Vec<_>>();

    for bus_type in &bus_types {
        if let Ok(bus_key) = enum_key.open_subkey(bus_type) {
            // 遍历该总线类型下的所有设备
            if let Ok(device_ids) = bus_key.enum_keys().collect::<Result<Vec<_>, _>>() {
                for device_id in device_ids {
                    if let Ok(device_key) = bus_key.open_subkey(&device_id) {
                        // 遍历设备实例
                        if let Ok(instances) = device_key.enum_keys().collect::<Result<Vec<_>, _>>() {
                            for instance in instances {
                                if let Ok(instance_key) = device_key.open_subkey(&instance) {
                                    // 检查此实例是否对应我们要找的串口
                                    if let Ok(device_params) = instance_key.open_subkey("Device Parameters") {
                                        if let Ok(port_value) = device_params.get_value::<String, _>("PortName") {
                                            if port_value == port_name {
                                                // 找到了！读取 FriendlyName 并提取设备描述
                                                if let Ok(friendly) = instance_key.get_value::<String, _>("FriendlyName") {
                                                    // FriendlyName 格式：XR21V1412 USB UART ChA (COM13)
                                                    // 提取设备描述部分（去掉括号中的 COM 口号）
                                                    let device_desc = if let Some(idx) = friendly.rfind(" (COM") {
                                                        friendly[..idx].trim()
                                                    } else {
                                                        friendly.trim()
                                                    };
                                                    // 重新格式化为：COM13 (设备描述)
                                                    return Some(format!("{} ({})", port_name, device_desc));
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 4. 回退：如果找不到 FriendlyName，返回简化格式
    Some(format!("{} ({})", port_name, device_path.split('\\').last()?))
}
