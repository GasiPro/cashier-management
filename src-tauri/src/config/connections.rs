use serde::{Deserialize, Deserializer, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicI64, Ordering};
use tauri::{AppHandle, Manager};
const BLACKLIST_FILE_NAME: &str = "connection_blacklist.json";
const HISTORY_FILE_NAME: &str = "connection_history.json";
pub const MAX_HISTORY_ENTRIES: usize = 200;
static NEXT_BLACKLIST_ID: AtomicI64 = AtomicI64::new(1);
static NEXT_HISTORY_ID: AtomicI64 = AtomicI64::new(1);
/// Monotonic id handed to blacklist entries. Ids are stable for the lifetime
/// of the process and persisted alongside the entry.
pub fn next_blacklist_id() -> i64 {
    NEXT_BLACKLIST_ID.fetch_add(1, Ordering::Relaxed)
}
fn bump_blacklist_id_floor(id: i64) {
    NEXT_BLACKLIST_ID.fetch_max(id + 1, Ordering::Relaxed);
}
/// Monotonic id handed to connection history entries.
pub fn next_history_id() -> i64 {
    NEXT_HISTORY_ID.fetch_add(1, Ordering::Relaxed)
}
fn bump_history_id_floor(id: i64) {
    NEXT_HISTORY_ID.fetch_max(id + 1, Ordering::Relaxed);
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlacklistType {
    Ip,
    Username,
}
#[derive(Debug, Clone, Serialize)]
pub struct BlacklistEntry {
    pub id: i64,
    #[serde(rename = "type")]
    pub entry_type: BlacklistType,
    pub value: String,
    pub reason: Option<String>,
    pub created_at: String,
}
/// Wire form used only to read the on-disk file. Entries written by older
/// builds only carry `addr`, so they are upgraded to `{ type: "ip", value }`
/// on load and given an id.
#[derive(Deserialize)]
struct RawBlacklistEntry {
    #[serde(default)]
    id: Option<i64>,
    #[serde(default, rename = "type")]
    entry_type: Option<BlacklistType>,
    #[serde(default)]
    value: Option<String>,
    #[serde(default)]
    addr: Option<String>,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    created_at: Option<String>,
}
impl<'de> Deserialize<'de> for BlacklistEntry {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = RawBlacklistEntry::deserialize(deserializer)?;
        let entry_type = raw.entry_type.unwrap_or(BlacklistType::Ip);
        let raw_value = raw.value.or(raw.addr).unwrap_or_default();
        let value = match entry_type {
            BlacklistType::Ip => ip_from_addr(&raw_value).to_string(),
            BlacklistType::Username => raw_value.trim().to_string(),
        };
        let id = match raw.id {
            Some(id) if id > 0 => id,
            _ => next_blacklist_id(),
        };
        bump_blacklist_id_floor(id);
        Ok(BlacklistEntry {
            id,
            entry_type,
            value,
            reason: raw.reason,
            created_at: raw
                .created_at
                .unwrap_or_else(|| chrono::Local::now().to_rfc3339()),
        })
    }
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
    #[serde(default)]
    pub id: i64,
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
    let mut entries: Vec<ConnectionHistoryEntry> = std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();
    for entry in entries.iter_mut() {
        if entry.id <= 0 {
            entry.id = next_history_id();
        }
        bump_history_id_floor(entry.id);
    }
    entries
}
pub fn save_history(app: &AppHandle, entries: &[ConnectionHistoryEntry]) -> Result<(), String> {
    let path = history_file_path(app)?;
    let raw = serde_json::to_string_pretty(entries).map_err(|e| e.to_string())?;
    std::fs::write(&path, raw).map_err(|e| e.to_string())
}
pub fn ip_from_addr(addr: &str) -> &str {
    addr.rsplit_once(':').map(|(ip, _)| ip).unwrap_or(addr)
}
pub fn port_from_addr(addr: &str) -> u16 {
    addr.rsplit_once(':')
        .and_then(|(_, port)| port.parse().ok())
        .unwrap_or(0)
}
/// IP-level blacklist check, enforced when a socket is accepted.
pub fn is_blacklisted(entries: &[BlacklistEntry], addr: &str) -> bool {
    let ip = ip_from_addr(addr);
    entries
        .iter()
        .any(|e| e.entry_type == BlacklistType::Ip && e.value == ip)
}
/// Username-level blacklist check, enforced when a counter authenticates.
pub fn is_username_blacklisted(entries: &[BlacklistEntry], username: &str) -> bool {
    let username = username.trim();
    entries.iter().any(|e| {
        e.entry_type == BlacklistType::Username && e.value.eq_ignore_ascii_case(username)
    })
}
pub fn value_exists(entries: &[BlacklistEntry], entry_type: BlacklistType, value: &str) -> bool {
    match entry_type {
        BlacklistType::Ip => is_blacklisted(entries, value),
        BlacklistType::Username => is_username_blacklisted(entries, value),
    }
}
pub fn remove_blacklist_entry(entries: &mut Vec<BlacklistEntry>, addr: &str) -> bool {
    let ip = ip_from_addr(addr);
    let len_before = entries.len();
    entries.retain(|e| !(e.entry_type == BlacklistType::Ip && e.value == ip));
    entries.len() != len_before
}
pub fn remove_blacklist_entry_by_id(entries: &mut Vec<BlacklistEntry>, id: i64) -> bool {
    let len_before = entries.len();
    entries.retain(|e| e.id != id);
    entries.len() != len_before
}
pub fn push_history_entry(entries: &mut Vec<ConnectionHistoryEntry>, entry: ConnectionHistoryEntry) {
    entries.push(entry);
    if entries.len() > MAX_HISTORY_ENTRIES {
        let overflow = entries.len() - MAX_HISTORY_ENTRIES;
        entries.drain(0..overflow);
    }
}
