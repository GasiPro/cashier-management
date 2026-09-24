use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex as SyncMutex};

use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

use crate::config::connection_config::{
    WS_BIND_ADDRESS, WS_FALLBACK_ADDRESS, WS_PORT, WS_PROBE_ADDRESS,
};
use crate::config::rate_limit::{self, AttemptTracker};
use crate::domain::account;
use crate::domain::connection::{self, optional_username, peer_label};
use crate::models::account::{SessionRole, Sessions, UserType};
use crate::models::connection::{
    ClientMessage, ConnectedDevice, ConnectionEvent, ConnectionRequest, PendingConnection,
    ServerMessage,
};
use crate::models::order::Order;
use crate::services::account_service::{self, Accounts};
use crate::services::connection_service::{self, Blacklist, ConnectionHistory};
use crate::services::order_service::OrderService;
use crate::services::pricing_service::PricingStore;
use crate::services::setting_service::MaxConnectedDevices;

pub(crate) type Tx = mpsc::UnboundedSender<Message>;
pub(crate) type PeerMap = Arc<Mutex<HashMap<SocketAddr, PeerState>>>;
pub(crate) type AppHandleSlot = Arc<SyncMutex<Option<tauri::AppHandle>>>;

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

#[derive(Clone)]
pub(crate) struct WsContext {
    pub order_service: Arc<OrderService>,
    pub peers: PeerMap,
    pub max_connected_devices: MaxConnectedDevices,
    pub accounts: Accounts,
    pub app_handle: AppHandleSlot,
    pub blacklist: Blacklist,
    pub connection_history: ConnectionHistory,
    pub pricing: PricingStore,
    pub sessions: Sessions,
    pub connection_attempts: AttemptTracker,
}

static NEXT_PEER_ID: AtomicI64 = AtomicI64::new(1);

pub(crate) fn next_peer_id() -> i64 {
    NEXT_PEER_ID.fetch_add(1, Ordering::Relaxed)
}

