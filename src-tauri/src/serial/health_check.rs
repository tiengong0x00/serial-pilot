use serialport::SerialPort;
use std::io::Read;
use std::time::Duration;

/// 驱动状态
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum DriverStatus {
    /// 真实硬件串口，所有接口正常
    RealHardware,
    /// 虚拟串口或简化驱动，部分接口不支持
    VirtualOrLimited,
    /// 驱动严重异常，无法正常工作
    Broken,
}

/// 接收通路状态
#[derive(Debug, Clone, PartialEq)]
pub enum ReceiveStatus {
    /// 接收通路正常
    Ok,
    /// 设备已断开
    Disconnected,
    /// 接收功能异常
    Broken(String),
}

/// 健康检测结果
#[derive(Debug)]
pub struct HealthCheckResult {
    pub driver_status: DriverStatus,
    pub receive_status: ReceiveStatus,
    pub warnings: Vec<String>,
}

/// 执行串口健康检测
///
/// Layer 1: 驱动接口完整性检测（5-20ms）
/// Layer 2: 接收通路功能检测（50ms）
///
/// 总耗时约 55-70ms
pub fn check_serial_health(port: &mut Box<dyn SerialPort>) -> HealthCheckResult {
    let mut warnings = Vec::new();

    // Layer 1: 驱动接口完整性
    let driver_status = check_driver_integrity(port, &mut warnings);

    // 驱动严重异常时，跳过接收测试
    if driver_status == DriverStatus::Broken {
        return HealthCheckResult {
            driver_status,
            receive_status: ReceiveStatus::Broken("驱动异常，跳过接收测试".to_string()),
            warnings,
        };
    }

    // Layer 2: 接收通路测试
    let receive_status = check_receive_path(port, &mut warnings);

    HealthCheckResult {
        driver_status,
        receive_status,
        warnings,
    }
}

/// Layer 1: 检测驱动接口完整性
fn check_driver_integrity(
    port: &mut Box<dyn SerialPort>,
    warnings: &mut Vec<String>,
) -> DriverStatus {
    let mut success_count = 0;
    let mut total_count = 0;

    // 测试 1: 设置 DTR
    total_count += 1;
    match port.write_data_terminal_ready(true) {
        Ok(_) => success_count += 1,
        Err(e) => warnings.push(format!("无法设置DTR: {}", e)),
    }

    // 测试 2: 设置 RTS
    total_count += 1;
    match port.write_request_to_send(true) {
        Ok(_) => success_count += 1,
        Err(e) => warnings.push(format!("无法设置RTS: {}", e)),
    }

    // 测试 3: 读取 CTS
    total_count += 1;
    match port.read_clear_to_send() {
        Ok(_) => success_count += 1,
        Err(e) => warnings.push(format!("无法读取CTS: {}", e)),
    }

    // 测试 4: 读取 DSR
    total_count += 1;
    match port.read_data_set_ready() {
        Ok(_) => success_count += 1,
        Err(e) => warnings.push(format!("无法读取DSR: {}", e)),
    }

    // 测试 5: 读取 DCD
    total_count += 1;
    match port.read_carrier_detect() {
        Ok(_) => success_count += 1,
        Err(e) => warnings.push(format!("无法读取DCD: {}", e)),
    }

    // 测试 6: 读取 RI
    total_count += 1;
    match port.read_ring_indicator() {
        Ok(_) => success_count += 1,
        Err(e) => warnings.push(format!("无法读取RI: {}", e)),
    }

    // 测试 7: 设置超时
    total_count += 1;
    let test_timeout = Duration::from_millis(100);
    match port.set_timeout(test_timeout) {
        Ok(_) => success_count += 1,
        Err(e) => warnings.push(format!("无法设置超时: {}", e)),
    }

    // 判断驱动状态
    match success_count {
        0 => {
            // 全部失败 → 驱动严重异常
            DriverStatus::Broken
        }
        n if n == total_count => {
            // 全部成功 → 真实硬件串口
            DriverStatus::RealHardware
        }
        _ => {
            // 部分失败 → 虚拟串口或简化驱动
            warnings.push("检测到虚拟串口或简化驱动，部分接口不支持".to_string());
            DriverStatus::VirtualOrLimited
        }
    }
}

/// Layer 2: 检测接收通路功能
fn check_receive_path(
    port: &mut Box<dyn SerialPort>,
    warnings: &mut Vec<String>,
) -> ReceiveStatus {
    // 保存原有超时设置
    let original_timeout = port.timeout();

    // 设置短超时用于测试（50ms）
    if let Err(e) = port.set_timeout(Duration::from_millis(50)) {
        warnings.push(format!("无法设置测试超时: {}", e));
        // 尝试恢复原超时
        let _ = port.set_timeout(original_timeout);
        return ReceiveStatus::Broken("无法配置接收测试".to_string());
    }

    // 尝试读取 1 字节
    let mut test_buf = [0u8; 1];
    let result = port.read(&mut test_buf);

    // 恢复原有超时设置
    if let Err(e) = port.set_timeout(original_timeout) {
        warnings.push(format!("无法恢复超时设置: {}", e));
    }

    // 分析读取结果
    match result {
        Ok(_) => {
            // 成功读到数据（罕见情况，恰好有数据到达）
            // 说明接收功能正常
            ReceiveStatus::Ok
        }
        Err(e) => {
            match e.kind() {
                std::io::ErrorKind::TimedOut => {
                    // 预期的超时错误 → 接收通路正常，只是当前无数据
                    ReceiveStatus::Ok
                }
                std::io::ErrorKind::BrokenPipe => {
                    // 设备已断开
                    ReceiveStatus::Disconnected
                }
                std::io::ErrorKind::NotConnected => {
                    // 设备未连接
                    ReceiveStatus::Disconnected
                }
                _ => {
                    // 其他错误 → 接收功能异常
                    ReceiveStatus::Broken(format!("接收测试失败: {}", e))
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_driver_status() {
        // 测试驱动状态枚举
        assert_eq!(DriverStatus::Broken, DriverStatus::Broken);
        assert_ne!(DriverStatus::Broken, DriverStatus::RealHardware);
    }

    #[test]
    fn test_receive_status() {
        // 测试接收状态枚举
        assert_eq!(ReceiveStatus::Ok, ReceiveStatus::Ok);
        assert_ne!(ReceiveStatus::Ok, ReceiveStatus::Disconnected);
    }
}
