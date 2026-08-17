use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::tcp::OwnedWriteHalf;
use tokio::net::tcp::OwnedReadHalf;
use tokio::net::{TcpStream, UdpSocket};
use tokio::sync::{watch, Mutex as AsyncMutex};

type ConnectionId = String;

/// 网络连接类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NetProtocol {
    Tcp,
    Udp,
}

/// 连接状态
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NetStatus {
    Connected,
    Disconnected,
    Error,
}

/// 网络数据事件（推送到前端）
#[derive(Debug, Clone, Serialize)]
pub struct NetDataEvent {
    pub connection_id: String,
    pub data: Vec<u8>,
    pub timestamp: u64,
    /// UDP 专用：数据来源地址
    pub remote_addr: Option<String>,
}

/// 网络状态事件（推送到前端）
#[derive(Debug, Clone, Serialize)]
pub struct NetStatusEvent {
    pub connection_id: String,
    pub status: NetStatus,
    pub message: Option<String>,
    pub timestamp: u64,
}

/// 连接响应（TCP/UDP 通用，返回本地绑定地址）
#[derive(Debug, Clone, Serialize)]
pub struct ConnectResponse {
    pub local_ip: String,
    pub local_port: u16,
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// TCP 连接句柄
struct TcpConnection {
    writer: Arc<AsyncMutex<OwnedWriteHalf>>,
    cancel_tx: watch::Sender<bool>,
}

/// UDP 连接句柄
struct UdpConnection {
    socket: Arc<UdpSocket>,
    cancel_tx: watch::Sender<bool>,
}

enum Connection {
    Tcp(TcpConnection),
    Udp(UdpConnection),
}

/// 网络连接管理器
pub struct NetworkManager {
    connections: Arc<Mutex<HashMap<ConnectionId, Connection>>>,
}

impl NetworkManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// TCP 连接
    pub async fn tcp_connect(
        &self,
        connection_id: String,
        host: String,
        port: u16,
        app_handle: AppHandle,
    ) -> Result<ConnectResponse, String> {
        // 先清理同名旧连接（避免残留导致 "already exists"）
        self.cleanup(&connection_id);

        // 连接
        let stream = TcpStream::connect((host.as_str(), port))
            .await
            .map_err(|e| format!("TCP connect failed: {}", e))?;

        // 取本地绑定地址（系统自动分配的出站网卡 IP + 端口）
        let local_addr = stream
            .local_addr()
            .map_err(|e| format!("Failed to get local address: {}", e))?;

        // 拆分读写
        let (reader, writer) = stream.into_split();
        let (cancel_tx, cancel_rx) = watch::channel(false);
        let writer_arc = Arc::new(AsyncMutex::new(writer));

        // 存储连接
        {
            let mut conns = self.connections.lock().unwrap();
            conns.insert(
                connection_id.clone(),
                Connection::Tcp(TcpConnection {
                    writer: writer_arc.clone(),
                    cancel_tx,
                }),
            );
        }

        // 推送连接成功事件
        let _ = app_handle.emit(
            "net://status",
            NetStatusEvent {
                connection_id: connection_id.clone(),
                status: NetStatus::Connected,
                message: None,
                timestamp: now_millis(),
            },
        );

        // 启动接收循环
        let conn_id = connection_id.clone();
        let app = app_handle.clone();
        let conns_ref = self.connections.clone();
        tokio::spawn(async move {
            tcp_recv_loop(conn_id, reader, cancel_rx, app, conns_ref).await;
        });

        Ok(ConnectResponse {
            local_ip: local_addr.ip().to_string(),
            local_port: local_addr.port(),
        })
    }

    /// TCP 发送数据
    pub async fn tcp_send(&self, connection_id: &str, data: Vec<u8>) -> Result<usize, String> {
        let writer_arc = {
            let conns = self.connections.lock().unwrap();
            match conns.get(connection_id) {
                Some(Connection::Tcp(conn)) => conn.writer.clone(),
                Some(_) => return Err("Not a TCP connection".to_string()),
                None => return Err("Connection not found".to_string()),
            }
        };

        let mut writer = writer_arc.lock().await;
        writer
            .write_all(&data)
            .await
            .map_err(|e| format!("TCP send failed: {}", e))?;

        Ok(data.len())
    }

    /// UDP 连接（sscom 模式）
    ///
    /// 绑定本地端口（local_port=0 表示由系统分配），并 connect 到对端地址，
    /// 此后 send/recv 仅与该对端通信。返回实际的本地 IP 与端口供前端显示。
    pub async fn udp_connect(
        &self,
        connection_id: String,
        local_port: u16,
        target_host: String,
        target_port: u16,
        app_handle: AppHandle,
    ) -> Result<ConnectResponse, String> {
        // 先清理同名旧连接（避免残留导致 "already exists"）
        self.cleanup(&connection_id);

        // 绑定本地端口
        let socket = UdpSocket::bind(("0.0.0.0", local_port))
            .await
            .map_err(|e| format!("UDP bind failed: {}", e))?;

        // connect 到对端：固定默认收发对象，同时探测出站本地 IP
        socket
            .connect((target_host.as_str(), target_port))
            .await
            .map_err(|e| format!("UDP connect failed: {}", e))?;

        // 探测本地实际 IP（connect 后 local_addr 会给出出站网卡地址）
        let local_addr = socket
            .local_addr()
            .map_err(|e| format!("Failed to get local address: {}", e))?;

        let (cancel_tx, cancel_rx) = watch::channel(false);
        let socket_arc = Arc::new(socket);

        {
            let mut conns = self.connections.lock().unwrap();
            conns.insert(
                connection_id.clone(),
                Connection::Udp(UdpConnection {
                    socket: socket_arc.clone(),
                    cancel_tx,
                }),
            );
        }

        let _ = app_handle.emit(
            "net://status",
            NetStatusEvent {
                connection_id: connection_id.clone(),
                status: NetStatus::Connected,
                message: None,
                timestamp: now_millis(),
            },
        );

        // 启动接收循环
        let conn_id = connection_id.clone();
        let app = app_handle.clone();
        let conns_ref = self.connections.clone();
        tokio::spawn(async move {
            udp_recv_loop(conn_id, socket_arc, cancel_rx, app, conns_ref).await;
        });

        Ok(ConnectResponse {
            local_ip: local_addr.ip().to_string(),
            local_port: local_addr.port(),
        })
    }

