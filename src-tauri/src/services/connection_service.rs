use crate::domain::connection::{
    self, optional_username, peer_label,
};
use crate::infrastructure::websocket::{
    get_connected_devices_list, get_pending_requests_list, is_at_connected_devices_capacity,
    notify_cashier, resolve_peer_addr, scope_orders_for_peer, PeerMap,
};
use crate::models::connection::{
    ip_from_addr, next_blacklist_id, next_history_id, BlacklistEntry, BlacklistType,
    ConnectionEvent, ConnectionHistoryEntry, ConnectionHistoryView, ServerMessage,
};
use crate::models::order::Order;
use crate::repositories::connection_repository;
use crate::services::setting_service::MaxConnectedDevices;
use std::sync::{Arc, Mutex as SyncMutex};
use tauri::AppHandle;
use tokio_tungstenite::tungstenite::Message;

pub type Blacklist = Arc<SyncMutex<Vec<BlacklistEntry>>>;
pub type ConnectionHistory = Arc<SyncMutex<Vec<ConnectionHistoryEntry>>>;

pub fn load_blacklist(app: &AppHandle) -> Vec<BlacklistEntry> {
    connection_repository::load_blacklist(app)
}

pub fn load_history(app: &AppHandle) -> Vec<ConnectionHistoryEntry> {
    connection_repository::load_history(app)
}

pub fn record_connection_history(
    history: &ConnectionHistory,
    app: Option<&AppHandle>,
    addr: &str,
    username: &str,
    event: ConnectionEvent,
) {
    let mut guard = history.lock().unwrap();
    connection::push_history_entry(
        &mut guard,
        ConnectionHistoryEntry {
            id: next_history_id(),
            addr: addr.to_string(),
            username: username.to_string(),
            event,
            timestamp: chrono::Local::now().to_rfc3339(),
        },
    );
    if let Some(app) = app {
        if let Err(err) = connection_repository::save_history(app, &guard) {
            log::error!("Échec de l'enregistrement de l'historique des connexions : {err}");
        }
    }
}

fn history_event_label(event: ConnectionEvent) -> &'static str {
    match event {
        ConnectionEvent::Requested => "requested",
        ConnectionEvent::Approved => "approved",
        ConnectionEvent::Rejected => "refused",
        ConnectionEvent::Disconnected => "disconnected",
        ConnectionEvent::Blocked => "blocked",
    }
}

pub fn list_connection_history(history: &ConnectionHistory) -> Vec<ConnectionHistoryView> {
    history
        .lock()
        .unwrap()
        .iter()
        .map(|entry| ConnectionHistoryView {
            id: entry.id,
            label: peer_label(&entry.username, &entry.addr),
            username: optional_username(&entry.username),
            ip_address: ip_from_addr(&entry.addr).to_string(),
            event: history_event_label(entry.event),
            at: entry.timestamp.clone(),
        })
        .collect()
}

pub fn list_blacklist_entries(blacklist: &Blacklist) -> Vec<BlacklistEntry> {
    blacklist.lock().unwrap().clone()
}

