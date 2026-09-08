pub mod config;
pub mod domain;
pub mod service;
use futures_util::future::ok;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::Mutex as SyncMutex;
use tauri::State;
use tokio::net::TcpListener;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;
use config::accounts;
use config::connections;
use config::rate_limit;
use config::settings;
use domain::order::price_calculator::{CartItem, ServiceItem, ServiceItemType as PriceCalculatorItemType};
use service::order_api_service::Order;
use service::order_service::OrderService;
type Tx = mpsc::UnboundedSender<Message>;
pub struct PeerState {
    tx: Tx,
    username: String,
    approved: bool,
    is_cashier: bool,
    is_admin: bool,
}
type PeerMap = Arc<Mutex<HashMap<SocketAddr, PeerState>>>;
type MaxConnectedDevices = Arc<SyncMutex<u32>>;
type Accounts = Arc<SyncMutex<Vec<accounts::StoredAccount>>>;
type AppHandleSlot = Arc<SyncMutex<Option<tauri::AppHandle>>>;
type Blacklist = Arc<SyncMutex<Vec<connections::BlacklistEntry>>>;
type ConnectionHistory = Arc<SyncMutex<Vec<connections::ConnectionHistoryEntry>>>;
type PricingStore = Arc<SyncMutex<Vec<ServiceItem>>>;
pub struct AppState {
    pub order_service: Arc<OrderService>,
    pub peers: PeerMap,
    pub max_connected_devices: MaxConnectedDevices,
    pub accounts: Accounts,
    pub blacklist: Blacklist,
    pub connection_history: ConnectionHistory,
    pub pricing: PricingStore,
    pub sessions: accounts::Sessions,
    pub auth_attempts: rate_limit::AttemptTracker,
    pub connection_attempts: rate_limit::AttemptTracker,
}
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMessage {
    // `token` must be a valid, unexpired session token minted by
    // `authenticate_cashier` / `authenticate_admin` (see `accounts::mint_session`).
    // The `username` field is kept for wire compatibility but is no longer
    // trusted; the registered identity comes from the verified session.
    CashierRegister { username: String, token: String },
    AdminRegister { #[serde(default)] username: Option<String>, token: String },
    RequestConnection { username: String, password: String },
    CreateOrder { cart: Vec<CartItem> },
    UpdateOrder { id: i64, quantity: u32, unit_price: u32 },
    DeleteOrder { id: i64 },
    DeleteOrderGroup { group_id: i64 },
    RequestOrders,
    RequestPricing,
    GetAccount,
    UpdateAccount { display_name: String, password: Option<String> },
}
#[derive(Debug, Serialize, Clone)]
struct ConnectionRequest {
    addr: String,
    username: String,
}
type PendingConnection = ConnectionRequest;
#[derive(Debug, Serialize, Clone)]
struct ConnectedDevice {
    addr: String,
    username: String,
}
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ServerMessage {
    Orders { data: Vec<Order> },
    Time { data: String },
    ConnectionRequests { data: Vec<ConnectionRequest> },
    ConnectedDevices { data: Vec<ConnectedDevice> },
    ConnectionApproved,
    ConnectionRejected,
    ConnectionBlocked,
    Account { data: accounts::Account },
    AccountUpdated { data: accounts::Account },
    AccountUpdateError { data: String },
    OrderError { data: String },
    Pricing { data: Vec<ServiceItem> },
    ProtocolError { data: String },
}
async fn send_to_addr(peers: &PeerMap, addr: SocketAddr, msg: &ServerMessage) {
    if let Ok(json) = serde_json::to_string(msg) {
        let guard = peers.lock().await;
        if let Some(state) = guard.get(&addr) {
            let _ = state.tx.send(Message::Text(json.into()));
        }
    }
}
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
async fn broadcast_orders_to_approved(peers: &PeerMap, orders: &[Order]) {
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
fn scope_orders_for_peer(orders: &[Order], peer: &PeerState) -> Vec<Order> {
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
async fn is_at_connected_devices_capacity(peers: &PeerMap, max_connected_devices: &MaxConnectedDevices) -> bool {
    let max = *max_connected_devices.lock().unwrap();
    max > 0 && get_connected_devices_list(peers).await.len() >= max as usize
}
fn record_connection_history(
    history: &ConnectionHistory,
    app: Option<&tauri::AppHandle>,
    addr: &str,
    username: &str,
    event: connections::ConnectionEvent,
) {
    let mut guard = history.lock().unwrap();
    connections::push_history_entry(
        &mut guard,
        connections::ConnectionHistoryEntry {
            addr: addr.to_string(),
            username: username.to_string(),
            event,
            timestamp: chrono::Local::now().to_rfc3339(),
        },
    );
    if let Some(app) = app {
        if let Err(err) = connections::save_history(app, &guard) {
            log::error!("Échec de l'enregistrement de l'historique des connexions : {err}");
        }
    }
}
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
fn get_pricing_matrix(state: State<'_, AppState>) -> Vec<ServiceItem> {
    state.pricing.lock().unwrap().clone()
}
/// Add a new item (service or product) to the pricing matrix. Persists to
/// disk and returns the created item, including its generated `id`.
#[tauri::command]
async fn create_pricing_item(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    category: String,
    label: String,
    price: u32,
    item_type: PriceCalculatorItemType,
) -> Result<ServiceItem, String> {
    let category = config::pricing_matrix::validate_category(&category)?;
    let label = config::pricing_matrix::validate_label(&label)?;
    let (item, snapshot) = {
        let mut guard = state.pricing.lock().unwrap();
        let item = ServiceItem {
            id: config::pricing_matrix::generate_id(),
            item_type,
            category,
            label,
            price,
        };
        guard.push(item.clone());
        if let Err(err) = config::pricing_matrix::save(&app, &guard) {
            guard.pop();
            return Err(format!("Échec de l'enregistrement de l'article : {err}"));
        }
        (item, guard.clone())
    };
    broadcast_to_approved(&state.peers, &ServerMessage::Pricing { data: snapshot }).await;
    Ok(item)
}
#[tauri::command]
async fn update_pricing_item(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    category: Option<String>,
    label: Option<String>,
    price: Option<u32>,
    item_type: Option<PriceCalculatorItemType>,
) -> Result<ServiceItem, String> {
    let category = match category {
        Some(c) => Some(config::pricing_matrix::validate_category(&c)?),
        None => None,
    };
    let label = match label {
        Some(l) => Some(config::pricing_matrix::validate_label(&l)?),
        None => None,
    };
    let (updated, snapshot) = {
        let mut guard = state.pricing.lock().unwrap();
        let item = config::pricing_matrix::find_item_mut(&mut guard, &id)
            .ok_or_else(|| "Article introuvable.".to_string())?;
        let previous = item.clone();
        if let Some(category) = category {
            item.category = category;
        }
        if let Some(label) = label {
            item.label = label;
        }
        if let Some(price) = price {
            item.price = price;
        }
        if let Some(item_type) = item_type {
            item.item_type = item_type;
        }
        let updated = item.clone();
        if let Err(err) = config::pricing_matrix::save(&app, &guard) {
            if let Some(item) = config::pricing_matrix::find_item_mut(&mut guard, &id) {
                *item = previous;
            }
            return Err(format!("Échec de l'enregistrement de l'article : {err}"));
        }
        (updated, guard.clone())
    };
    broadcast_to_approved(&state.peers, &ServerMessage::Pricing { data: snapshot }).await;
    Ok(updated)
}
/// Remove an item from the pricing matrix.
#[tauri::command]
async fn delete_pricing_item(app: tauri::AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    let snapshot = {
        let mut guard = state.pricing.lock().unwrap();
        let index = guard
            .iter()
            .position(|item| item.id == id)
            .ok_or_else(|| "Article introuvable.".to_string())?;
        let removed = guard.remove(index);
        if let Err(err) = config::pricing_matrix::save(&app, &guard) {
            guard.insert(index, removed);
            return Err(format!("Échec de l'enregistrement de la suppression : {err}"));
        }
        guard.clone()
    };
    broadcast_to_approved(&state.peers, &ServerMessage::Pricing { data: snapshot }).await;
    Ok(())
}
/// One-shot invoke()-based fetch of every order, for admin/read-only views.
/// This is the invoke() alternative to the WebSocket `orders` broadcast that
/// approved peers (see `AdminRegister` / `CashierRegister`) receive live.
#[tauri::command]
fn get_orders(state: State<'_, AppState>) -> Vec<Order> {
    state.order_service.get_orders()
}
/// invoke()-based alternative to the WebSocket `orders` broadcast, scoped to
/// pending orders only.
#[tauri::command]
fn get_pending_orders(state: State<'_, AppState>) -> Vec<Order> {
    state.order_service.get_pending()
}
/// invoke()-based alternative to the WebSocket `orders` broadcast, scoped to
/// paid orders only.
#[tauri::command]
fn get_paid_orders(state: State<'_, AppState>) -> Vec<Order> {
    state.order_service.get_paid()
}
#[tauri::command]
async fn create_order(state: State<'_, AppState>, cart: Vec<CartItem>, counter_username: String) -> Result<(), String> {
    state.order_service.create_order(&cart, &counter_username)?;
    broadcast_orders_to_approved(&state.peers, &state.order_service.get_orders()).await;
    Ok(())
}
#[tauri::command]
async fn mark_group_as_paid(state: State<'_, AppState>, group_id: i64) -> Result<(), String> {
    state.order_service.mark_group_as_paid(group_id)?;
    broadcast_orders_to_approved(&state.peers, &state.order_service.get_orders()).await;
    Ok(())
}
/// Caisse: refuse an entire pending order group. Called from the cashier UI via invoke().
/// `raison` is an optional reason for the cancellation.
#[tauri::command]
async fn reject_group(state: State<'_, AppState>, group_id: i64, raison: Option<String>) -> Result<(), String> {
    state.order_service.reject_group(group_id, raison)?;
    broadcast_orders_to_approved(&state.peers, &state.order_service.get_orders()).await;
    Ok(())
}
#[tauri::command]
async fn approve_connection(app: tauri::AppHandle, state: State<'_, AppState>, addr: String) -> Result<(), String> {
    let socket_addr: SocketAddr = addr.parse().map_err(|e: std::net::AddrParseError| e.to_string())?;
    if is_at_connected_devices_capacity(&state.peers, &state.max_connected_devices).await {
        let max = *state.max_connected_devices.lock().unwrap();
        return Err(format!(
            "Limite de {max} appareil(s) connecté(s) atteinte. Déconnectez un appareil ou augmentez la limite dans Réglages."
        ));
    }
    let orders = state.order_service.get_orders();
    let mut approved_username = String::new();
    {
        let mut guard = state.peers.lock().await;
        if let Some(peer) = guard.get_mut(&socket_addr) {
            peer.approved = true;
            approved_username = peer.username.clone();
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
    record_connection_history(
        &state.connection_history,
        Some(&app),
        &addr,
        &approved_username,
        connections::ConnectionEvent::Approved,
    );
    let pending = get_pending_requests_list(&state.peers).await;
    let connected = get_connected_devices_list(&state.peers).await;
    notify_cashier(&state.peers, &ServerMessage::ConnectionRequests { data: pending }).await;
    notify_cashier(&state.peers, &ServerMessage::ConnectedDevices { data: connected }).await;
    Ok(())
}
/// Reject a pending counter connection. Called from the cashier UI via invoke().
#[tauri::command]
async fn reject_connection(app: tauri::AppHandle, state: State<'_, AppState>, addr: String) -> Result<(), String> {
    let socket_addr: SocketAddr = addr.parse().map_err(|e: std::net::AddrParseError| e.to_string())?;
    let mut rejected_username = String::new();
    {
        let mut guard = state.peers.lock().await;
        if let Some(peer) = guard.get(&socket_addr) {
            rejected_username = peer.username.clone();
            let _ = peer.tx.send(Message::Text(
                serde_json::to_string(&ServerMessage::ConnectionRejected)
                    .unwrap_or_default()
                    .into(),
            ));
        }
        guard.remove(&socket_addr);
    }
    record_connection_history(
        &state.connection_history,
        Some(&app),
        &addr,
        &rejected_username,
        connections::ConnectionEvent::Rejected,
    );
    let pending = get_pending_requests_list(&state.peers).await;
    notify_cashier(&state.peers, &ServerMessage::ConnectionRequests { data: pending }).await;
    Ok(())
}
#[tauri::command]
async fn disconnect_device(app: tauri::AppHandle, state: State<'_, AppState>, addr: String) -> Result<(), String> {
    let socket_addr: SocketAddr = addr.parse().map_err(|e: std::net::AddrParseError| e.to_string())?;
    let mut disconnected_username = String::new();
    {
        let mut guard = state.peers.lock().await;
        if let Some(peer) = guard.get(&socket_addr) {
            disconnected_username = peer.username.clone();
            let _ = peer.tx.send(Message::Text(
                serde_json::to_string(&ServerMessage::ConnectionBlocked)
                    .unwrap_or_default()
                    .into(),
            ));
        }
        guard.remove(&socket_addr);
    }
    record_connection_history(
        &state.connection_history,
        Some(&app),
        &addr,
        &disconnected_username,
        connections::ConnectionEvent::Disconnected,
    );
    let connected = get_connected_devices_list(&state.peers).await;
    notify_cashier(&state.peers, &ServerMessage::ConnectedDevices { data: connected }).await;
    Ok(())
}
/// List counters currently awaiting cashier approval. Called from the
/// cashier UI via invoke() as a one-off fetch (in addition to the live
/// `ConnectionRequests` push over the WebSocket).
#[tauri::command]
async fn list_pending_connections(state: State<'_, AppState>) -> Result<Vec<PendingConnection>, String> {
    Ok(get_pending_requests_list(&state.peers).await)
}
#[tauri::command]
async fn list_connected_devices(state: State<'_, AppState>) -> Result<Vec<ConnectedDevice>, String> {
    Ok(get_connected_devices_list(&state.peers).await)
}
/// Disconnect a device (like `disconnect_device`) and, unlike it, also add
/// the device's address to the persistent blacklist so it can't reconnect.
#[tauri::command]
async fn block_device(app: tauri::AppHandle, state: State<'_, AppState>, addr: String) -> Result<(), String> {
    let socket_addr: SocketAddr = addr.parse().map_err(|e: std::net::AddrParseError| e.to_string())?;
    let mut blocked_username = String::new();
    {
        let mut guard = state.peers.lock().await;
        if let Some(peer) = guard.get(&socket_addr) {
            blocked_username = peer.username.clone();
            let _ = peer.tx.send(Message::Text(
                serde_json::to_string(&ServerMessage::ConnectionBlocked)
                    .unwrap_or_default()
                    .into(),
            ));
        }
        guard.remove(&socket_addr);
    }
    {
        let mut guard = state.blacklist.lock().unwrap();
        if !connections::is_blacklisted(&guard, &addr) {
            guard.push(connections::BlacklistEntry {
                addr: addr.clone(),
                reason: None,
                created_at: chrono::Local::now().to_rfc3339(),
            });
            if let Err(err) = connections::save_blacklist(&app, &guard) {
                guard.pop();
                return Err(format!("Échec de l'enregistrement de la liste noire : {err}"));
            }
        }
    }
    record_connection_history(
        &state.connection_history,
        Some(&app),
        &addr,
        &blocked_username,
        connections::ConnectionEvent::Blocked,
    );
    let pending = get_pending_requests_list(&state.peers).await;
    let connected = get_connected_devices_list(&state.peers).await;
    notify_cashier(&state.peers, &ServerMessage::ConnectionRequests { data: pending }).await;
    notify_cashier(&state.peers, &ServerMessage::ConnectedDevices { data: connected }).await;
    Ok(())
}
/// The connection lifecycle log (requested/approved/rejected/disconnected/
/// blocked), most recent last. Called from the cashier UI via invoke().
#[tauri::command]
fn list_connection_history(state: State<'_, AppState>) -> Vec<connections::ConnectionHistoryEntry> {
    state.connection_history.lock().unwrap().clone()
}
#[tauri::command]
fn list_blacklist_entries(state: State<'_, AppState>) -> Vec<connections::BlacklistEntry> {
    state.blacklist.lock().unwrap().clone()
}
/// Add an address to the blacklist without needing an active connection to
/// block (unlike `block_device`). Called from the cashier UI via invoke().
#[tauri::command]
async fn add_blacklist_entry(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    addr: String,
    reason: Option<String>,
) -> Result<connections::BlacklistEntry, String> {
    let mut guard = state.blacklist.lock().unwrap();
    if connections::is_blacklisted(&guard, &addr) {
        return Err("Cette adresse est déjà sur liste noire.".to_string());
    }
    let entry = connections::BlacklistEntry {
        addr,
        reason,
        created_at: chrono::Local::now().to_rfc3339(),
    };
    guard.push(entry.clone());
    if let Err(err) = connections::save_blacklist(&app, &guard) {
        guard.pop();
        return Err(format!("Échec de l'enregistrement de la liste noire : {err}"));
    }
    Ok(entry)
}
#[tauri::command]
async fn remove_blacklist_entry(app: tauri::AppHandle, state: State<'_, AppState>, addr: String) -> Result<(), String> {
    let mut guard = state.blacklist.lock().unwrap();
    let snapshot = guard.clone();
    if !connections::remove_blacklist_entry(&mut guard, &addr) {
        return Err("Adresse introuvable sur liste noire.".to_string());
    }
    if let Err(err) = connections::save_blacklist(&app, &guard) {
        *guard = snapshot;
        return Err(format!("Échec de l'enregistrement de la liste noire : {err}"));
    }
    Ok(())
}
/// Current cap on connected comptoir devices (`0` = unlimited). Called from the
/// Réglages UI via invoke().
#[tauri::command]
fn get_max_connected_devices(state: State<'_, AppState>) -> u32 {
    *state.max_connected_devices.lock().unwrap()
}
#[tauri::command]
async fn get_connected_devices_count(state: State<'_, AppState>) -> Result<usize, String> {
    Ok(get_connected_devices_list(&state.peers).await.len())
}
/// Update the cap on connected comptoir devices. Persists to disk and takes effect
/// immediately for new connection requests; already-connected devices are left
/// untouched. Returns the value actually applied (clamped to a sane range).
#[tauri::command]
async fn set_max_connected_devices(app: tauri::AppHandle, state: State<'_, AppState>, value: u32) -> Result<u32, String> {
    let clamped = settings::clamp_max_connected_devices(value);
    let mut current = settings::load(&app);
    current.max_connected_devices = clamped;
    settings::update(&app, current)
        .map_err(|err| format!("Échec de l'enregistrement du paramètre : {err}"))?;
    *state.max_connected_devices.lock().unwrap() = clamped;
    Ok(clamped)
}
#[tauri::command]
fn get_theme(app: tauri::AppHandle) -> String {
    settings::load(&app).theme.as_str().to_string()
}
#[tauri::command]
fn get_background_color(app: tauri::AppHandle) -> String {
    settings::load(&app).background_color
}
#[tauri::command]
fn get_font_size(app: tauri::AppHandle) -> u32 {
    settings::load(&app).font_size
}
#[tauri::command]
async fn set_background_color(app: tauri::AppHandle, value: String) -> Result<String, String> {
    let mut current = settings::load(&app);
    current.background_color = value.clone();
    settings::update(&app, current)?;
    Ok(value)
}
#[tauri::command]
async fn set_font_size(app: tauri::AppHandle, value: u32) -> Result<u32, String> {
    let clamped = settings::clamp_font_size(value);
    let mut current = settings::load(&app);
    current.font_size = clamped;
    settings::update(&app, current)?;
    Ok(clamped)
}
#[tauri::command]
async fn set_theme(app: tauri::AppHandle, value: String) -> Result<String, String> {
    let theme = settings::Theme::from_str(&value)?;
    let mut current = settings::load(&app);
    current.theme = theme.clone();
    settings::update(&app, current)?;
    Ok(theme.as_str().to_string())
}
#[tauri::command]
async fn authenticate_admin(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> Result<accounts::AuthResult, String> {
    let username = accounts::validate_username(&username)?;
    accounts::validate_password(&password)?;
    let attempt_key = format!("admin:{}", username.to_lowercase());
    if let Some(remaining) = rate_limit::seconds_until_unlocked(&state.auth_attempts, &attempt_key) {
        return Ok(accounts::AuthResult {
            success: false,
            account: None,
            error: Some(format!(
                "Trop de tentatives échouées. Réessayez dans {remaining} seconde(s)."
            )),
            session_token: None,
        });
    }
    let mut guard = state.accounts.lock().unwrap();
    let found = guard.iter_mut().find(|a| {
        a.username.eq_ignore_ascii_case(&username) && a.user_type == accounts::UserType::Admin
    });
    let verified = match &found {
        Some(a) => accounts::verify_password(&password, &a.password_hash),
        None => false,
    };
    if !verified {
        drop(guard);
        rate_limit::record_failure(&state.auth_attempts, &attempt_key);
        return Ok(accounts::AuthResult {
            success: false,
            account: None,
            error: Some("Nom d'utilisateur ou mot de passe incorrect.".to_string()),
            session_token: None,
        });
    }
    let account = found.expect("verified implies the account was found");
    if account.status == accounts::AccountStatus::Suspended {
        drop(guard);
        rate_limit::record_failure(&state.auth_attempts, &attempt_key);
        return Ok(accounts::AuthResult {
            success: false,
            account: None,
            error: Some("Ce compte a été suspendu. Contactez un administrateur.".to_string()),
            session_token: None,
        });
    }
    account.last_sign_in_at = Some(chrono::Local::now().to_rfc3339());
    let view = accounts::Account::from(&*account);
    accounts::save(&app, &guard)?;
    drop(guard);
    rate_limit::record_success(&state.auth_attempts, &attempt_key);
    let token = accounts::mint_session(&state.sessions, &view.username, accounts::SessionRole::Admin);
    Ok(accounts::AuthResult {
        success: true,
        account: Some(view),
        error: None,
        session_token: Some(token),
    })
}
#[tauri::command]
async fn authenticate_cashier(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> Result<accounts::AuthResult, String> {
    let username = accounts::validate_username(&username)?;
    accounts::validate_password(&password)?;
    let attempt_key = format!("cashier:{}", username.to_lowercase());
    if let Some(remaining) = rate_limit::seconds_until_unlocked(&state.auth_attempts, &attempt_key) {
        return Ok(accounts::AuthResult {
            success: false,
            account: None,
            error: Some(format!(
                "Trop de tentatives échouées. Réessayez dans {remaining} seconde(s)."
            )),
            session_token: None,
        });
    }
    let mut guard = state.accounts.lock().unwrap();
    let found = guard.iter_mut().find(|a| {
        a.username.eq_ignore_ascii_case(&username) && a.user_type == accounts::UserType::Caissier
    });
    let verified = match &found {
        Some(a) => accounts::verify_password(&password, &a.password_hash),
        None => false,
    };
    if !verified {
        drop(guard);
        rate_limit::record_failure(&state.auth_attempts, &attempt_key);
        return Ok(accounts::AuthResult {
            success: false,
            account: None,
            error: Some("Nom d'utilisateur ou mot de passe incorrect.".to_string()),
            session_token: None,
        });
    }
    let account = found.expect("verified implies the account was found");
    if account.status == accounts::AccountStatus::Suspended {
        drop(guard);
        rate_limit::record_failure(&state.auth_attempts, &attempt_key);
        return Ok(accounts::AuthResult {
            success: false,
            account: None,
            error: Some("Ce compte a été suspendu. Contactez un administrateur.".to_string()),
            session_token: None,
        });
    }
    account.last_sign_in_at = Some(chrono::Local::now().to_rfc3339());
    let view = accounts::Account::from(&*account);
    accounts::save(&app, &guard)?;
    drop(guard);
    rate_limit::record_success(&state.auth_attempts, &attempt_key);
    let token = accounts::mint_session(&state.sessions, &view.username, accounts::SessionRole::Cashier);
    Ok(accounts::AuthResult {
        success: true,
        account: Some(view),
        error: None,
        session_token: Some(token),
    })
}
/// Create a new account. The username is validated, checked for uniqueness
/// (case-insensitive) against every existing account, and — once created —
/// is never changed: there is deliberately no "rename" command.
#[tauri::command]
async fn create_account(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    username: String,
    password: String,
    display_name: String,
    user_type: accounts::UserType,
) -> Result<accounts::Account, String> {
    let username = accounts::validate_username(&username)?;
    accounts::validate_password(&password)?;
    let display_name = accounts::validate_display_name(&display_name)?;
    let mut guard = state.accounts.lock().unwrap();
    if accounts::username_exists(&guard, &username) {
        return Err("Ce nom d'utilisateur est déjà utilisé.".to_string());
    }
    let password_hash = accounts::hash_password(&password)?;
    let now = chrono::Local::now().to_rfc3339();
    let account = accounts::StoredAccount {
        id: accounts::generate_id(),
        username,
        display_name,
        password_hash,
        user_type,
        status: accounts::AccountStatus::Active,
        created_at: now.clone(),
        last_sign_in_at: None,
        history: vec![accounts::AccountActivityEntry {
            kind: accounts::ActivityKind::Created,
            timestamp: now,
            reason: None,
        }],
    };
    guard.push(account);
    if let Err(err) = accounts::save(&app, &guard) {
        guard.pop();
        return Err(format!("Échec de l'enregistrement du compte : {err}"));
    }
    Ok(accounts::Account::from(guard.last().expect("account was just pushed")))
}
#[tauri::command]
fn list_accounts(state: State<'_, AppState>) -> Vec<accounts::Account> {
    state.accounts.lock().unwrap().iter().map(accounts::Account::from).collect()
}
/// Modify an existing account's display name, user type, and/or password.
#[tauri::command]
async fn update_account(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    username: String,
    display_name: Option<String>,
    user_type: Option<accounts::UserType>,
    password: Option<String>,
) -> Result<accounts::Account, String> {
    let display_name = match display_name {
        Some(name) => Some(accounts::validate_display_name(&name)?),
        None => None,
    };
    if let Some(ref pwd) = password {
        accounts::validate_password(pwd)?;
    }
    let new_password_hash = match password {
        Some(pwd) => Some(accounts::hash_password(&pwd)?),
        None => None,
    };
    let mut guard = state.accounts.lock().unwrap();
    let account = accounts::find_account_mut(&mut guard, &username)
        .ok_or_else(|| "Compte introuvable.".to_string())?;
    let previous = account.clone();
    if let Some(display_name) = display_name {
        account.display_name = display_name;
    }
    if let Some(user_type) = user_type {
        account.user_type = user_type;
    }
    if let Some(hash) = new_password_hash {
        account.password_hash = hash;
    }
    accounts::record_activity(account, accounts::ActivityKind::Modified, None);
    let updated = accounts::Account::from(&*account);
    if let Err(err) = accounts::save(&app, &guard) {
        if let Some(account) = accounts::find_account_mut(&mut guard, &username) {
            *account = previous;
        }
        return Err(format!("Échec de l'enregistrement du compte : {err}"));
    }
    Ok(updated)
}
/// Suspend an account: a reversible block. The account and its history are
/// left untouched on disk — it's only flagged so it can no longer
#[tauri::command]
async fn suspend_account(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    username: String,
    reason: Option<String>,
) -> Result<accounts::Account, String> {
    let mut guard = state.accounts.lock().unwrap();
    let account =
        accounts::find_account_mut(&mut guard, &username).ok_or_else(|| "Compte introuvable.".to_string())?;
    let previous = account.clone();
    accounts::suspend(account, reason);
    let updated = accounts::Account::from(&*account);
    if let Err(err) = accounts::save(&app, &guard) {
        if let Some(account) = accounts::find_account_mut(&mut guard, &username) {
            *account = previous;
        }
        return Err(format!("Échec de l'enregistrement de la suspension : {err}"));
    }
    Ok(updated)
}
/// Reactivate a previously suspended account, restoring its access. Called
/// from the Réglages UI via invoke().
#[tauri::command]
async fn reactivate_account(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    username: String,
) -> Result<accounts::Account, String> {
    let mut guard = state.accounts.lock().unwrap();
    let account =
        accounts::find_account_mut(&mut guard, &username).ok_or_else(|| "Compte introuvable.".to_string())?;
    let previous = account.clone();
    accounts::reactivate(account);
    let updated = accounts::Account::from(&*account);
    if let Err(err) = accounts::save(&app, &guard) {
        if let Some(account) = accounts::find_account_mut(&mut guard, &username) {
            *account = previous;
        }
        return Err(format!("Échec de l'enregistrement de la réactivation : {err}"));
    }
    Ok(updated)
}
#[tauri::command]
async fn delete_account(app: tauri::AppHandle, state: State<'_, AppState>, username: String) -> Result<(), String> {
    let mut guard = state.accounts.lock().unwrap();
    let index = guard
        .iter()
        .position(|a| a.username.eq_ignore_ascii_case(&username))
        .ok_or_else(|| "Compte introuvable.".to_string())?;
    let removed = guard.remove(index);
    if let Err(err) = accounts::save(&app, &guard) {
        guard.insert(index, removed);
        return Err(format!("Échec de l'enregistrement de la suppression : {err}"));
    }
    Ok(())
}
/// The activity log (created/suspended/reactivated/modified) across every
/// account, most recent first. Called from the Réglages UI via invoke().
#[tauri::command]
fn list_account_activities(state: State<'_, AppState>) -> Vec<accounts::AccountActivity> {
    accounts::list_activities(&state.accounts.lock().unwrap())
}
#[tauri::command]
fn save_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, data).map_err(|e| e.to_string())
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let order_service = Arc::new(OrderService::new());
    let peers: PeerMap = Arc::new(Mutex::new(HashMap::new()));
    let max_connected_devices: MaxConnectedDevices = Arc::new(SyncMutex::new(settings::DEFAULT_MAX_CONNECTED_DEVICES));
    let accounts_store: Accounts = Arc::new(SyncMutex::new(Vec::new()));
    let app_handle_slot: AppHandleSlot = Arc::new(SyncMutex::new(None));
    let blacklist: Blacklist = Arc::new(SyncMutex::new(Vec::new()));
    let connection_history: ConnectionHistory = Arc::new(SyncMutex::new(Vec::new()));
    let pricing_store: PricingStore = Arc::new(SyncMutex::new(Vec::new()));
    let sessions: accounts::Sessions = Arc::new(SyncMutex::new(HashMap::new()));
    let auth_attempts: rate_limit::AttemptTracker = rate_limit::new_tracker();
    let connection_attempts: rate_limit::AttemptTracker = rate_limit::new_tracker();
    let ws_order_service = order_service.clone();
    let ws_peers = peers.clone();
    let ws_max_connected_devices = max_connected_devices.clone();
    let ws_accounts = accounts_store.clone();
    let ws_app_handle_slot = app_handle_slot.clone();
    let ws_blacklist = blacklist.clone();
    let ws_connection_history = connection_history.clone();
    let ws_pricing = pricing_store.clone();
    let ws_sessions = sessions.clone();
    let ws_connection_attempts = connection_attempts.clone();
    tauri::async_runtime::spawn(async move {
        let listener = TcpListener::bind("0.0.0.0:8080")
            .await
            .expect("failed to bind WebSocket server to 0.0.0.0:8080");
        while let Ok((stream, addr)) = listener.accept().await {
            let peers_inner = ws_peers.clone();
            let order_service_inner = ws_order_service.clone();
            let max_connected_devices_inner = ws_max_connected_devices.clone();
            let accounts_inner = ws_accounts.clone();
            let app_handle_inner = ws_app_handle_slot.clone();
            let blacklist_inner = ws_blacklist.clone();
            let connection_history_inner = ws_connection_history.clone();
            let pricing_inner = ws_pricing.clone();
            let sessions_inner = ws_sessions.clone();
            let connection_attempts_inner = ws_connection_attempts.clone();
            tauri::async_runtime::spawn(async move {
                let is_blacklisted = {
                    let guard = blacklist_inner.lock().unwrap();
                    connections::is_blacklisted(&guard, &addr.to_string())
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
                        tx,
                        username: String::new(),
                        approved: false,
                        is_cashier: false,
                        is_admin: false,
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
                                let verified_username = accounts::consume_session(
                                    &sessions_inner,
                                    &token,
                                    accounts::SessionRole::Cashier,
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
                                // `username` is no longer trusted for identity; the
                                // verified session's username is authoritative.
                                let _ = username;
                                {
                                    let mut guard = peers_inner.lock().await;
                                    if let Some(state) = guard.get_mut(&addr) {
                                        state.username = verified_username;
                                        state.approved = true;
                                        state.is_cashier = true;
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
                                let verified_username = accounts::consume_session(
                                    &sessions_inner,
                                    &token,
                                    accounts::SessionRole::Admin,
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
                                // `username` is no longer trusted for identity; the
                                // verified session's username is authoritative.
                                let _ = username;
                                {
                                    let mut guard = peers_inner.lock().await;
                                    if let Some(state) = guard.get_mut(&addr) {
                                        state.username = verified_username;
                                        state.approved = true;
                                        state.is_admin = true;
                                    }
                                }
                                send_to_addr(
                                    &peers_inner,
                                    addr,
                                    &ServerMessage::Orders { data: order_service_inner.get_orders() },
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
                                let format_ok = accounts::validate_username(&username).is_ok()
                                    && accounts::validate_password(&password).is_ok();
                                let credentials_ok = format_ok && {
                                    let guard = accounts_inner.lock().unwrap();
                                    guard.iter().any(|a| {
                                        a.username.eq_ignore_ascii_case(username.trim())
                                            && a.user_type == accounts::UserType::Comptoir
                                            && a.status == accounts::AccountStatus::Active
                                            && accounts::verify_password(&password, &a.password_hash)
                                    })
                                };
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
                                            }
                                        }
                                        let app_handle = {
                                            let guard = app_handle_inner.lock().unwrap();
                                            guard.clone()
                                        };
                                        record_connection_history(
                                            &connection_history_inner,
                                            app_handle.as_ref(),
                                            &addr.to_string(),
                                            &username,
                                            connections::ConnectionEvent::Requested,
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
                                    let view = {
                                        let guard = accounts_inner.lock().unwrap();
                                        guard
                                            .iter()
                                            .find(|a| a.username.eq_ignore_ascii_case(&username))
                                            .map(accounts::Account::from)
                                    };
                                    if let Some(view) = view {
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
                                let result: Result<accounts::Account, String> = (|| {
                                    let display_name = accounts::validate_display_name(&display_name)?;
                                    if let Some(ref pwd) = password {
                                        accounts::validate_password(pwd)?;
                                    }
                                    let new_password_hash = match password {
                                        Some(pwd) => Some(accounts::hash_password(&pwd)?),
                                        None => None,
                                    };
                                    let mut guard = accounts_inner.lock().unwrap();
                                    let account = accounts::find_account_mut(&mut guard, &username)
                                        .ok_or_else(|| "Compte introuvable.".to_string())?;
                                    let previous = account.clone();
                                    account.display_name = display_name;
                                    if let Some(hash) = new_password_hash {
                                        account.password_hash = hash;
                                    }
                                    accounts::record_activity(account, accounts::ActivityKind::Modified, None);
                                    let updated = accounts::Account::from(&*account);
                                    if let Err(err) = accounts::save(&app_handle, &guard) {
                                        if let Some(account) = accounts::find_account_mut(&mut guard, &username) {
                                            *account = previous;
                                        }
                                        return Err(format!("Échec de l'enregistrement du compte : {err}"));
                                    }
                                    Ok(updated)
                                })();
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
                    record_connection_history(
                        &connection_history_inner,
                        app_handle.as_ref(),
                        &addr.to_string(),
                        &disconnected_username,
                        connections::ConnectionEvent::Disconnected,
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
    let time_peers = peers.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            let current_time = chrono::Local::now().format("%H:%M:%S").to_string();
            broadcast_to_approved(&time_peers, &ServerMessage::Time { data: current_time }).await;
        }
    });
    let setup_max_connected_devices = max_connected_devices.clone();
    let setup_accounts = accounts_store.clone();
    let setup_app_handle_slot = app_handle_slot.clone();
    let setup_blacklist = blacklist.clone();
    let setup_connection_history = connection_history.clone();
    let setup_pricing = pricing_store.clone();
    let setup_order_service = order_service.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let loaded_settings = config::settings::load(app.handle());
            *setup_max_connected_devices.lock().unwrap() = loaded_settings.max_connected_devices;
            *setup_accounts.lock().unwrap() = config::accounts::load_or_bootstrap(app.handle());
            *setup_blacklist.lock().unwrap() = connections::load_blacklist(app.handle());
            *setup_connection_history.lock().unwrap() = connections::load_history(app.handle());
            *setup_pricing.lock().unwrap() = config::pricing_matrix::load_or_bootstrap(app.handle());
            setup_order_service.load(app.handle());
            *setup_app_handle_slot.lock().unwrap() = Some(app.handle().clone());
            Ok(())
        })
        .manage(AppState {
            order_service,
            peers,
            max_connected_devices,
            accounts: accounts_store,
            blacklist,
            connection_history,
            pricing: pricing_store,
            sessions,
            auth_attempts,
            connection_attempts,
        })
                .invoke_handler(tauri::generate_handler![
            get_ws_address,
            get_pricing_matrix,
            create_pricing_item,
            update_pricing_item,
            delete_pricing_item,
            get_orders,
            get_pending_orders,
            get_paid_orders,
            create_order,
            mark_group_as_paid,
            reject_group,
            approve_connection,
            reject_connection,
            disconnect_device,
            list_pending_connections,
            list_connected_devices,
            block_device,
            list_connection_history,
            list_blacklist_entries,
            add_blacklist_entry,
            remove_blacklist_entry,
            get_max_connected_devices,
            get_connected_devices_count,
            set_max_connected_devices,
            get_theme,
            get_background_color,
            get_font_size,
            set_background_color,
            set_font_size,
            set_theme,
            authenticate_admin,
            authenticate_cashier,
            create_account,
            list_accounts,
            update_account,
            suspend_account,
            reactivate_account,
            delete_account,
            list_account_activities,
            save_binary_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