pub(crate) fn start_server(ctx: WsContext) {
    tauri::async_runtime::spawn(async move {
        let listener = TcpListener::bind(WS_BIND_ADDRESS)
            .await
            .unwrap_or_else(|err| panic!("failed to bind WebSocket server to {WS_BIND_ADDRESS}: {err}"));
        while let Ok((stream, addr)) = listener.accept().await {
            let WsContext {
                order_service: order_service_inner,
                peers: peers_inner,
                max_connected_devices: max_connected_devices_inner,
                accounts: accounts_inner,
                app_handle: app_handle_inner,
                blacklist: blacklist_inner,
                connection_history: connection_history_inner,
                pricing: pricing_inner,
                sessions: sessions_inner,
                connection_attempts: connection_attempts_inner,
            } = ctx.clone();
            tauri::async_runtime::spawn(async move {
                let is_blacklisted = {
                    let guard = blacklist_inner.lock().unwrap();
                    connection::is_blacklisted(&guard, &addr.to_string())
                };
                if is_blacklisted {
                    return;
                }
                let ws_stream = match accept_async(stream).await {
                    Ok(s) => s,
                    Err(_) => return,
                };
                let (mut ws_sender, mut ws_receiver) = ws_stream.split();
                let (tx, mut rx) = mpsc::unbounded_channel();
                peers_inner.lock().await.insert(
                    addr,
                    PeerState {
                        id: next_peer_id(),
                        tx,
                        username: String::new(),
                        approved: false,
                        is_cashier: false,
                        is_admin: false,
                        requested_at: None,
                        connected_at: None,
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
                            Ok(ClientMessage::CashierRegister { username, token }) => {
                                let verified_username = account::consume_session(
                                    &sessions_inner,
                                    &token,
                                    SessionRole::Cashier,
                                );
                                let Some(verified_username) = verified_username else {
                                    send_to_addr(
                                        &peers_inner,
                                        addr,
                                        &ServerMessage::ProtocolError {
                                            data: "Jeton de session invalide ou expiré.".to_string(),
                                        },
                                    )
                                    .await;
                                    continue;
                                };
                                let _ = username;
                                {
                                    let mut guard = peers_inner.lock().await;
                                    if let Some(state) = guard.get_mut(&addr) {
                                        state.username = verified_username;
                                        state.approved = true;
                                        state.is_cashier = true;
                                        state.connected_at =
                                            Some(chrono::Local::now().to_rfc3339());
                                    }
                                }
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
                            Ok(ClientMessage::AdminRegister { username, token }) => {
                                let verified_username = account::consume_session(
                                    &sessions_inner,
                                    &token,
                                    SessionRole::Admin,
                                );
                                let Some(verified_username) = verified_username else {
                                    send_to_addr(
                                        &peers_inner,
                                        addr,
                                        &ServerMessage::ProtocolError {
                                            data: "Jeton de session invalide ou expiré.".to_string(),
                                        },
                                    )
                                    .await;
                                    continue;
                                };
                                let _ = username;
                                {
                                    let mut guard = peers_inner.lock().await;
                                    if let Some(state) = guard.get_mut(&addr) {
                                        state.username = verified_username;
                                        state.approved = true;
                                        state.is_admin = true;
                                        state.connected_at =
                                            Some(chrono::Local::now().to_rfc3339());
                                    }
                                }
                                send_to_addr(
                                    &peers_inner,
                                    addr,
                                    &ServerMessage::Orders { data: order_service_inner.get_orders() },
                                )
                                .await;
                            }
                            Ok(ClientMessage::CounterRegister { username, token }) => {
                                let verified_username = account::consume_session(
                                    &sessions_inner,
                                    &token,
                                    SessionRole::Counter,
                                );
                                let Some(verified_username) = verified_username else {
                                    send_to_addr(
                                        &peers_inner,
                                        addr,
                                        &ServerMessage::ProtocolError {
                                            data: "Jeton de session invalide ou expiré.".to_string(),
                                        },
                                    )
                                    .await;
                                    continue;
                                };
                                let _ = username;
                                let at_capacity = is_at_connected_devices_capacity(
                                    &peers_inner,
                                    &max_connected_devices_inner,
                                )
                                .await;
                                if at_capacity {
                                    send_to_addr(&peers_inner, addr, &ServerMessage::ConnectionRejected).await;
                                    continue;
                                }
                                let scoped = {
                                    let mut guard = peers_inner.lock().await;
                                    let Some(peer) = guard.get_mut(&addr) else {
                                        continue;
                                    };
                                    peer.username = verified_username.clone();
                                    peer.approved = true;
                                    peer.connected_at = Some(chrono::Local::now().to_rfc3339());
                                    scope_orders_for_peer(&order_service_inner.get_orders(), peer)
                                };
                                let app_handle = {
                                    let guard = app_handle_inner.lock().unwrap();
                                    guard.clone()
                                };
                                connection_service::record_connection_history(
                                    &connection_history_inner,
                                    app_handle.as_ref(),
                                    &addr.to_string(),
                                    &verified_username,
                                    ConnectionEvent::Approved,
                                );
                                send_to_addr(
                                    &peers_inner,
                                    addr,
                                    &ServerMessage::Orders { data: scoped },
                                )
                                .await;
                                let connected = get_connected_devices_list(&peers_inner).await;
                                notify_cashier(
                                    &peers_inner,
                                    &ServerMessage::ConnectedDevices { data: connected },
                                )
                                .await;
                            }
                            Ok(ClientMessage::RequestConnection { username, password }) => {
                                let attempt_key = addr.to_string();
                                if let Some(remaining) = rate_limit::seconds_until_unlocked(
                                    &connection_attempts_inner,
                                    &attempt_key,
                                ) {
                                    send_to_addr(
                                        &peers_inner,
                                        addr,
                                        &ServerMessage::ProtocolError {
                                            data: format!(
                                                "Trop de tentatives échouées. Réessayez dans {remaining} seconde(s)."
                                            ),
                                        },
                                    )
                                    .await;
                                    continue;
                                }
                                let credentials_ok = account_service::verify_active_credentials(
                                    &accounts_inner,
                                    &username,
                                    &password,
                                    UserType::Comptoir,
                                );
                                let username_blocked = {
                                    let guard = blacklist_inner.lock().unwrap();
                                    connection::is_username_blacklisted(&guard, &username)
                                };
                                if username_blocked {
                                    send_to_addr(&peers_inner, addr, &ServerMessage::ConnectionBlocked).await;
                                    continue;
                                }
                                if !credentials_ok {
                                    rate_limit::record_failure(&connection_attempts_inner, &attempt_key);
                                    send_to_addr(&peers_inner, addr, &ServerMessage::ConnectionRejected).await;
                                } else {
                                    let at_capacity = is_at_connected_devices_capacity(
                                        &peers_inner,
                                        &max_connected_devices_inner,
                                    )
                                    .await;
                                    if at_capacity {
                                        send_to_addr(&peers_inner, addr, &ServerMessage::ConnectionRejected).await;
                                    } else {
                                        rate_limit::record_success(&connection_attempts_inner, &attempt_key);
                                        {
                                            let mut guard = peers_inner.lock().await;
                                            if let Some(state) = guard.get_mut(&addr) {
                                                state.username = username.clone();
                                                state.requested_at =
                                                    Some(chrono::Local::now().to_rfc3339());
                                            }
                                        }
                                        let app_handle = {
                                            let guard = app_handle_inner.lock().unwrap();
                                            guard.clone()
                                        };
                                        connection_service::record_connection_history(
                                            &connection_history_inner,
                                            app_handle.as_ref(),
                                            &addr.to_string(),
                                            &username,
                                            ConnectionEvent::Requested,
                                        );
                                        let pending = get_pending_requests_list(&peers_inner).await;
                                        notify_cashier(
                                            &peers_inner,
                                            &ServerMessage::ConnectionRequests { data: pending },
                                        )
                                        .await;
                                    }
                                }
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
                                    match order_service_inner.create_order(&cart, &counter_username) {
                                        Ok(()) => {
                                            broadcast_orders_to_approved(
                                                &peers_inner,
                                                &order_service_inner.get_orders(),
                                            )
                                            .await;
                                        }
                                        Err(err) => {
                                            log::error!(
                                                "create_order failed for {counter_username} ({addr}): {err}"
                                            );
                                            send_to_addr(
                                                &peers_inner,
                                                addr,
                                                &ServerMessage::OrderError { data: err },
                                            )
                                            .await;
                                        }
                                    }
                                }
                            }
                            Ok(ClientMessage::UpdateOrder { id, quantity, unit_price }) => {
                                let is_approved = {
                                    let guard = peers_inner.lock().await;
                                    guard.get(&addr).map(|s| s.approved).unwrap_or(false)
                                };
                                if is_approved {
                                    match order_service_inner.update_order(id, quantity, unit_price) {
                                        Ok(()) => {
                                            broadcast_orders_to_approved(
                                                &peers_inner,
                                                &order_service_inner.get_orders(),
                                            )
                                            .await;
                                        }
                                        Err(err) => {
                                            log::error!("update_order {id} failed ({addr}): {err}");
                                            send_to_addr(
                                                &peers_inner,
                                                addr,
                                                &ServerMessage::OrderError { data: err },
                                            )
                                            .await;
                                        }
                                    }
                                }
                            }
                            Ok(ClientMessage::DeleteOrder { id }) => {
                                let is_approved = {
                                    let guard = peers_inner.lock().await;
                                    guard.get(&addr).map(|s| s.approved).unwrap_or(false)
                                };
                                if is_approved {
                                    match order_service_inner.delete_order(id) {
                                        Ok(()) => {
                                            broadcast_orders_to_approved(
                                                &peers_inner,
                                                &order_service_inner.get_orders(),
                                            )
                                            .await;
                                        }
                                        Err(err) => {
                                            log::error!("delete_order {id} failed ({addr}): {err}");
                                            send_to_addr(
                                                &peers_inner,
                                                addr,
                                                &ServerMessage::OrderError { data: err },
                                            )
                                            .await;
                                        }
                                    }
                                }
                            }
                            Ok(ClientMessage::DeleteOrderGroup { group_id }) => {
                                let is_approved = {
                                    let guard = peers_inner.lock().await;
                                    guard.get(&addr).map(|s| s.approved).unwrap_or(false)
                                };
                                if is_approved {
                                    match order_service_inner.delete_order_group(group_id) {
                                        Ok(()) => {
                                            broadcast_orders_to_approved(
                                                &peers_inner,
                                                &order_service_inner.get_orders(),
                                            )
                                            .await;
                                        }
                                        Err(err) => {
                                            log::error!(
                                                "delete_order_group {group_id} failed ({addr}): {err}"
                                            );
                                            send_to_addr(
                                                &peers_inner,
                                                addr,
                                                &ServerMessage::OrderError { data: err },
                                            )
                                            .await;
                                        }
                                    }
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
                            Ok(ClientMessage::RequestPricing) => {
                                let approved = {
                                    let guard = peers_inner.lock().await;
                                    guard.get(&addr).map(|s| s.approved).unwrap_or(false)
                                };
                                if approved {
                                    let items = pricing_inner.lock().unwrap().clone();
                                    send_to_addr(&peers_inner, addr, &ServerMessage::Pricing { data: items }).await;
                                }
                            }
                            Ok(ClientMessage::GetAccount) => {
                                let username = {
                                    let guard = peers_inner.lock().await;
                                    guard
                                        .get(&addr)
                                        .filter(|s| s.approved && !s.is_cashier)
                                        .map(|s| s.username.clone())
                                };
                                if let Some(username) = username {
                                    if let Some(view) = account_service::find_account_view(&accounts_inner, &username) {
                                        send_to_addr(&peers_inner, addr, &ServerMessage::Account { data: view }).await;
                                    }
                                }
                            }
                            Ok(ClientMessage::UpdateAccount { display_name, password }) => {
                                let username = {
                                    let guard = peers_inner.lock().await;
                                    guard
                                        .get(&addr)
                                        .filter(|s| s.approved && !s.is_cashier)
                                        .map(|s| s.username.clone())
                                };
                                let Some(username) = username else {
                                    continue;
                                };
                                let app_handle = {
                                    let guard = app_handle_inner.lock().unwrap();
                                    guard.clone()
                                };
                                let Some(app_handle) = app_handle else {
                                    send_to_addr(
                                        &peers_inner,
                                        addr,
                                        &ServerMessage::AccountUpdateError {
                                            data: "Serveur non prêt. Réessayez.".to_string(),
                                        },
                                    )
                                    .await;
                                    continue;
                                };
                                let result = account_service::update_account(
                                    &app_handle,
                                    &accounts_inner,
                                    username,
                                    Some(display_name),
                                    None,
                                    password,
                                )
                                .await;
                                match result {
                                    Ok(updated) => {
                                        send_to_addr(&peers_inner, addr, &ServerMessage::AccountUpdated { data: updated })
                                            .await;
                                    }
                                    Err(err) => {
                                        send_to_addr(&peers_inner, addr, &ServerMessage::AccountUpdateError { data: err })
                                            .await;
                                    }
                                }
                            }
                            Err(err) => {
                                log::warn!(
                                    "Message WebSocket invalide reçu de {addr}: {err} (contenu brut : {text})"
                                );
                                send_to_addr(
                                    &peers_inner,
                                    addr,
                                    &ServerMessage::ProtocolError {
                                        data: format!("Message invalide : {err}"),
                                    },
                                )
                                .await;
                            }
                        }
                    }
                }
                let (was_counter, disconnected_username) = {
                    let guard = peers_inner.lock().await;
                    match guard.get(&addr) {
                        Some(s) => (!s.is_cashier, s.username.clone()),
                        None => (false, String::new()),
                    }
                };
                peers_inner.lock().await.remove(&addr);
                ws_writer.abort();
                if was_counter {
                    let app_handle = {
                        let guard = app_handle_inner.lock().unwrap();
                        guard.clone()
                    };
                    connection_service::record_connection_history(
                        &connection_history_inner,
                        app_handle.as_ref(),
                        &addr.to_string(),
                        &disconnected_username,
                        ConnectionEvent::Disconnected,
                    );
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
}

pub(crate) fn start_clock(peers: PeerMap) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            let current_time = chrono::Local::now().format("%H:%M:%S").to_string();
            broadcast_to_approved(&peers, &ServerMessage::Time { data: current_time }).await;
        }
    });
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
        if s.connect(WS_PROBE_ADDRESS).is_ok() {
            if let Ok(addr) = s.local_addr() {
                return format!("{}:{}", addr.ip(), WS_PORT);
            }
        }
    }
    WS_FALLBACK_ADDRESS.to_string()
}
pub(crate) fn get_server_address() -> String {
    get_ws_address()
}
