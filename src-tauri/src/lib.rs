pub mod config;
pub mod domain;
pub mod service;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
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
}

// Messages a WS client can send to the server.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMessage {
    /// Cashier registers itself — sent once on WS open from the cashier device.
    CashierRegister { username: String },
    /// Counter requests to join — must be approved by cashier.
    RequestConnection { username: String },
    /// Counter sends its cart to the cashier for processing.
    CreateOrder { cart: Vec<CartItem> },
    /// Comptoir: edit a single pending order line (only while EN_ATTENTE).
    UpdateOrder { id: i64, quantity: u32, unit_price: u32 },
    /// Comptoir: delete a single pending order line (only while EN_ATTENTE).
    DeleteOrder { id: i64 },
    /// Comptoir: delete an entire pending order group (only while EN_ATTENTE).
    DeleteOrderGroup { group_id: i64 },
    /// Ask the server to re-push the current order snapshot (scoped to the caller).
    /// Used right after a WS handoff (e.g. login → counter) where the snapshot pushed
    /// at approval time can be missed because nobody was subscribed yet to receive it.
    RequestOrders,
}

#[derive(Debug, Serialize, Clone)]
struct ConnectionRequest {
    addr: String,
    username: String,
}

#[derive(Debug, Serialize, Clone)]
struct ConnectedDevice {
    addr: String,
    username: String,
}

