use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
const BLACKLIST_FILE_NAME: &str = "connection_blacklist.json";
const HISTORY_FILE_NAME: &str = "connection_history.json";
pub const MAX_HISTORY_ENTRIES: usize = 200;
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlacklistEntry {
    pub addr: String,
    pub reason: Option<String>,
    pub created_at: String,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionEvent {
    Requested,
    Approved,
    Rejected,
    Disconnected,
    Blocked,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionHistoryEntry {
    pub addr: String,
    pub username: String,
    pub event: ConnectionEvent,
    pub timestamp: String,
}
fn blacklist_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(BLACKLIST_FILE_NAME))
}
fn history_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(HISTORY_FILE_NAME))
}
pub fn load_blacklist(app: &AppHandle) -> Vec<BlacklistEntry> {
    let Ok(path) = blacklist_file_path(app) else {
        return Vec::new();
    };
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}
pub fn save_blacklist(app: &AppHandle, entries: &[BlacklistEntry]) -> Result<(), String> {
    let path = blacklist_file_path(app)?;
    let raw = serde_json::to_string_pretty(entries).map_err(|e| e.to_string())?;
    std::fs::write(&path, raw).map_err(|e| e.to_string())
}
pub fn load_history(app: &AppHandle) -> Vec<ConnectionHistoryEntry> {
    let Ok(path) = history_file_path(app) else {
        return Vec::new();
    };
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}
pub fn save_history(app: &AppHandle, entries: &[ConnectionHistoryEntry]) -> Result<(), String> {
    let path = history_file_path(app)?;
    let raw = serde_json::to_string_pretty(entries).map_err(|e| e.to_string())?;
    std::fs::write(&path, raw).map_err(|e| e.to_string())
}
/// Extracts just the IP portion of an `"ip:port"` address string, falling
/// back to the whole string when there's no port. Devices reconnect with a
/// new ephemeral port each time, so blacklist matching is done on IP only.
pub fn ip_from_addr(addr: &str) -> &str {
    addr.rsplit_once(':').map(|(ip, _)| ip).unwrap_or(addr)
}
pub fn is_blacklisted(entries: &[BlacklistEntry], addr: &str) -> bool {
    let ip = ip_from_addr(addr);
    entries.iter().any(|e| ip_from_addr(&e.addr) == ip)
}
pub fn remove_blacklist_entry(entries: &mut Vec<BlacklistEntry>, addr: &str) -> bool {
    let ip = ip_from_addr(addr);
    let len_before = entries.len();
    entries.retain(|e| ip_from_addr(&e.addr) != ip);
    entries.len() != len_before
}
/// Appends a history entry, trimming the oldest ones once the log exceeds
/// `MAX_HISTORY_ENTRIES` so the on-disk log doesn't grow unbounded.
pub fn push_history_entry(entries: &mut Vec<ConnectionHistoryEntry>, entry: ConnectionHistoryEntry) {
    entries.push(entry);
    if entries.len() > MAX_HISTORY_ENTRIES {
        let overflow = entries.len() - MAX_HISTORY_ENTRIES;
        entries.drain(0..overflow);
    }
}
