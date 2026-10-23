use std::collections::HashMap;
use std::net::{SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicI64, AtomicU16, Ordering};
use std::sync::{Arc, Mutex as SyncMutex};
use std::time::Duration;
use futures_util::future::{select, Either};
use futures_util::{SinkExt, StreamExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;
use crate::config::connection_config::{
    WS_BIND_HOST, WS_FALLBACK_HOST, WS_PORT, WS_PORT_ATTEMPTS, WS_PROBE_ADDRESS,
};
use crate::config::rate_limit::{self, AttemptTracker};
use crate::domain::account;
use crate::domain::connection::{self, optional_username, peer_label};
use crate::models::account::{SessionRole, Sessions, UserType};
use crate::models::connection::{
    ClientMessage, ConnectedDevice, ConnectionEvent, PendingConnection, ServerMessage,
};
use crate::models::order::{Order, OrderChange, OrderChangeKind};
use crate::services::account_service::{self, Accounts};
use crate::services::connection_service::{self, Blacklist, ConnectionHistory};
use crate::services::order_service::OrderService;
use crate::services::pricing_service::PricingStore;
use crate::services::setting_service::MaxConnectedDevices;
const INVALID_TOKEN: &str = "Jeton de session invalide ou expiré.";
const SERVER_NOT_READY: &str = "Serveur non prêt. Réessayez.";
pub(crate) type Tx = mpsc::UnboundedSender<Message>;
pub(crate) type PeerMap = Arc<Mutex<HashMap<SocketAddr, PeerState>>>;
pub(crate) type AppHandleSlot = Arc<SyncMutex<Option<tauri::AppHandle>>>;
static NEXT_PEER_ID: AtomicI64 = AtomicI64::new(1);
static ACTIVE_PORT: AtomicU16 = AtomicU16::new(WS_PORT);
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
impl PeerState {
    fn new(tx: Tx) -> Self {
        Self {
            id: NEXT_PEER_ID.fetch_add(1, Ordering::Relaxed),
            tx,
            username: String::new(),
            approved: false,
            is_cashier: false,
            is_admin: false,
            requested_at: None,
            connected_at: None,
        }
    }
    pub(crate) fn send_text(&self, json: String) {
        let _ = self.tx.send(Message::Text(json.into()));
    }
    pub(crate) fn send(&self, msg: &ServerMessage) {
        if let Ok(json) = serde_json::to_string(msg) {
            self.send_text(json);
        }
    }
    fn is_staff(&self) -> bool {
        self.is_cashier || self.is_admin
    }
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
fn bind_listener() -> Option<std::net::TcpListener> {
    for port in WS_PORT..WS_PORT.saturating_add(WS_PORT_ATTEMPTS) {
        match std::net::TcpListener::bind((WS_BIND_HOST, port)) {
            Ok(listener) => {
                if listener.set_nonblocking(true).is_err() {
                    continue;
                }
                ACTIVE_PORT.store(port, Ordering::Relaxed);
                if port != WS_PORT {
                    log::warn!("Port {WS_PORT} occupé, serveur WebSocket démarré sur le port {port}.");
                }
                return Some(listener);
            }
            Err(err) => log::warn!("Port {port} indisponible pour le serveur WebSocket : {err}"),
        }
    }
    None
}
pub(crate) fn start_server(ctx: WsContext) {
    let Some(std_listener) = bind_listener() else {
        log::error!("Impossible d'ouvrir le serveur WebSocket : aucun port libre à partir de {WS_PORT}.");
        return;
    };
    tauri::async_runtime::spawn(async move {
        let listener = match TcpListener::from_std(std_listener) {
            Ok(listener) => listener,
            Err(err) => {
                log::error!("Impossible de démarrer le serveur WebSocket : {err}");
                return;
            }
        };
        loop {
            match listener.accept().await {
                Ok((stream, addr)) => {
                    tauri::async_runtime::spawn(handle_connection(ctx.clone(), stream, addr));
                }
                Err(err) => {
                    log::warn!("Connexion entrante impossible : {err}");
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }
        }
    });
}
pub(crate) fn start_clock(peers: PeerMap) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            let current_time = chrono::Local::now().format("%H:%M:%S").to_string();
            broadcast_to_approved(&peers, &ServerMessage::Time { data: current_time }).await;
        }
    });
}
async fn handle_connection(ctx: WsContext, stream: TcpStream, addr: SocketAddr) {
    let blacklisted = {
        let guard = ctx.blacklist.lock().unwrap();
        connection::is_blacklisted(&guard, &addr.to_string())
    };
    if blacklisted {
        return;
    }
    let Ok(ws_stream) = accept_async(stream).await else {
        return;
    };
    let (mut ws_sender, mut ws_receiver) = ws_stream.split();
    let (tx, mut rx) = mpsc::unbounded_channel();
    ctx.peers.lock().await.insert(addr, PeerState::new(tx));
    let mut ws_writer = tauri::async_runtime::spawn(async move {
        while let Some(message) = rx.recv().await {
            if ws_sender.send(message).await.is_err() {
                return;
            }
        }
        let _ = ws_sender.close().await;
    });
    loop {
        match select(ws_receiver.next(), &mut ws_writer).await {
            Either::Left((Some(Ok(Message::Text(text))), _)) => {
                handle_text(&ctx, addr, &text).await;
            }
            Either::Left((Some(Ok(_)), _)) => {}
            _ => break,
        }
    }
    let departed = ctx.peers.lock().await.remove(&addr);
    ws_writer.abort();
    if let Some(peer) = departed.filter(|p| !p.is_staff() && !p.username.is_empty()) {
        record_history(&ctx, addr, &peer.username, ConnectionEvent::Disconnected);
        notify_pending_requests(&ctx.peers).await;
        notify_connected_devices(&ctx.peers).await;
    }
}
async fn handle_text(ctx: &WsContext, addr: SocketAddr, text: &str) {
    let message = match serde_json::from_str::<ClientMessage>(text) {
        Ok(message) => message,
        Err(err) => {
            log::warn!("Message WebSocket invalide reçu de {addr}: {err}");
            let reply = ServerMessage::ProtocolError {
                data: format!("Message invalide : {err}"),
            };
            send_to_addr(&ctx.peers, addr, &reply).await;
            return;
        }
    };
    match message {
        ClientMessage::CashierRegister { token, .. } => {
            register_staff(ctx, addr, &token, SessionRole::Cashier).await
        }
        ClientMessage::AdminRegister { token, .. } => {
            register_staff(ctx, addr, &token, SessionRole::Admin).await
        }
        ClientMessage::CounterRegister { token, .. } => register_counter(ctx, addr, &token).await,
        ClientMessage::RequestConnection { username, password } => {
            request_connection(ctx, addr, &username, &password).await
        }
        ClientMessage::CreateOrder { cart } => {
            let Some(caller) = approved_caller(&ctx.peers, addr).await else {
                return;
            };
            let result = ctx.order_service.create_order(&cart, &caller.username);
            finish_order_change(ctx, addr, "create_order", &caller, OrderChangeKind::Created, result).await;
        }
        ClientMessage::UpdateOrder { id, quantity, unit_price } => {
            let Some(caller) = approved_caller(&ctx.peers, addr).await else {
                return;
            };
            let result = ctx
                .order_service
                .update_order(id, quantity, unit_price, caller.owner());
            finish_order_change(ctx, addr, "update_order", &caller, OrderChangeKind::Updated, result).await;
        }
        ClientMessage::DeleteOrder { id } => {
            let Some(caller) = approved_caller(&ctx.peers, addr).await else {
                return;
            };
            let result = ctx.order_service.delete_order(id, caller.owner());
            finish_order_change(ctx, addr, "delete_order", &caller, OrderChangeKind::Deleted, result).await;
        }
        ClientMessage::DeleteOrderGroup { group_id } => {
            let Some(caller) = approved_caller(&ctx.peers, addr).await else {
                return;
            };
            let result = ctx.order_service.delete_order_group(group_id, caller.owner());
            finish_order_change(ctx, addr, "delete_order_group", &caller, OrderChangeKind::Deleted, result).await;
        }
        ClientMessage::RequestOrders => {
            let orders = ctx.order_service.get_orders();
            let guard = ctx.peers.lock().await;
            if let Some(peer) = guard.get(&addr).filter(|p| p.approved) {
                peer.send(&ServerMessage::Orders {
                    data: scope_orders_for_peer(&orders, peer),
                });
            }
        }
        ClientMessage::RequestPricing => {
            if approved_caller(&ctx.peers, addr).await.is_some() {
                let items = ctx.pricing.lock().unwrap().clone();
                send_to_addr(&ctx.peers, addr, &ServerMessage::Pricing { data: items }).await;
            }
        }
        ClientMessage::GetAccount => {
            let Some(username) = account_username(&ctx.peers, addr).await else {
                return;
            };
            if let Some(view) = account_service::find_account_view(&ctx.accounts, &username) {
                send_to_addr(&ctx.peers, addr, &ServerMessage::Account { data: view }).await;
            }
        }
        ClientMessage::UpdateAccount { display_name, password } => {
            update_own_account(ctx, addr, display_name, password).await
        }
    }
}
async fn register_staff(ctx: &WsContext, addr: SocketAddr, token: &str, role: SessionRole) {
    let Some(username) = consume_token(ctx, addr, token, role).await else {
        return;
    };
    {
        let mut guard = ctx.peers.lock().await;
        if let Some(peer) = guard.get_mut(&addr) {
            peer.username = username;
            peer.approved = true;
            peer.is_cashier = role == SessionRole::Cashier;
            peer.is_admin = role == SessionRole::Admin;
            peer.connected_at = Some(chrono::Local::now().to_rfc3339());
        }
    }
    let orders = ServerMessage::Orders {
        data: ctx.order_service.get_orders(),
    };
    send_to_addr(&ctx.peers, addr, &orders).await;
    if role == SessionRole::Cashier {
        let pending = ServerMessage::ConnectionRequests {
            data: get_pending_requests_list(&ctx.peers).await,
        };
        let connected = ServerMessage::ConnectedDevices {
            data: get_connected_devices_list(&ctx.peers).await,
        };
        send_to_addr(&ctx.peers, addr, &pending).await;
        send_to_addr(&ctx.peers, addr, &connected).await;
    }
}
async fn register_counter(ctx: &WsContext, addr: SocketAddr, token: &str) {
    let Some(username) = consume_token(ctx, addr, token, SessionRole::Counter).await else {
        return;
    };
    if is_at_connected_devices_capacity(&ctx.peers, &ctx.max_connected_devices).await {
        send_to_addr(&ctx.peers, addr, &ServerMessage::ConnectionRejected).await;
        return;
    }
    let scoped = {
        let mut guard = ctx.peers.lock().await;
        let Some(peer) = guard.get_mut(&addr) else {
            return;
        };
        peer.username = username.clone();
        peer.approved = true;
        peer.connected_at = Some(chrono::Local::now().to_rfc3339());
        scope_orders_for_peer(&ctx.order_service.get_orders(), peer)
    };
    record_history(ctx, addr, &username, ConnectionEvent::Approved);
    send_to_addr(&ctx.peers, addr, &ServerMessage::Orders { data: scoped }).await;
    notify_connected_devices(&ctx.peers).await;
}
async fn request_connection(ctx: &WsContext, addr: SocketAddr, username: &str, password: &str) {
    let can_request = ctx
        .peers
        .lock()
        .await
        .get(&addr)
        .is_some_and(|peer| !peer.approved);
    if !can_request {
        return;
    }
    let attempt_key = addr.ip().to_string();
    if let Some(remaining) =
        rate_limit::seconds_until_unlocked(&ctx.connection_attempts, &attempt_key)
    {
        let reply = ServerMessage::ProtocolError {
            data: format!("Trop de tentatives échouées. Réessayez dans {remaining} seconde(s)."),
        };
        send_to_addr(&ctx.peers, addr, &reply).await;
        return;
    }
    let username_blocked = {
        let guard = ctx.blacklist.lock().unwrap();
        connection::is_username_blacklisted(&guard, username)
    };
    if username_blocked {
        send_to_addr(&ctx.peers, addr, &ServerMessage::ConnectionBlocked).await;
        return;
    }
    let Some(account_username) = account_service::verify_active_credentials(
        &ctx.accounts,
        username,
        password,
        UserType::Comptoir,
    ) else {
        rate_limit::record_failure(&ctx.connection_attempts, &attempt_key);
        send_to_addr(&ctx.peers, addr, &ServerMessage::ConnectionRejected).await;
        return;
    };
    if is_at_connected_devices_capacity(&ctx.peers, &ctx.max_connected_devices).await {
        send_to_addr(&ctx.peers, addr, &ServerMessage::ConnectionRejected).await;
        return;
    }
    rate_limit::record_success(&ctx.connection_attempts, &attempt_key);
    {
        let mut guard = ctx.peers.lock().await;
        if let Some(peer) = guard.get_mut(&addr) {
            peer.username = account_username.clone();
            peer.requested_at = Some(chrono::Local::now().to_rfc3339());
        }
    }
    record_history(ctx, addr, &account_username, ConnectionEvent::Requested);
    send_to_addr(&ctx.peers, addr, &ServerMessage::ConnectionPending).await;
    notify_pending_requests(&ctx.peers).await;
}
async fn update_own_account(
    ctx: &WsContext,
    addr: SocketAddr,
    display_name: String,
    password: Option<String>,
) {
    let Some(username) = account_username(&ctx.peers, addr).await else {
        return;
    };
    let Some(app) = app_handle(ctx) else {
        let reply = ServerMessage::AccountUpdateError {
            data: SERVER_NOT_READY.to_string(),
        };
        send_to_addr(&ctx.peers, addr, &reply).await;
        return;
    };
    let result = account_service::update_account(
        &app,
        &ctx.accounts,
        username,
        Some(display_name),
        None,
        password,
    )
    .await;
    let reply = match result {
        Ok(updated) => ServerMessage::AccountUpdated { data: updated },
        Err(err) => ServerMessage::AccountUpdateError { data: err },
    };
    send_to_addr(&ctx.peers, addr, &reply).await;
}
async fn consume_token(
    ctx: &WsContext,
    addr: SocketAddr,
    token: &str,
    role: SessionRole,
) -> Option<String> {
    let username = account::consume_session(&ctx.sessions, token, role);
    if username.is_none() {
        let reply = ServerMessage::ProtocolError {
            data: INVALID_TOKEN.to_string(),
        };
        send_to_addr(&ctx.peers, addr, &reply).await;
    }
    username
}
async fn finish_order_change(
    ctx: &WsContext,
    addr: SocketAddr,
    action: &str,
    caller: &Caller,
    kind: OrderChangeKind,
    result: Result<i64, String>,
) {
    match result {
        Ok(group_id) => {
            broadcast_orders_to_approved(&ctx.peers, &ctx.order_service.get_orders()).await;
            if !caller.is_staff {
                let change = OrderChange {
                    kind,
                    group_id,
                    counter_username: caller.username.clone(),
                };
                notify_cashier(&ctx.peers, &ServerMessage::OrderNotification { data: change }).await;
            }
        }
        Err(err) => {
            log::error!("{action} failed ({addr}): {err}");
            send_to_addr(&ctx.peers, addr, &ServerMessage::OrderError { data: err }).await;
        }
    }
}
struct Caller {
    username: String,
    is_staff: bool,
}
impl Caller {
    fn owner(&self) -> Option<&str> {
        (!self.is_staff).then_some(self.username.as_str())
    }
}
async fn approved_caller(peers: &PeerMap, addr: SocketAddr) -> Option<Caller> {
    let guard = peers.lock().await;
    guard.get(&addr).filter(|p| p.approved).map(|p| Caller {
        username: p.username.clone(),
        is_staff: p.is_staff(),
    })
}
async fn account_username(peers: &PeerMap, addr: SocketAddr) -> Option<String> {
    let guard = peers.lock().await;
    guard
        .get(&addr)
        .filter(|p| p.approved && !p.is_cashier)
        .map(|p| p.username.clone())
}
fn app_handle(ctx: &WsContext) -> Option<tauri::AppHandle> {
    ctx.app_handle.lock().unwrap().clone()
}
fn record_history(ctx: &WsContext, addr: SocketAddr, username: &str, event: ConnectionEvent) {
    let app = app_handle(ctx);
    connection_service::record_connection_history(
        &ctx.connection_history,
        app.as_ref(),
        &addr.to_string(),
        username,
        event,
    );
}
pub(crate) async fn send_to_addr(peers: &PeerMap, addr: SocketAddr, msg: &ServerMessage) {
    if let Some(peer) = peers.lock().await.get(&addr) {
        peer.send(msg);
    }
}
pub(crate) async fn broadcast_to_approved(peers: &PeerMap, msg: &ServerMessage) {
    let Ok(json) = serde_json::to_string(msg) else {
        return;
    };
    let guard = peers.lock().await;
    for peer in guard.values().filter(|p| p.approved) {
        peer.send_text(json.clone());
    }
}
pub(crate) async fn broadcast_orders_to_approved(peers: &PeerMap, orders: &[Order]) {
    let guard = peers.lock().await;
    for peer in guard.values().filter(|p| p.approved) {
        peer.send(&ServerMessage::Orders {
            data: scope_orders_for_peer(orders, peer),
        });
    }
}
pub(crate) fn scope_orders_for_peer(orders: &[Order], peer: &PeerState) -> Vec<Order> {
    if peer.is_staff() {
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
    let Ok(json) = serde_json::to_string(msg) else {
        return;
    };
    let guard = peers.lock().await;
    for peer in guard.values().filter(|p| p.is_cashier) {
        peer.send_text(json.clone());
    }
}
pub(crate) async fn notify_pending_requests(peers: &PeerMap) {
    let pending = get_pending_requests_list(peers).await;
    notify_cashier(peers, &ServerMessage::ConnectionRequests { data: pending }).await;
}
pub(crate) async fn notify_connected_devices(peers: &PeerMap) {
    let connected = get_connected_devices_list(peers).await;
    notify_cashier(peers, &ServerMessage::ConnectedDevices { data: connected }).await;
}
pub(crate) async fn remove_peer(peers: &PeerMap, addr: SocketAddr, farewell: &ServerMessage) -> String {
    match peers.lock().await.remove(&addr) {
        Some(peer) => {
            peer.send(farewell);
            peer.username
        }
        None => String::new(),
    }
}
pub(crate) async fn get_pending_requests_list(peers: &PeerMap) -> Vec<PendingConnection> {
    let guard = peers.lock().await;
    let mut list: Vec<PendingConnection> = guard
        .iter()
        .filter(|(_, s)| !s.approved && !s.username.is_empty())
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
        .filter(|(_, s)| s.approved && !s.is_staff())
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
    let guard = peers.lock().await;
    let found = match (id, addr) {
        (Some(id), _) => guard.iter().find(|(_, s)| s.id == id).map(|(addr, _)| *addr),
        (None, Some(addr)) => {
            let parsed = addr.parse::<SocketAddr>().map_err(|e| e.to_string())?;
            guard.contains_key(&parsed).then_some(parsed)
        }
        (None, None) => return Err("Identifiant d'appareil manquant.".to_string()),
    };
    found.ok_or_else(|| "Appareil introuvable ou déjà déconnecté.".to_string())
}
pub(crate) async fn is_at_connected_devices_capacity(
    peers: &PeerMap,
    max_connected_devices: &MaxConnectedDevices,
) -> bool {
    let max = *max_connected_devices.lock().unwrap();
    max > 0 && get_connected_devices_list(peers).await.len() >= max as usize
}
pub(crate) fn get_server_address() -> String {
    let local_addr = UdpSocket::bind("0.0.0.0:0").ok().and_then(|socket| {
        socket.connect(WS_PROBE_ADDRESS).ok()?;
        socket.local_addr().ok()
    });
    match local_addr {
        Some(addr) => format!("{}:{}", addr.ip(), ACTIVE_PORT.load(Ordering::Relaxed)),
        None => format!("{}:{}", WS_FALLBACK_HOST, ACTIVE_PORT.load(Ordering::Relaxed)),
    }
}
