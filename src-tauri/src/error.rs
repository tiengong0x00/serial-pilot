use serde::Serialize;
use std::fmt;

#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum SerialError {
    OpenFailed(String),
    WriteFailed(String),
    AlreadyConnected(String),
    NotConnected(String),
    ConfigInvalid(String),
    NotFound(String),
    Internal(String),
    DriverBroken(String),
    ReceivePathBroken(String),
}

impl fmt::Display for SerialError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SerialError::OpenFailed(p) => write!(f, "Failed to open serial port: {p}"),
            SerialError::WriteFailed(p) => write!(f, "Failed to write to serial port: {p}"),
            SerialError::AlreadyConnected(p) => write!(f, "Serial port already connected: {p}"),
            SerialError::NotConnected(p) => write!(f, "Serial port not connected: {p}"),
            SerialError::ConfigInvalid(m) => write!(f, "Invalid serial port config: {m}"),
            SerialError::NotFound(m) => write!(f, "Not found: {m}"),
            SerialError::Internal(m) => write!(f, "Internal error: {m}"),
            SerialError::DriverBroken(m) => write!(f, "串口驱动异常: {m}"),
            SerialError::ReceivePathBroken(m) => write!(f, "串口接收功能异常: {m}"),
        }
    }
}

impl std::error::Error for SerialError {}
