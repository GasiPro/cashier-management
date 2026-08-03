pub mod config;
pub mod domain;
pub mod service;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use tauri::State;
use tokio::net::TcpListener;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

use config::pricing_matrix::PRICING_MATRIX;
use domain::order::price_calculator::{CartItem, ServiceItem, ServiceItemType as PriceCalculatorItemType};
use service::order_api_service::Order;
use service::order_service::OrderService;

type Tx = mpsc::UnboundedSender<Message>;

pub struct PeerState {
    tx: Tx,
    username: String,
    approved: bool,
    is_cashier: bool,
}

type PeerMap = Arc<Mutex<HashMap<SocketAddr, PeerState>>>;

pub struct AppState {
    pub order_service: Arc<OrderService>,
    pub peers: PeerMap,
    pub blocked_ips: Arc<Mutex<HashSet<IpAddr>>>, // NEW: IPs blocked by the cashier
}

// Messages a WS client can send to the server.
#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", content = "payload")]
enum ClientMessage {
  CashierRegister { username: String },
  RequestConnection { username: String },
  CreateOrder { cart: Vec<CartItem> },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ConnectionRequest {
    addr: String,
    username: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ConnectedDevice {
    addr: String,
    username: String,
}

// Messages the WS server pushes to peers.
#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", content = "payload")]
enum ServerMessage {
  ConnectionApproved,
  ConnectionRejected,
  ConnectionBlocked, // Sent when a blocked device (re)connects, or is blocked mid-session
  ConnectionRequests { data: Vec<ConnectionRequest> },
  ConnectedDevices { data: Vec<ConnectedDevice> },
  Orders { data: Vec<Order> },
  Time { data: String },
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async fn send_to_addr(peers: &PeerMap, addr: SocketAddr, msg: &ServerMessage) {
    if let Ok(json) = serde_json::to_string(msg) {
        let guard = peers.lock().await;
        if let Some(state) = guard.get(&addr) {
            let _ = state.tx.send(Message::Text(json.into()));
        }
    }
}

/// Broadcast to all approved peers (cashier + approved counters).
async fn broadcast_to_approved(peers: &PeerMap, msg: &ServerMessage) {
    let json = match serde_json::to_string(msg) {
        Ok(j) => j,
        Err(_) => return,
    };
    let guard = peers.lock().await;
    for (_, state) in guard.iter() {
        if state.approved {
            let _ = state.tx.send(Message::Text(json.clone().into()));
        }
    }
}

/// Push a message to the cashier peer only.
async fn notify_cashier(peers: &PeerMap, msg: &ServerMessage) {
    let json = match serde_json::to_string(msg) {
        Ok(j) => j,
        Err(_) => return,
    };
    let guard = peers.lock().await;
    for (_, state) in guard.iter() {
        if state.is_cashier {
            let _ = state.tx.send(Message::Text(json.clone().into()));
        }
    }
}

async fn get_pending_requests_list(peers: &PeerMap) -> Vec<ConnectionRequest> {
    let guard = peers.lock().await;
    guard
        .iter()
        .filter(|(_, s)| !s.approved && !s.is_cashier && !s.username.is_empty())
        .map(|(addr, s)| ConnectionRequest {
            addr: addr.to_string(),
            username: s.username.clone(),
        })
        .collect()
}

async fn get_connected_devices_list(peers: &PeerMap) -> Vec<ConnectedDevice> {
    let guard = peers.lock().await;
    guard
        .iter()
        .filter(|(_, s)| s.approved && !s.is_cashier)
        .map(|(addr, s)| ConnectedDevice {
            addr: addr.to_string(),
            username: s.username.clone(),
        })
        .collect()
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

/// Returns the local LAN WebSocket address for this machine (e.g. ws://192.168.1.5:8080).
#[tauri::command]
fn get_ws_address() -> String {
    use std::net::UdpSocket;
    if let Ok(s) = UdpSocket::bind("0.0.0.0:0") {
        if s.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = s.local_addr() {
                return format!("ws://{}:8080", addr.ip());
            }
        }
    }
    "ws://127.0.0.1:8080".to_string()
}

#[tauri::command]
fn get_pricing_matrix() -> Vec<ServiceItem> {
    PRICING_MATRIX
        .iter()
        .map(|item| ServiceItem {
            id: item.id.to_string(),
            item_type: match item.item_type {
                config::pricing_matrix::ServiceItemType::Service => PriceCalculatorItemType::Service,
                config::pricing_matrix::ServiceItemType::Product => PriceCalculatorItemType::Product,
            },
            category: item.category.to_string(),
            label: item.label.to_string(),
            price: item.price,
        })
        .collect()
}

#[tauri::command]
fn get_orders(state: State<'_, AppState>) -> Vec<Order> {
    state.order_service.get_orders()
}

#[tauri::command]
fn get_pending_orders(state: State<'_, AppState>) -> Vec<Order> {
    state.order_service.get_pending()
}

#[tauri::command]
fn get_paid_orders(state: State<'_, AppState>) -> Vec<Order> {
    state.order_service.get_paid()
}

#[tauri::command]
async fn create_order(state: State<'_, AppState>, cart: Vec<CartItem>) -> Result<(), String> {
    state.order_service.create_order(&cart);
    broadcast_to_approved(
        &state.peers,
        &ServerMessage::Orders { data: state.order_service.get_orders() },
    )
    .await;
    Ok(())
}

#[tauri::command]
async fn mark_group_as_paid(state: State<'_, AppState>, group_id: i64) -> Result<(), String> {
    state.order_service.mark_group_as_paid(group_id);
    broadcast_to_approved(
        &state.peers,
        &ServerMessage::Orders { data: state.order_service.get_orders() },
    )
    .await;
    Ok(())
}

/// Approve a pending counter connection. Called from the cashier UI via invoke().
#[tauri::command]
async fn approve_connection(state: State<'_, AppState>, addr: String) -> Result<(), String> {
    let socket_addr: SocketAddr = addr.parse().map_err(|e: std::net::AddrParseError| e.to_string())?;
    let orders = state.order_service.get_orders();

    {
        let mut guard = state.peers.lock().await;
        if let Some(peer) = guard.get_mut(&socket_addr) {
            peer.approved = true;
            let _ = peer.tx.send(Message::Text(
                serde_json::to_string(&ServerMessage::ConnectionApproved)
                    .unwrap_or_default()
                    .into(),
            ));
            let _ = peer.tx.send(Message::Text(
                serde_json::to_string(&ServerMessage::Orders { data: orders })
                    .unwrap_or_default()
                    .into(),
            ));
        }
    }

    let pending = get_pending_requests_list(&state.peers).await;
    let connected = get_connected_devices_list(&state.peers).await;
    notify_cashier(&state.peers, &ServerMessage::ConnectionRequests { data: pending }).await;
    notify_cashier(&state.peers, &ServerMessage::ConnectedDevices { data: connected }).await;
    Ok(())
}

/// Reject a pending counter connection. Called from the cashier UI via invoke().
#[tauri::command]
async fn reject_connection(state: State<'_, AppState>, addr: String) -> Result<(), String> {
    let socket_addr: SocketAddr = addr.parse().map_err(|e: std::net::AddrParseError| e.to_string())?;

    {
        let mut guard = state.peers.lock().await;
        if let Some(peer) = guard.get(&socket_addr) {
            let _ = peer.tx.send(Message::Text(
                serde_json::to_string(&ServerMessage::ConnectionRejected)
                    .unwrap_or_default()
                    .into(),
            ));
        }
        guard.remove(&socket_addr);
    }

    let pending = get_pending_requests_list(&state.peers).await;
    notify_cashier(&state.peers, &ServerMessage::ConnectionRequests { data: pending }).await;
    Ok(())
}

/// Force-disconnect an approved counter. Called from the cashier UI via invoke().
#[tauri::command]
async fn disconnect_device(state: State<'_, AppState>, addr: String) -> Result<(), String> {
    let socket_addr: SocketAddr = addr.parse().map_err(|e: std::net::AddrParseError| e.to_string())?;
    state.peers.lock().await.remove(&socket_addr);

    let connected = get_connected_devices_list(&state.peers).await;
    notify_cashier(&state.peers, &ServerMessage::ConnectedDevices { data: connected }).await;
    Ok(())
}

/// Block a device: reject it now (pending or connected) and remember its IP so
/// future connection attempts are refused before they even reach the pending list.
/// Called from the cashier UI via invoke().
#[tauri::command]
async fn block_device(state: State<'_, AppState>, addr: String) -> Result<(), String> {
    let socket_addr: SocketAddr = addr.parse().map_err(|e: std::net::AddrParseError| e.to_string())?;

    state.blocked_ips.lock().await.insert(socket_addr.ip());

    {
        let mut guard = state.peers.lock().await;
        if let Some(peer) = guard.get(&socket_addr) {
            let _ = peer.tx.send(Message::Text(
                serde_json::to_string(&ServerMessage::ConnectionBlocked)
                    .unwrap_or_default()
                    .into(),
            ));
        }
        guard.remove(&socket_addr);
    }

    let pending = get_pending_requests_list(&state.peers).await;
    let connected = get_connected_devices_list(&state.peers).await;
    notify_cashier(&state.peers, &ServerMessage::ConnectionRequests { data: pending }).await;
    notify_cashier(&state.peers, &ServerMessage::ConnectedDevices { data: connected }).await;
    Ok(())
}

/// Unblock a previously blocked IP address. Called from the cashier UI via invoke().
#[tauri::command]
async fn unblock_device(state: State<'_, AppState>, ip: String) -> Result<(), String> {
    let ip_addr: IpAddr = ip.parse().map_err(|e: std::net::AddrParseError| e.to_string())?;
    state.blocked_ips.lock().await.remove(&ip_addr);
    Ok(())
}

/// List currently blocked IP addresses. Called from the cashier UI via invoke().
#[tauri::command]
async fn get_blocked_devices(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let blocked = state.blocked_ips.lock().await;
    Ok(blocked.iter().map(|ip| ip.to_string()).collect())
}

// ── Application Entry Point ───────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let order_service = Arc::new(OrderService::new());
    let peers: PeerMap = Arc::new(Mutex::new(HashMap::new()));
    let blocked_ips: Arc<Mutex<HashSet<IpAddr>>> = Arc::new(Mutex::new(HashSet::new()));

    // ── WebSocket server (0.0.0.0 → reachable on LAN) ────────────────────────
    let ws_order_service = order_service.clone();
    let ws_peers = peers.clone();
    let ws_blocked_ips = blocked_ips.clone();
    tauri::async_runtime::spawn(async move {
        let listener = TcpListener::bind("0.0.0.0:8080")
            .await
            .expect("failed to bind WebSocket server to 0.0.0.0:8080");

        while let Ok((stream, addr)) = listener.accept().await {
            let peers_inner = ws_peers.clone();
            let order_service_inner = ws_order_service.clone();
            let blocked_ips_inner = ws_blocked_ips.clone();

            tauri::async_runtime::spawn(async move {
                let mut ws_stream = match accept_async(stream).await {
                    Ok(s) => s,
                    Err(_) => return,
                };

                // Refuse the handshake outright if this IP has been blocked by the cashier.
                if blocked_ips_inner.lock().await.contains(&addr.ip()) {
                    let _ = ws_stream
                        .send(Message::Text(
                            serde_json::to_string(&ServerMessage::ConnectionBlocked)
                                .unwrap_or_default()
                                .into(),
                        ))
                        .await;
                    let _ = ws_stream.close(None).await;
                    return;
                }

                let (mut ws_sender, mut ws_receiver) = ws_stream.split();
                let (tx, mut rx) = mpsc::unbounded_channel();

                // Register peer as unapproved with no username until it self-identifies.
                peers_inner.lock().await.insert(
                    addr,
                    PeerState {
                        tx,
                        username: String::new(),
                        approved: false,
                        is_cashier: false,
                    },
                );

                let ws_writer = tauri::async_runtime::spawn(async move {
                    while let Some(message) = rx.recv().await {
                        if ws_sender.send(message).await.is_err() {
                            break;
                        }
                    }
                });

                while let Some(Ok(message)) = ws_receiver.next().await {
                    if let Message::Text(text) = message {
                        match serde_json::from_str::<ClientMessage>(&text) {
                            Ok(ClientMessage::CashierRegister { username }) => {
                                {
                                    let mut guard = peers_inner.lock().await;
                                    if let Some(state) = guard.get_mut(&addr) {
                                        state.username = username;
                                        state.approved = true;
                                        state.is_cashier = true;
                                    }
                                }
                                // Push initial snapshot to cashier.
                                send_to_addr(
                                    &peers_inner,
                                    addr,
                                    &ServerMessage::Orders { data: order_service_inner.get_orders() },
                                )
                                .await;
                                let pending = get_pending_requests_list(&peers_inner).await;
                                let connected = get_connected_devices_list(&peers_inner).await;
                                send_to_addr(
                                    &peers_inner,
                                    addr,
                                    &ServerMessage::ConnectionRequests { data: pending },
                                )
                                .await;
                                send_to_addr(
                                    &peers_inner,
                                    addr,
                                    &ServerMessage::ConnectedDevices { data: connected },
                                )
                                .await;
                            }

                            Ok(ClientMessage::RequestConnection { username }) => {
                                {
                                    let mut guard = peers_inner.lock().await;
                                    if let Some(state) = guard.get_mut(&addr) {
                                        state.username = username;
                                    }
                                }
                                let pending = get_pending_requests_list(&peers_inner).await;
                                notify_cashier(
                                    &peers_inner,
                                    &ServerMessage::ConnectionRequests { data: pending },
                                )
                                .await;
                            }

                            Ok(ClientMessage::CreateOrder { cart }) => {
                                let is_approved = {
                                    let guard = peers_inner.lock().await;
                                    guard.get(&addr).map(|s| s.approved).unwrap_or(false)
                                };
                                if is_approved {
                                    order_service_inner.create_order(&cart);
                                    broadcast_to_approved(
                                        &peers_inner,
                                        &ServerMessage::Orders {
                                            data: order_service_inner.get_orders(),
                                        },
                                    )
                                    .await;
                                }
                            }

                            Err(_) => {}
                        }
                    }
                }

                // Peer disconnected — clean up and update cashier.
                let was_counter = {
                    let guard = peers_inner.lock().await;
                    guard.get(&addr).map(|s| !s.is_cashier).unwrap_or(false)
                };
                peers_inner.lock().await.remove(&addr);
                ws_writer.abort();

                if was_counter {
                    let pending = get_pending_requests_list(&peers_inner).await;
                    let connected = get_connected_devices_list(&peers_inner).await;
                    notify_cashier(
                        &peers_inner,
                        &ServerMessage::ConnectionRequests { data: pending },
                    )
                    .await;
                    notify_cashier(
                        &peers_inner,
                        &ServerMessage::ConnectedDevices { data: connected },
                    )
                    .await;
                }
            });
        }
    });

    // ── 1 Hz clock tick (broadcast only to approved peers) ───────────────────
    let time_peers = peers.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            let current_time = chrono::Local::now().format("%H:%M:%S").to_string();
            broadcast_to_approved(&time_peers, &ServerMessage::Time { data: current_time }).await;
        }
    });

    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .manage(AppState { order_service, peers, blocked_ips })
        .invoke_handler(tauri::generate_handler![
            get_ws_address,
            get_pricing_matrix,
            get_orders,
            get_pending_orders,
            get_paid_orders,
            create_order,
            mark_group_as_paid,
            approve_connection,
            reject_connection,
            disconnect_device,
            block_device,
            unblock_device,
            get_blocked_devices,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
