use crate::config::{connections, settings};
use crate::{
    get_connected_devices_list, get_pending_requests_list, is_at_connected_devices_capacity,
    notify_cashier, optional_username, peer_label, record_connection_history, resolve_peer_addr,
    AppState, ConnectedDevice, PendingConnection, ServerMessage,
};
use serde::Deserialize;
use tauri::State;
use tokio_tungstenite::tungstenite::Message;

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
fn get_server_address() -> String {
    get_ws_address()
}
async fn approve_connection(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: Option<i64>,
    addr: Option<String>,
) -> Result<(), String> {
    let socket_addr = resolve_peer_addr(&state.peers, id, addr).await?;
    let addr = socket_addr.to_string();
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
            peer.connected_at = Some(chrono::Local::now().to_rfc3339());
            approved_username = peer.username.clone();
            let scoped = crate::scope_orders_for_peer(&orders, peer);
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
async fn reject_connection(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: Option<i64>,
    addr: Option<String>,
) -> Result<(), String> {
    let socket_addr = resolve_peer_addr(&state.peers, id, addr).await?;
    let addr = socket_addr.to_string();
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
async fn refuse_connection(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: Option<i64>,
    addr: Option<String>,
) -> Result<(), String> {
    reject_connection(app, state, id, addr).await
}
async fn disconnect_device(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: Option<i64>,
    addr: Option<String>,
) -> Result<(), String> {
    let socket_addr = resolve_peer_addr(&state.peers, id, addr).await?;
    let addr = socket_addr.to_string();
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
async fn list_pending_connections(state: State<'_, AppState>) -> Result<Vec<PendingConnection>, String> {
    Ok(get_pending_requests_list(&state.peers).await)
}
async fn list_connected_devices(state: State<'_, AppState>) -> Result<Vec<ConnectedDevice>, String> {
    Ok(get_connected_devices_list(&state.peers).await)
}
async fn block_device(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: Option<i64>,
    addr: Option<String>,
    reason: Option<String>,
) -> Result<connections::BlacklistEntry, String> {
    let socket_addr = resolve_peer_addr(&state.peers, id, addr).await?;
    let addr = socket_addr.to_string();
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
    let entry = {
        let mut guard = state.blacklist.lock().unwrap();
        let ip = connections::ip_from_addr(&addr).to_string();
        let existing = guard
            .iter()
            .find(|e| e.entry_type == connections::BlacklistType::Ip && e.value == ip)
            .cloned();
        match existing {
            Some(existing) => existing,
            None => {
                let entry = connections::BlacklistEntry {
                    id: connections::next_blacklist_id(),
                    entry_type: connections::BlacklistType::Ip,
                    value: ip,
                    reason,
                    created_at: chrono::Local::now().to_rfc3339(),
                };
                guard.push(entry.clone());
                if let Err(err) = connections::save_blacklist(&app, &guard) {
                    guard.pop();
                    return Err(format!("Échec de l'enregistrement de la liste noire : {err}"));
                }
                entry
            }
        }
    };
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
    Ok(entry)
}
#[derive(Debug, Clone, serde::Serialize)]
struct ConnectionHistoryView {
    id: i64,
    label: String,
    username: Option<String>,
    ip_address: String,
    event: &'static str,
    at: String,
}
fn history_event_label(event: connections::ConnectionEvent) -> &'static str {
    match event {
        connections::ConnectionEvent::Requested => "requested",
        connections::ConnectionEvent::Approved => "approved",
        connections::ConnectionEvent::Rejected => "refused",
        connections::ConnectionEvent::Disconnected => "disconnected",
        connections::ConnectionEvent::Blocked => "blocked",
    }
}
/// The connection lifecycle log (requested/approved/rejected/disconnected/
/// blocked), most recent last. Called from the cashier UI via invoke().
fn list_connection_history(state: State<'_, AppState>) -> Vec<ConnectionHistoryView> {
    state
        .connection_history
        .lock()
        .unwrap()
        .iter()
        .map(|entry| ConnectionHistoryView {
            id: entry.id,
            label: peer_label(&entry.username, &entry.addr),
            username: optional_username(&entry.username),
            ip_address: connections::ip_from_addr(&entry.addr).to_string(),
            event: history_event_label(entry.event),
            at: entry.timestamp.clone(),
        })
        .collect()
}
fn list_blacklist_entries(state: State<'_, AppState>) -> Vec<connections::BlacklistEntry> {
    state.blacklist.lock().unwrap().clone()
}
/// Add an address to the blacklist without needing an active connection to
/// block (unlike `block_device`). Called from the cashier UI via invoke().
async fn add_blacklist_entry(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    entry_type: Option<String>,
    value: Option<String>,
    addr: Option<String>,
    reason: Option<String>,
) -> Result<connections::BlacklistEntry, String> {
    let entry_type = match entry_type.as_deref().map(str::trim) {
        None | Some("") | Some("ip") => connections::BlacklistType::Ip,
        Some("username") => connections::BlacklistType::Username,
        Some(other) => return Err(format!("Type de liste noire inconnu : {other}.")),
    };
    let raw_value = value
        .or(addr)
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "La valeur à mettre sur liste noire est obligatoire.".to_string())?;
    let value = match entry_type {
        connections::BlacklistType::Ip => connections::ip_from_addr(&raw_value).to_string(),
        connections::BlacklistType::Username => raw_value,
    };
    let mut guard = state.blacklist.lock().unwrap();
    if connections::value_exists(&guard, entry_type, &value) {
        return Err(match entry_type {
            connections::BlacklistType::Ip => "Cette adresse est déjà sur liste noire.".to_string(),
            connections::BlacklistType::Username => {
                "Ce nom d'utilisateur est déjà sur liste noire.".to_string()
            }
        });
    }
    let entry = connections::BlacklistEntry {
        id: connections::next_blacklist_id(),
        entry_type,
        value,
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
async fn remove_blacklist_entry(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: Option<i64>,
    addr: Option<String>,
) -> Result<(), String> {
    let mut guard = state.blacklist.lock().unwrap();
    let snapshot = guard.clone();
    let removed = match (id, addr.as_deref()) {
        (Some(id), _) => connections::remove_blacklist_entry_by_id(&mut guard, id),
        (None, Some(addr)) => connections::remove_blacklist_entry(&mut guard, addr),
        (None, None) => return Err("Identifiant d'entrée manquant.".to_string()),
    };
    if !removed {
        return Err("Entrée introuvable sur liste noire.".to_string());
    }
    if let Err(err) = connections::save_blacklist(&app, &guard) {
        *guard = snapshot;
        return Err(format!("Échec de l'enregistrement de la liste noire : {err}"));
    }
    Ok(())
}
/// Current cap on connected comptoir devices (`0` = unlimited). Called from the
/// Réglages UI via invoke().
fn get_max_connected_devices(state: State<'_, AppState>) -> u32 {
    *state.max_connected_devices.lock().unwrap()
}
async fn get_connected_devices_count(state: State<'_, AppState>) -> Result<usize, String> {
    Ok(get_connected_devices_list(&state.peers).await.len())
}
/// Update the cap on connected comptoir devices. Persists to disk and takes effect
/// immediately for new connection requests; already-connected devices are left
/// untouched. Returns the value actually applied (clamped to a sane range).
async fn set_max_connected_devices(app: tauri::AppHandle, state: State<'_, AppState>, value: u32) -> Result<u32, String> {
    let clamped = settings::clamp_max_connected_devices(value);
    let mut current = settings::load(&app);
    current.max_connected_devices = clamped;
    settings::update(&app, current)
        .map_err(|err| format!("Échec de l'enregistrement du paramètre : {err}"))?;
    *state.max_connected_devices.lock().unwrap() = clamped;
    Ok(clamped)
}
/// Alias of `list_connection_history`, exposed under the consolidated
/// `server` command as method `devices.get_history`.
fn get_devices_history(state: State<'_, AppState>) -> Vec<ConnectionHistoryView> {
    list_connection_history(state)
}
#[derive(Debug, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case")]
enum ServerCommand {
    GetAddress,
    ConnectionApprove {
        id: Option<i64>,
        addr: Option<String>,
    },
    ConnectionReject {
        id: Option<i64>,
        addr: Option<String>,
    },
    ConnectionRefuse {
        id: Option<i64>,
        addr: Option<String>,
    },
    ConnectionListPending,
    ConnectionListConnected,
    ConnectionDisconnect {
        id: Option<i64>,
        addr: Option<String>,
    },
    ConnectionBlock {
        id: Option<i64>,
        addr: Option<String>,
        reason: Option<String>,
    },
    ConnectionHistory,
    ConnectionBlacklistList,
    ConnectionBlacklistAdd {
        entry_type: Option<String>,
        value: Option<String>,
        addr: Option<String>,
        reason: Option<String>,
    },
    ConnectionBlacklistRemove {
        id: Option<i64>,
        addr: Option<String>,
    },
    DevicesMaxGet,
    DevicesMaxSet {
        value: u32,
    },
    DevicesCount,
    DevicesGetHistory,
}
#[tauri::command]
pub async fn server(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    command: ServerCommand,
) -> Result<serde_json::Value, String> {
    match command {
        ServerCommand::GetAddress => Ok(serde_json::json!(get_server_address())),
        ServerCommand::ConnectionApprove { id, addr } => {
            approve_connection(app, state, id, addr).await?;
            Ok(serde_json::Value::Null)
        }
        ServerCommand::ConnectionReject { id, addr } => {
            reject_connection(app, state, id, addr).await?;
            Ok(serde_json::Value::Null)
        }
        ServerCommand::ConnectionRefuse { id, addr } => {
            refuse_connection(app, state, id, addr).await?;
            Ok(serde_json::Value::Null)
        }
        ServerCommand::ConnectionListPending => {
            Ok(serde_json::json!(list_pending_connections(state).await?))
        }
        ServerCommand::ConnectionListConnected => {
            Ok(serde_json::json!(list_connected_devices(state).await?))
        }
        ServerCommand::ConnectionDisconnect { id, addr } => {
            disconnect_device(app, state, id, addr).await?;
            Ok(serde_json::Value::Null)
        }
        ServerCommand::ConnectionBlock { id, addr, reason } => {
            Ok(serde_json::json!(block_device(app, state, id, addr, reason).await?))
        }
        ServerCommand::ConnectionHistory => Ok(serde_json::json!(list_connection_history(state))),
        ServerCommand::ConnectionBlacklistList => {
            Ok(serde_json::json!(list_blacklist_entries(state)))
        }
        ServerCommand::ConnectionBlacklistAdd {
            entry_type,
            value,
            addr,
            reason,
        } => Ok(serde_json::json!(
            add_blacklist_entry(app, state, entry_type, value, addr, reason).await?
        )),
        ServerCommand::ConnectionBlacklistRemove { id, addr } => {
            remove_blacklist_entry(app, state, id, addr).await?;
            Ok(serde_json::Value::Null)
        }
        ServerCommand::DevicesMaxGet => Ok(serde_json::json!(get_max_connected_devices(state))),
        ServerCommand::DevicesMaxSet { value } => {
            Ok(serde_json::json!(set_max_connected_devices(app, state, value).await?))
        }
        ServerCommand::DevicesCount => {
            Ok(serde_json::json!(get_connected_devices_count(state).await?))
        }
        ServerCommand::DevicesGetHistory => Ok(serde_json::json!(get_devices_history(state))),
    }
}