    /// UDP 发送数据到已连接的对端
    pub async fn udp_send(&self, connection_id: &str, data: Vec<u8>) -> Result<usize, String> {
        let socket_arc = {
            let conns = self.connections.lock().unwrap();
            match conns.get(connection_id) {
                Some(Connection::Udp(conn)) => conn.socket.clone(),
                Some(_) => return Err("Not a UDP connection".to_string()),
                None => return Err("Connection not found".to_string()),
            }
        };

        let sent = socket_arc
            .send(&data)
            .await
            .map_err(|e| format!("UDP send failed: {}", e))?;

        Ok(sent)
    }

    /// 内部清理：移除同名连接并发取消信号（不返回错误）
    fn cleanup(&self, connection_id: &str) {
        let mut conns = self.connections.lock().unwrap();
        if let Some(conn) = conns.remove(connection_id) {
            match conn {
                Connection::Tcp(c) => {
                    let _ = c.cancel_tx.send(true);
                }
                Connection::Udp(c) => {
                    let _ = c.cancel_tx.send(true);
                }
            }
        }
    }

    /// 断开连接
    pub fn disconnect(&self, connection_id: &str) -> Result<(), String> {
        let mut conns = self.connections.lock().unwrap();
        match conns.remove(connection_id) {
            Some(Connection::Tcp(conn)) => {
                let _ = conn.cancel_tx.send(true);
                Ok(())
            }
            Some(Connection::Udp(conn)) => {
                let _ = conn.cancel_tx.send(true);
                Ok(())
            }
            None => Err("Connection not found".to_string()),
        }
    }
}

/// TCP 接收循环
async fn tcp_recv_loop(
    connection_id: String,
    mut reader: OwnedReadHalf,
    mut cancel_rx: watch::Receiver<bool>,
    app: AppHandle,
    conns: Arc<Mutex<HashMap<ConnectionId, Connection>>>,
) {
    let mut buf = vec![0u8; 4096];

    loop {
        tokio::select! {
            _ = cancel_rx.changed() => {
                break;
            }
            result = reader.read(&mut buf) => {
                match result {
                    Ok(0) => {
                        // 连接关闭
                        let _ = app.emit("net://status", NetStatusEvent {
                            connection_id: connection_id.clone(),
                            status: NetStatus::Disconnected,
                            message: Some("Connection closed by remote".to_string()),
                            timestamp: now_millis(),
                        });
                        break;
                    }
                    Ok(n) => {
                        let _ = app.emit("net://data", NetDataEvent {
                            connection_id: connection_id.clone(),
                            data: buf[..n].to_vec(),
                            timestamp: now_millis(),
                            remote_addr: None,
                        });
                    }
                    Err(e) => {
                        let _ = app.emit("net://status", NetStatusEvent {
                            connection_id: connection_id.clone(),
                            status: NetStatus::Error,
                            message: Some(format!("Read error: {}", e)),
                            timestamp: now_millis(),
                        });
                        break;
                    }
                }
            }
        }
    }

    // 清理连接
    conns.lock().unwrap().remove(&connection_id);
}

/// UDP 接收循环（connect 模式：对端固定）
async fn udp_recv_loop(
    connection_id: String,
    socket: Arc<UdpSocket>,
    mut cancel_rx: watch::Receiver<bool>,
    app: AppHandle,
    conns: Arc<Mutex<HashMap<ConnectionId, Connection>>>,
) {
    let mut buf = vec![0u8; 4096];

    loop {
        tokio::select! {
            _ = cancel_rx.changed() => {
                break;
            }
            result = socket.recv(&mut buf) => {
                match result {
                    Ok(n) => {
                        let _ = app.emit("net://data", NetDataEvent {
                            connection_id: connection_id.clone(),
                            data: buf[..n].to_vec(),
                            timestamp: now_millis(),
                            remote_addr: None,  // connect 模式对端已固定
                        });
                    }
                    Err(e) => {
                        let _ = app.emit("net://status", NetStatusEvent {
                            connection_id: connection_id.clone(),
                            status: NetStatus::Error,
                            message: Some(format!("UDP recv error: {}", e)),
                            timestamp: now_millis(),
                        });
                        break;
                    }
                }
            }
        }
    }

    conns.lock().unwrap().remove(&connection_id);
}
