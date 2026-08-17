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
    Internal(String),
}

impl fmt::Display for SerialError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SerialError::OpenFailed(p) => write!(f, "Failed to open serial port: {p}"),
            SerialError::WriteFailed(p) => write!(f, "Failed to write to serial port: {p}"),
            SerialError::AlreadyConnected(p) => write!(f, "Serial port already connected: {p}"),
            SerialError::NotConnected(p) => write!(f, "Serial port not connected: {p}"),
            SerialError::ConfigInvalid(m) => write!(f, "Invalid serial port config: {m}"),
            SerialError::Internal(m) => write!(f, "Internal error: {m}"),
        }
    }
}

impl std::error::Error for SerialError {}