pub async fn approve_connection(
    app: &AppHandle,
    peers: &PeerMap,
    max_connected_devices: &MaxConnectedDevices,
    history: &ConnectionHistory,
    orders: Vec<Order>,
    id: Option<i64>,
    addr: Option<String>,
) -> Result<(), String> {
    let socket_addr = resolve_peer_addr(peers, id, addr).await?;
    let addr = socket_addr.to_string();
    if is_at_connected_devices_capacity(peers, max_connected_devices).await {
        let max = *max_connected_devices.lock().unwrap();
        return Err(format!(
            "Limite de {max} appareil(s) connecté(s) atteinte. Déconnectez un appareil ou augmentez la limite dans Réglages."
        ));
    }
    let mut approved_username = String::new();
    {
        let mut guard = peers.lock().await;
        if let Some(peer) = guard.get_mut(&socket_addr) {
            peer.approved = true;
            peer.connected_at = Some(chrono::Local::now().to_rfc3339());
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
    record_connection_history(history, Some(app), &addr, &approved_username, ConnectionEvent::Approved);
    let pending = get_pending_requests_list(peers).await;
    let connected = get_connected_devices_list(peers).await;
    notify_cashier(peers, &ServerMessage::ConnectionRequests { data: pending }).await;
    notify_cashier(peers, &ServerMessage::ConnectedDevices { data: connected }).await;
    Ok(())
}

pub async fn reject_connection(
    app: &AppHandle,
    peers: &PeerMap,
    history: &ConnectionHistory,
    id: Option<i64>,
    addr: Option<String>,
) -> Result<(), String> {
    let socket_addr = resolve_peer_addr(peers, id, addr).await?;
    let addr = socket_addr.to_string();
    let mut rejected_username = String::new();
    {
        let mut guard = peers.lock().await;
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
    record_connection_history(history, Some(app), &addr, &rejected_username, ConnectionEvent::Rejected);
    let pending = get_pending_requests_list(peers).await;
    notify_cashier(peers, &ServerMessage::ConnectionRequests { data: pending }).await;
    Ok(())
}

pub async fn disconnect_device(
    app: &AppHandle,
    peers: &PeerMap,
    history: &ConnectionHistory,
    id: Option<i64>,
    addr: Option<String>,
) -> Result<(), String> {
    let socket_addr = resolve_peer_addr(peers, id, addr).await?;
    let addr = socket_addr.to_string();
    let mut disconnected_username = String::new();
    {
        let mut guard = peers.lock().await;
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
    record_connection_history(history, Some(app), &addr, &disconnected_username, ConnectionEvent::Disconnected);
    let connected = get_connected_devices_list(peers).await;
    notify_cashier(peers, &ServerMessage::ConnectedDevices { data: connected }).await;
    Ok(())
}

pub async fn block_device(
    app: &AppHandle,
    peers: &PeerMap,
    blacklist: &Blacklist,
    history: &ConnectionHistory,
    id: Option<i64>,
    addr: Option<String>,
    reason: Option<String>,
) -> Result<BlacklistEntry, String> {
    let socket_addr = resolve_peer_addr(peers, id, addr).await?;
    let addr = socket_addr.to_string();
    let mut blocked_username = String::new();
    {
        let mut guard = peers.lock().await;
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
    let entry = block_ip(app, blacklist, &addr, reason).await?;
    record_connection_history(history, Some(app), &addr, &blocked_username, ConnectionEvent::Blocked);
    let pending = get_pending_requests_list(peers).await;
    let connected = get_connected_devices_list(peers).await;
    notify_cashier(peers, &ServerMessage::ConnectionRequests { data: pending }).await;
    notify_cashier(peers, &ServerMessage::ConnectedDevices { data: connected }).await;
    Ok(entry)
}

pub async fn block_ip(
    app: &AppHandle,
    blacklist: &Blacklist,
    addr: &str,
    reason: Option<String>,
) -> Result<BlacklistEntry, String> {
    let mut guard = blacklist.lock().unwrap();
    let ip = ip_from_addr(addr).to_string();
    let existing = guard
        .iter()
        .find(|e| e.entry_type == BlacklistType::Ip && e.value == ip)
        .cloned();
    if let Some(existing) = existing {
        return Ok(existing);
    }
    let entry = BlacklistEntry {
        id: next_blacklist_id(),
        entry_type: BlacklistType::Ip,
        value: ip,
        reason,
        created_at: chrono::Local::now().to_rfc3339(),
    };
    guard.push(entry.clone());
    if let Err(err) = connection_repository::save_blacklist(app, &guard) {
        guard.pop();
        return Err(format!("Échec de l'enregistrement de la liste noire : {err}"));
    }
    Ok(entry)
}

pub async fn add_blacklist_entry(
    app: &AppHandle,
    blacklist: &Blacklist,
    entry_type: Option<String>,
    value: Option<String>,
    addr: Option<String>,
    reason: Option<String>,
) -> Result<BlacklistEntry, String> {
    let entry_type = match entry_type.as_deref().map(str::trim) {
        None | Some("") | Some("ip") => BlacklistType::Ip,
        Some("username") => BlacklistType::Username,
        Some(other) => return Err(format!("Type de liste noire inconnu : {other}.")),
    };
    let raw_value = value
        .or(addr)
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "La valeur à mettre sur liste noire est obligatoire.".to_string())?;
    let value = match entry_type {
        BlacklistType::Ip => ip_from_addr(&raw_value).to_string(),
        BlacklistType::Username => raw_value,
    };
    let mut guard = blacklist.lock().unwrap();
    if connection::value_exists(&guard, entry_type, &value) {
        return Err(match entry_type {
            BlacklistType::Ip => "Cette adresse est déjà sur liste noire.".to_string(),
            BlacklistType::Username => "Ce nom d'utilisateur est déjà sur liste noire.".to_string(),
        });
    }
    let entry = BlacklistEntry {
        id: next_blacklist_id(),
        entry_type,
        value,
        reason,
        created_at: chrono::Local::now().to_rfc3339(),
    };
    guard.push(entry.clone());
    if let Err(err) = connection_repository::save_blacklist(app, &guard) {
        guard.pop();
        return Err(format!("Échec de l'enregistrement de la liste noire : {err}"));
    }
    Ok(entry)
}

pub async fn remove_blacklist_entry(
    app: &AppHandle,
    blacklist: &Blacklist,
    id: Option<i64>,
    addr: Option<String>,
) -> Result<(), String> {
    let mut guard = blacklist.lock().unwrap();
    let snapshot = guard.clone();
    let removed = match (id, addr.as_deref()) {
        (Some(id), _) => connection::remove_blacklist_entry_by_id(&mut guard, id),
        (None, Some(addr)) => connection::remove_blacklist_entry(&mut guard, addr),
        (None, None) => return Err("Identifiant d'entrée manquant.".to_string()),
    };
    if !removed {
        return Err("Entrée introuvable sur liste noire.".to_string());
    }
    if let Err(err) = connection_repository::save_blacklist(app, &guard) {
        *guard = snapshot;
        return Err(format!("Échec de l'enregistrement de la liste noire : {err}"));
    }
    Ok(())
}
