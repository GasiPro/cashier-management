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
use config::pricing_matrix::PRICING_MATRIX;
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
}
type PeerMap = Arc<Mutex<HashMap<SocketAddr, PeerState>>>;
type MaxConnectedDevices = Arc<SyncMutex<u32>>;
type CashierAccounts = Arc<SyncMutex<Vec<accounts::CashierAccount>>>;
/// Populated once `.setup()` has resolved the app's config directory, so the
/// WebSocket task (spawned before the Tauri builder runs) can still persist
/// account edits via `accounts::save`, which needs an `AppHandle`.
type AppHandleSlot = Arc<SyncMutex<Option<tauri::AppHandle>>>;
pub struct AppState {
    pub order_service: Arc<OrderService>,
    pub peers: PeerMap,
    pub max_connected_devices: MaxConnectedDevices,
    pub cashier_accounts: CashierAccounts,
}
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMessage {
    CashierRegister { username: String },
    RequestConnection { username: String, password: String },
    CreateOrder { cart: Vec<CartItem> },
    UpdateOrder { id: i64, quantity: u32, unit_price: u32 },
    DeleteOrder { id: i64 },
    DeleteOrderGroup { group_id: i64 },
    RequestOrders,
    /// Comptoir: fetch the account view for the peer's own authenticated account,
    /// to prefill the account-settings form.
    GetAccount,
    /// Comptoir: self-service edit of the peer's own display name and/or password.
    /// `password: None` means "leave the password unchanged", mirroring
    /// `update_cashier_account`.
    UpdateAccount { display_name: String, password: Option<String> },
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
    Account { data: accounts::CashierAccountView },
    AccountUpdated { data: accounts::CashierAccountView },
    AccountUpdateError { data: String },
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
#[tauri::command]
async fn approve_connection(state: State<'_, AppState>, addr: String) -> Result<(), String> {
    let socket_addr: SocketAddr = addr.parse().map_err(|e: std::net::AddrParseError| e.to_string())?;
    if is_at_connected_devices_capacity(&state.peers, &state.max_connected_devices).await {
        let max = *state.max_connected_devices.lock().unwrap();
        return Err(format!(
            "Limite de {max} appareil(s) connecté(s) atteinte. Déconnectez un appareil ou augmentez la limite dans Réglages."
        ));
    }
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
    {
        let mut guard = state.max_connected_devices.lock().unwrap();
        *guard = clamped;
    }
    let mut current = settings::load(&app);
    current.max_connected_devices = clamped;
    settings::update(&app, current)?;
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
fn authenticate_cashier(
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> Result<accounts::CashierAccountView, String> {
    let username = accounts::validate_username(&username)?;
    accounts::validate_password(&password)?;
    let guard = state.cashier_accounts.lock().unwrap();
    let account = guard.iter().find(|a| a.username.eq_ignore_ascii_case(&username));
    let account = match account {
        Some(a) if accounts::verify_password(&password, &a.password_hash) => a,
        _ => return Err("Nom d'utilisateur ou mot de passe incorrect.".to_string()),
    };
    if account.status == accounts::AccountStatus::Suspended {
        return Err("Ce compte a été suspendu. Contactez un administrateur.".to_string());
    }
    Ok(accounts::CashierAccountView::from(account))
}
/// Create a new cashier account. The username is validated, checked for
/// uniqueness (case-insensitive) against every existing account, and — once
/// created — is never changed: there is deliberately no "rename" command,
#[tauri::command]
async fn create_cashier_account(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> Result<accounts::CashierAccountView, String> {
    let username = accounts::validate_username(&username)?;
    accounts::validate_password(&password)?;
    let mut guard = state.cashier_accounts.lock().unwrap();
    if accounts::username_exists(&guard, &username) {
        return Err("Ce nom d'utilisateur est déjà utilisé.".to_string());
    }
    let password_hash = accounts::hash_password(&password)?;
    let account = accounts::CashierAccount {
        username,
        display_name: String::new(),
        password_hash,
        created_at: chrono::Local::now().to_rfc3339(),
        status: accounts::AccountStatus::Active,
    };
    guard.push(account);
    accounts::save(&app, &guard)?;
    Ok(accounts::CashierAccountView::from(guard.last().expect("account was just pushed")))
}
#[tauri::command]
fn list_cashier_accounts(state: State<'_, AppState>) -> Vec<accounts::CashierAccountView> {
    state
        .cashier_accounts
        .lock()
        .unwrap()
        .iter()
        .map(accounts::CashierAccountView::from)
        .collect()
}
/// Modify an existing cashier account's display name and/or password.
#[tauri::command]
async fn update_cashier_account(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    username: String,
    display_name: String,
    password: Option<String>,
) -> Result<accounts::CashierAccountView, String> {
    let display_name = accounts::validate_display_name(&display_name)?;
    if let Some(ref pwd) = password {
        accounts::validate_password(pwd)?;
    }
    // Hash before touching the account so a hashing failure never leaves the
    // in-memory list mutated without a matching write to disk.
    let new_password_hash = match password {
        Some(pwd) => Some(accounts::hash_password(&pwd)?),
        None => None,
    };
    let mut guard = state.cashier_accounts.lock().unwrap();
    let account = accounts::find_account_mut(&mut guard, &username)
        .ok_or_else(|| "Compte introuvable.".to_string())?;
    account.display_name = display_name;
    if let Some(hash) = new_password_hash {
        account.password_hash = hash;
    }
    let updated = accounts::CashierAccountView::from(&*account);
    accounts::save(&app, &guard)?;
    Ok(updated)
}
/// Suspend a cashier account: a reversible block. The account and its order
/// history are left untouched on disk — it's only flagged so it can no
#[tauri::command]
async fn suspend_cashier_account(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    username: String,
) -> Result<accounts::CashierAccountView, String> {
    let mut guard = state.cashier_accounts.lock().unwrap();
    let account =
        accounts::find_account_mut(&mut guard, &username).ok_or_else(|| "Compte introuvable.".to_string())?;
    accounts::suspend(account);
    let updated = accounts::CashierAccountView::from(&*account);
    accounts::save(&app, &guard)?;
    Ok(updated)
}
/// Reactivate a previously suspended cashier account, restoring its access.
/// Called from the Réglages UI via invoke().
#[tauri::command]
async fn reactivate_cashier_account(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    username: String,
) -> Result<accounts::CashierAccountView, String> {
    let mut guard = state.cashier_accounts.lock().unwrap();
    let account =
        accounts::find_account_mut(&mut guard, &username).ok_or_else(|| "Compte introuvable.".to_string())?;
    accounts::reactivate(account);
    let updated = accounts::CashierAccountView::from(&*account);
    accounts::save(&app, &guard)?;
    Ok(updated)
}
#[tauri::command]
async fn delete_cashier_account(app: tauri::AppHandle, state: State<'_, AppState>, username: String) -> Result<(), String> {
    let mut guard = state.cashier_accounts.lock().unwrap();
    if !accounts::remove_account(&mut guard, &username) {
        return Err("Compte introuvable.".to_string());
    }
    accounts::save(&app, &guard)?;
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
    // Real value is loaded from disk (or defaulted) in `.setup()` below, once an
    // AppHandle is available to resolve the app's config directory.
    let max_connected_devices: MaxConnectedDevices = Arc::new(SyncMutex::new(settings::DEFAULT_MAX_CONNECTED_DEVICES));
    let cashier_accounts: CashierAccounts = Arc::new(SyncMutex::new(Vec::new()));
    // Set once `.setup()` resolves an `AppHandle`; read by the WebSocket task so
    // `ClientMessage::UpdateAccount` can persist edits via `accounts::save`.
    let app_handle_slot: AppHandleSlot = Arc::new(SyncMutex::new(None));
    let ws_order_service = order_service.clone();
    let ws_peers = peers.clone();
    let ws_max_connected_devices = max_connected_devices.clone();
    let ws_cashier_accounts = cashier_accounts.clone();
    let ws_app_handle_slot = app_handle_slot.clone();
    tauri::async_runtime::spawn(async move {
        let listener = TcpListener::bind("0.0.0.0:8080")
            .await
            .expect("failed to bind WebSocket server to 0.0.0.0:8080");
        while let Ok((stream, addr)) = listener.accept().await {
            let peers_inner = ws_peers.clone();
            let order_service_inner = ws_order_service.clone();
            let max_connected_devices_inner = ws_max_connected_devices.clone();
            let cashier_accounts_inner = ws_cashier_accounts.clone();
            let app_handle_inner = ws_app_handle_slot.clone();
            tauri::async_runtime::spawn(async move {
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
                            Ok(ClientMessage::RequestConnection { username, password }) => {
                                let format_ok = accounts::validate_username(&username).is_ok()
                                    && accounts::validate_password(&password).is_ok();
                                let credentials_ok = format_ok && {
                                    let guard = cashier_accounts_inner.lock().unwrap();
                                    guard.iter().any(|a| {
                                        a.username.eq_ignore_ascii_case(username.trim())
                                            && a.status == accounts::AccountStatus::Active
                                            && accounts::verify_password(&password, &a.password_hash)
                                    })
                                };
                                if !credentials_ok {
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
                                        let guard = cashier_accounts_inner.lock().unwrap();
                                        guard
                                            .iter()
                                            .find(|a| a.username.eq_ignore_ascii_case(&username))
                                            .map(accounts::CashierAccountView::from)
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
                                // Reuses the exact same validation/hashing/persistence logic as
                                // `update_cashier_account` (the Réglages UI's own account editor).
                                let result: Result<accounts::CashierAccountView, String> = (|| {
                                    let display_name = accounts::validate_display_name(&display_name)?;
                                    if let Some(ref pwd) = password {
                                        accounts::validate_password(pwd)?;
                                    }
                                    let new_password_hash = match password {
                                        Some(pwd) => Some(accounts::hash_password(&pwd)?),
                                        None => None,
                                    };
                                    let mut guard = cashier_accounts_inner.lock().unwrap();
                                    let account = accounts::find_account_mut(&mut guard, &username)
                                        .ok_or_else(|| "Compte introuvable.".to_string())?;
                                    account.display_name = display_name;
                                    if let Some(hash) = new_password_hash {
                                        account.password_hash = hash;
                                    }
                                    let updated = accounts::CashierAccountView::from(&*account);
                                    accounts::save(&app_handle, &guard)?;
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
                            Err(_) => {}
                        }
                    }
                }
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
    let time_peers = peers.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            let current_time = chrono::Local::now().format("%H:%M:%S").to_string();
            broadcast_to_approved(&time_peers, &ServerMessage::Time { data: current_time }).await;
        }
    });
    let setup_max_connected_devices = max_connected_devices.clone();
    let setup_cashier_accounts = cashier_accounts.clone();
    let setup_app_handle_slot = app_handle_slot.clone();
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
            *setup_cashier_accounts.lock().unwrap() = config::accounts::load_or_bootstrap(app.handle());
            *setup_app_handle_slot.lock().unwrap() = Some(app.handle().clone());
            Ok(())
        })
        .manage(AppState { order_service, peers, max_connected_devices, cashier_accounts })
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
            get_max_connected_devices,
            get_connected_devices_count,
            set_max_connected_devices,
            get_theme,
            get_background_color,
            get_font_size,
            set_background_color,
            set_font_size,
            set_theme,
            authenticate_cashier,
            create_cashier_account,
            list_cashier_accounts,
            update_cashier_account,
            suspend_cashier_account,
            reactivate_cashier_account,
            delete_cashier_account,
            save_binary_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