// Messages the WS server pushes to peers.
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ServerMessage {
    /// Full order snapshot — pushed to all approved peers.
    Orders { data: Vec<Order> },
    /// Wall-clock tick — pushed to all approved peers.
    Time { data: String },
    /// Pending connection requests — pushed to the cashier only.
    ConnectionRequests { data: Vec<ConnectionRequest> },
    /// Currently approved counters — pushed to the cashier only.
    ConnectedDevices { data: Vec<ConnectedDevice> },
    /// Sent to a counter when the cashier approves its connection.
    ConnectionApproved,
    /// Sent to a counter when the cashier rejects its connection.
    ConnectionRejected,
    /// Sent to a counter when the cashier blocks (force-disconnects) its connection.
    ConnectionBlocked,
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

/// Push the order snapshot to every approved peer, scoped per recipient: the cashier
/// needs the full picture to run the register, but a comptoir must only ever see its
/// own orders — never another counter's history — so each counter peer gets the list
/// filtered to its own username before it leaves the server.
async fn broadcast_orders_to_approved(peers: &PeerMap, orders: &[Order]) {
    let guard = peers.lock().await;
    for (_, state) in guard.iter() {
        if !state.approved {
            continue;
        }
        let scoped: Vec<Order> = if state.is_cashier {
            orders.to_vec()
        } else {
            orders
                .iter()
                .filter(|o| o.counter_username == state.username)
                .cloned()
                .collect()
        };
        if let Ok(json) = serde_json::to_string(&ServerMessage::Orders { data: scoped }) {
            let _ = state.tx.send(Message::Text(json.into()));
        }
    }
}

/// Build the order snapshot for a single peer, scoped the same way as
/// `broadcast_orders_to_approved`: the cashier gets everything, a comptoir gets only
/// the orders it placed.
fn scope_orders_for_peer(orders: &[Order], peer: &PeerState) -> Vec<Order> {
    if peer.is_cashier {
        orders.to_vec()
    } else {
        orders
            .iter()
            .filter(|o| o.counter_username == peer.username)
            .cloned()
            .collect()
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

/// Returns the local LAN address for this machine (e.g. 192.168.1.5:8080).
///
/// Deliberately scheme-less: this is shown/copied straight into the UI, and
/// "ws://" is implementation detail that isn't meaningful to end users.
#[tauri::command]
fn get_ws_address() -> String {
    use std::net::UdpSocket;
    if let Ok(s) = UdpSocket::bind("0.0.0.0:0") {
        if s.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = s.local_addr() {
                return format!("{}:8080", addr.ip());
            }
        }
    }
    "127.0.0.1:8080".to_string()
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
async fn create_order(state: State<'_, AppState>, cart: Vec<CartItem>, counter_username: String) -> Result<(), String> {
    state.order_service.create_order(&cart, &counter_username);
    broadcast_orders_to_approved(&state.peers, &state.order_service.get_orders()).await;
    Ok(())
}

#[tauri::command]
async fn mark_group_as_paid(state: State<'_, AppState>, group_id: i64) -> Result<(), String> {
    state.order_service.mark_group_as_paid(group_id);
    broadcast_orders_to_approved(&state.peers, &state.order_service.get_orders()).await;
    Ok(())
}

/// Caisse: refuse an entire pending order group. Called from the cashier UI via invoke().
/// `raison` is an optional reason for the cancellation.
#[tauri::command]
async fn reject_group(state: State<'_, AppState>, group_id: i64, raison: Option<String>) -> Result<(), String> {
    state.order_service.reject_group(group_id, raison);
    broadcast_orders_to_approved(&state.peers, &state.order_service.get_orders()).await;
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
            let scoped = scope_orders_for_peer(&orders, peer);
            let _ = peer.tx.send(Message::Text(
                serde_json::to_string(&ServerMessage::ConnectionApproved)
                    .unwrap_or_default()
                    .into(),
            ));
            let _ = peer.tx.send(Message::Text(
                serde_json::to_string(&ServerMessage::Orders { data: scoped })
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

    let connected = get_connected_devices_list(&state.peers).await;
    notify_cashier(&state.peers, &ServerMessage::ConnectedDevices { data: connected }).await;
    Ok(())
}

/// Write raw bytes to an absolute path chosen by the user (e.g. via a save dialog).
/// Used by the cashier UI to export the daily report (rapport du jour) as an Excel file.
#[tauri::command]
fn save_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, data).map_err(|e| e.to_string())
}

// ── Application Entry Point ───────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let order_service = Arc::new(OrderService::new());
    let peers: PeerMap = Arc::new(Mutex::new(HashMap::new()));

    // ── WebSocket server (0.0.0.0 → reachable on LAN) ────────────────────────
    let ws_order_service = order_service.clone();
    let ws_peers = peers.clone();
    tauri::async_runtime::spawn(async move {
        let listener = TcpListener::bind("0.0.0.0:8080")
            .await
            .expect("failed to bind WebSocket server to 0.0.0.0:8080");

        while let Ok((stream, addr)) = listener.accept().await {
            let peers_inner = ws_peers.clone();
            let order_service_inner = ws_order_service.clone();

            tauri::async_runtime::spawn(async move {
                let ws_stream = match accept_async(stream).await {
                    Ok(s) => s,
                    Err(_) => return,
                };
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
                                let (is_approved, counter_username) = {
                                    let guard = peers_inner.lock().await;
                                    match guard.get(&addr) {
                                        Some(s) => (s.approved, s.username.clone()),
                                        None => (false, String::new()),
                                    }
                                };
                                if is_approved {
                                    order_service_inner.create_order(&cart, &counter_username);
                                    broadcast_orders_to_approved(
                                        &peers_inner,
                                        &order_service_inner.get_orders(),
                                    )
                                    .await;
                                }
                            }

                            Ok(ClientMessage::UpdateOrder { id, quantity, unit_price }) => {
                                let is_approved = {
                                    let guard = peers_inner.lock().await;
                                    guard.get(&addr).map(|s| s.approved).unwrap_or(false)
                                };
                                if is_approved {
                                    order_service_inner.update_order(id, quantity, unit_price);
                                    broadcast_orders_to_approved(
                                        &peers_inner,
                                        &order_service_inner.get_orders(),
                                    )
                                    .await;
                                }
                            }

                            Ok(ClientMessage::DeleteOrder { id }) => {
                                let is_approved = {
                                    let guard = peers_inner.lock().await;
                                    guard.get(&addr).map(|s| s.approved).unwrap_or(false)
                                };
                                if is_approved {
                                    order_service_inner.delete_order(id);
                                    broadcast_orders_to_approved(
                                        &peers_inner,
                                        &order_service_inner.get_orders(),
                                    )
                                    .await;
                                }
                            }

                            Ok(ClientMessage::DeleteOrderGroup { group_id }) => {
                                let is_approved = {
                                    let guard = peers_inner.lock().await;
                                    guard.get(&addr).map(|s| s.approved).unwrap_or(false)
                                };
                                if is_approved {
                                    order_service_inner.delete_order_group(group_id);
                                    broadcast_orders_to_approved(
                                        &peers_inner,
                                        &order_service_inner.get_orders(),
                                    )
                                    .await;
                                }
                            }

                            Ok(ClientMessage::RequestOrders) => {
                                let orders = order_service_inner.get_orders();
                                let guard = peers_inner.lock().await;
                                if let Some(peer) = guard.get(&addr) {
                                    if peer.approved {
                                        let scoped = scope_orders_for_peer(&orders, peer);
                                        let _ = peer.tx.send(Message::Text(
                                            serde_json::to_string(&ServerMessage::Orders { data: scoped })
                                                .unwrap_or_default()
                                                .into(),
                                        ));
                                    }
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
        .plugin(tauri_plugin_dialog::init())
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
        .manage(AppState { order_service, peers })
        .invoke_handler(tauri::generate_handler![
            get_ws_address,
            get_pricing_matrix,
            get_orders,
            get_pending_orders,
            get_paid_orders,
            create_order,
            mark_group_as_paid,
            reject_group,
            approve_connection,
            reject_connection,
            disconnect_device,
            save_binary_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
