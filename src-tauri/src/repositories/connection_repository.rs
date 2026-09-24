use crate::models::connection::{
    bump_history_id_floor, next_history_id, BlacklistEntry, ConnectionHistoryEntry,
};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
const BLACKLIST_FILE_NAME: &str = "connection_blacklist.json";
const HISTORY_FILE_NAME: &str = "connection_history.json";
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
