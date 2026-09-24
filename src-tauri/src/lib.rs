pub mod app;
pub mod commands;
pub mod config;
pub mod domain;
pub mod infrastructure;
pub mod models;
pub mod repositories;
pub mod services;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex as SyncMutex;
use tokio::net::TcpListener;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;
use app::state::{Accounts, Blacklist, ConnectionHistory, MaxConnectedDevices, PeerMap, PricingStore};
use config::account_config as accounts;
use config::connection_config;
use config::rate_limit;
use config::setting_config as settings;
use domain::order::price_calculator::{CartItem, ServiceItem};
use repositories::order_repository::Order;
use services::order_service::OrderService;
pub use app::AppState;
pub use infrastructure::websocket::PeerState;
#[allow(unused_imports)]
pub(crate) use infrastructure::websocket::{
    broadcast_orders_to_approved, broadcast_to_approved, get_connected_devices_list,
    get_pending_requests_list, is_at_connected_devices_capacity, next_peer_id, notify_cashier,
    optional_username, peer_label, resolve_peer_addr, scope_orders_for_peer, send_to_addr,
};

type AppHandleSlot = Arc<SyncMutex<Option<tauri::AppHandle>>>;
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMessage {
    CashierRegister { username: String, token: String },
    AdminRegister { #[serde(default)] username: Option<String>, token: String },
    CounterRegister { #[serde(default)] username: Option<String>, token: String },
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
pub(crate) struct PendingConnection {
    id: i64,
    label: String,
    username: Option<String>,
    ip_address: String,
    port: u16,
    requested_at: String,
}
pub(crate) type ConnectionRequest = PendingConnection;
#[derive(Debug, Serialize, Clone)]
pub(crate) struct ConnectedDevice {
    id: i64,
    label: String,
    username: Option<String>,
    ip_address: String,
    port: u16,
    connected_at: String,
}
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum ServerMessage {
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
pub(crate) fn record_connection_history(
    history: &ConnectionHistory,
    app: Option<&tauri::AppHandle>,
    addr: &str,
    username: &str,
    event: connection_config::ConnectionEvent,
) {
    let mut guard = history.lock().unwrap();
    connection_config::push_history_entry(
        &mut guard,
        connection_config::ConnectionHistoryEntry {
            id: connection_config::next_history_id(),
            addr: addr.to_string(),
            username: username.to_string(),
            event,
            timestamp: chrono::Local::now().to_rfc3339(),
        },
    );
    if let Some(app) = app {
        if let Err(err) = connection_config::save_history(app, &guard) {
            log::error!("Échec de l'enregistrement de l'historique des connexions : {err}");
        }
    }
}
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
                    connection_config::is_blacklisted(&guard, &addr.to_string())
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
                                let verified_username = accounts::consume_session(
                                    &sessions_inner,
                                    &token,
                                    accounts::SessionRole::Counter,
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
                                record_connection_history(
                                    &connection_history_inner,
                                    app_handle.as_ref(),
                                    &addr.to_string(),
                                    &verified_username,
                                    connection_config::ConnectionEvent::Approved,
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
                                let username_blocked = {
                                    let guard = blacklist_inner.lock().unwrap();
                                    connection_config::is_username_blacklisted(&guard, &username)
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
                                        record_connection_history(
                                            &connection_history_inner,
                                            app_handle.as_ref(),
                                            &addr.to_string(),
                                            &username,
                                            connection_config::ConnectionEvent::Requested,
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
                        connection_config::ConnectionEvent::Disconnected,
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
            let loaded_settings = settings::load(app.handle());
            *setup_max_connected_devices.lock().unwrap() = loaded_settings.max_connected_devices;
            *setup_accounts.lock().unwrap() = accounts::load_or_bootstrap(app.handle());
            *setup_blacklist.lock().unwrap() = connection_config::load_blacklist(app.handle());
            *setup_connection_history.lock().unwrap() = connection_config::load_history(app.handle());
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
            commands::server_command::server,
            commands::pricing_command::pricing,
            commands::order_command::order,
            commands::setting_command::settings,
            commands::auth_command::auth,
            commands::account_command::account,
            commands::file_command::file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
