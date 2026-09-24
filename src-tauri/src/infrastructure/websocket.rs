use std::net::SocketAddr;
use std::sync::atomic::{AtomicI64, Ordering};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use crate::app::state::{MaxConnectedDevices, PeerMap};
use crate::repositories::order_repository::Order;
use crate::{ConnectedDevice, ConnectionRequest, PendingConnection, ServerMessage};
pub(crate) type Tx = mpsc::UnboundedSender<Message>;
pub struct PeerState {
    pub(crate) id: i64,
    pub(crate) tx: Tx,
    pub(crate) username: String,
    pub(crate) approved: bool,
    pub(crate) is_cashier: bool,
    pub(crate) is_admin: bool,
    pub(crate) requested_at: Option<String>,
    pub(crate) connected_at: Option<String>,
}
static NEXT_PEER_ID: AtomicI64 = AtomicI64::new(1);
pub(crate) fn next_peer_id() -> i64 {
    NEXT_PEER_ID.fetch_add(1, Ordering::Relaxed)
}
pub(crate) fn optional_username(username: &str) -> Option<String> {
    let trimmed = username.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}
pub(crate) fn peer_label(username: &str, addr: &str) -> String {
    optional_username(username).unwrap_or_else(|| addr.to_string())
}
pub(crate) async fn send_to_addr(peers: &PeerMap, addr: SocketAddr, msg: &ServerMessage) {
    if let Ok(json) = serde_json::to_string(msg) {
        let guard = peers.lock().await;
        if let Some(state) = guard.get(&addr) {
            let _ = state.tx.send(Message::Text(json.into()));
        }
    }
}
pub(crate) async fn broadcast_to_approved(peers: &PeerMap, msg: &ServerMessage) {
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
pub(crate) async fn broadcast_orders_to_approved(peers: &PeerMap, orders: &[Order]) {
    let guard = peers.lock().await;
    for (_, state) in guard.iter() {
        if !state.approved {
            continue;
        }
        let scoped: Vec<Order> = if state.is_cashier || state.is_admin {
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
pub(crate) fn scope_orders_for_peer(orders: &[Order], peer: &PeerState) -> Vec<Order> {
    if peer.is_cashier || peer.is_admin {
        orders.to_vec()
    } else {
        orders
            .iter()
            .filter(|o| o.counter_username == peer.username)
            .cloned()
            .collect()
    }
}
pub(crate) async fn notify_cashier(peers: &PeerMap, msg: &ServerMessage) {
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
pub(crate) async fn get_pending_requests_list(peers: &PeerMap) -> Vec<ConnectionRequest> {
    let guard = peers.lock().await;
    let mut list: Vec<ConnectionRequest> = guard
        .iter()
        .filter(|(_, s)| !s.approved && !s.is_cashier && !s.username.is_empty())
        .map(|(addr, s)| PendingConnection {
            id: s.id,
            label: peer_label(&s.username, &addr.to_string()),
            username: optional_username(&s.username),
            ip_address: addr.ip().to_string(),
            port: addr.port(),
            requested_at: s
                .requested_at
                .clone()
                .unwrap_or_else(|| chrono::Local::now().to_rfc3339()),
        })
        .collect();
    list.sort_by_key(|entry| entry.id);
    list
}
pub(crate) async fn get_connected_devices_list(peers: &PeerMap) -> Vec<ConnectedDevice> {
    let guard = peers.lock().await;
    let mut list: Vec<ConnectedDevice> = guard
        .iter()
        .filter(|(_, s)| s.approved && !s.is_cashier)
        .map(|(addr, s)| ConnectedDevice {
            id: s.id,
            label: peer_label(&s.username, &addr.to_string()),
            username: optional_username(&s.username),
            ip_address: addr.ip().to_string(),
            port: addr.port(),
            connected_at: s
                .connected_at
                .clone()
                .unwrap_or_else(|| chrono::Local::now().to_rfc3339()),
        })
        .collect();
    list.sort_by_key(|entry| entry.id);
    list
}
pub(crate) async fn resolve_peer_addr(
    peers: &PeerMap,
    id: Option<i64>,
    addr: Option<String>,
) -> Result<SocketAddr, String> {
    if let Some(id) = id {
        let guard = peers.lock().await;
        return guard
            .iter()
            .find(|(_, s)| s.id == id)
            .map(|(addr, _)| *addr)
            .ok_or_else(|| "Appareil introuvable ou déjà déconnecté.".to_string());
    }
    let addr = addr.ok_or_else(|| "Identifiant d'appareil manquant.".to_string())?;
    addr.parse::<SocketAddr>()
        .map_err(|e: std::net::AddrParseError| e.to_string())
}
pub(crate) async fn is_at_connected_devices_capacity(
    peers: &PeerMap,
    max_connected_devices: &MaxConnectedDevices,
) -> bool {
    let max = *max_connected_devices.lock().unwrap();
    max > 0 && get_connected_devices_list(peers).await.len() >= max as usize
}
pub(crate) fn get_ws_address() -> String {
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
pub(crate) fn get_server_address() -> String {
    get_ws_address()
}
