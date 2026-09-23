
use crate::config::connections;
use crate::repositories::connection_repository;
use std::sync::{Arc, Mutex as SyncMutex};
use tauri::AppHandle;

/// Shared, in-memory blacklist and connection-history stores guarded by a
/// sync mutex, mirrored to disk through `repositories::connection_repository`.
///
/// Live peer/websocket concerns (approving, rejecting, or disconnecting an
/// already-connected device) stay with the websocket layer for now; this
/// service only owns the durable blacklist and history records.
pub type Blacklist = Arc<SyncMutex<Vec<connections::BlacklistEntry>>>;
pub type ConnectionHistory = Arc<SyncMutex<Vec<connections::ConnectionHistoryEntry>>>;

/// Append a connection-history entry (requested/approved/rejected/
/// disconnected/blocked) for `username`@`addr`, trimming the log to
/// `connections::MAX_HISTORY_ENTRIES`. Persistence failures are ignored, as
/// history is best-effort.
pub fn record_connection_history(
    history: &ConnectionHistory,
    app: Option<&AppHandle>,
    addr: &str,
    username: &str,
    event: connections::ConnectionEvent,
) {
    let mut guard = history.lock().unwrap();
    connections::push_history_entry(
        &mut guard,
        connections::ConnectionHistoryEntry {
            id: connections::next_history_id(),
            addr: addr.to_string(),
            username: username.to_string(),
            event,
            timestamp: chrono::Local::now().to_rfc3339(),
        },
    );
    if let Some(app) = app {
        let _ = connection_repository::save_history(app, &guard);
    }
}

/// The full connection-history log, oldest first.
pub fn list_connection_history(history: &ConnectionHistory) -> Vec<connections::ConnectionHistoryEntry> {
    history.lock().unwrap().clone()
}

/// The current blacklist entries.
pub fn list_blacklist_entries(blacklist: &Blacklist) -> Vec<connections::BlacklistEntry> {
    blacklist.lock().unwrap().clone()
}

/// Block an IP address (used when disconnecting/blocking a live peer):
/// returns the existing entry if already present, otherwise creates and
/// persists a new one.
pub async fn block_ip(app: &AppHandle, blacklist: &Blacklist, addr: &str, reason: Option<String>) -> Result<connections::BlacklistEntry, String> {
    let mut guard = blacklist.lock().unwrap();
    let ip = connections::ip_from_addr(addr).to_string();
    let existing = guard
        .iter()
        .find(|e| e.entry_type == connections::BlacklistType::Ip && e.value == ip)
        .cloned();
    if let Some(existing) = existing {
        return Ok(existing);
    }
    let entry = connections::BlacklistEntry {
        id: connections::next_blacklist_id(),
        entry_type: connections::BlacklistType::Ip,
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

/// Add a blacklist entry (IP or username) explicitly, e.g. from the
/// Réglages UI. Rejects duplicates and unknown entry types.
pub async fn add_blacklist_entry(
    app: &AppHandle,
    blacklist: &Blacklist,
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
    let mut guard = blacklist.lock().unwrap();
    if connections::value_exists(&guard, entry_type, &value) {
        return Err(match entry_type {
            connections::BlacklistType::Ip => "Cette adresse est déjà sur liste noire.".to_string(),
            connections::BlacklistType::Username => "Ce nom d'utilisateur est déjà sur liste noire.".to_string(),
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
    if let Err(err) = connection_repository::save_blacklist(app, &guard) {
        guard.pop();
        return Err(format!("Échec de l'enregistrement de la liste noire : {err}"));
    }
    Ok(entry)
}

/// Remove a blacklist entry by id, or by address when no id is given.
pub async fn remove_blacklist_entry(
    app: &AppHandle,
    blacklist: &Blacklist,
    id: Option<i64>,
    addr: Option<String>,
) -> Result<(), String> {
    let mut guard = blacklist.lock().unwrap();
    let snapshot = guard.clone();
    let removed = match (id, addr.as_deref()) {
        (Some(id), _) => connections::remove_blacklist_entry_by_id(&mut guard, id),
        (None, Some(addr)) => connections::remove_blacklist_entry(&mut guard, addr),
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
