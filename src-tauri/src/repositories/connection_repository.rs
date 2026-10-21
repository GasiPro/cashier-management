use crate::infrastructure::filesystem::{config_file_path, read_json, write_json};
use crate::models::connection::{
    bump_history_id_floor, next_history_id, BlacklistEntry, ConnectionHistoryEntry,
};
use tauri::AppHandle;

const BLACKLIST_FILE_NAME: &str = "connection_blacklist.json";
const HISTORY_FILE_NAME: &str = "connection_history.json";

pub fn load_blacklist(app: &AppHandle) -> Vec<BlacklistEntry> {
    config_file_path(app, BLACKLIST_FILE_NAME)
        .ok()
        .and_then(|path| read_json(&path))
        .unwrap_or_default()
}

pub fn save_blacklist(app: &AppHandle, entries: &[BlacklistEntry]) -> Result<(), String> {
    write_json(&config_file_path(app, BLACKLIST_FILE_NAME)?, entries)
}

pub fn load_history(app: &AppHandle) -> Vec<ConnectionHistoryEntry> {
    let mut entries: Vec<ConnectionHistoryEntry> = config_file_path(app, HISTORY_FILE_NAME)
        .ok()
        .and_then(|path| read_json(&path))
        .unwrap_or_default();
    bump_history_id_floor(entries.iter().map(|e| e.id).max().unwrap_or(0));
    for entry in entries.iter_mut().filter(|e| e.id <= 0) {
        entry.id = next_history_id();
    }
    entries
}

pub fn save_history(app: &AppHandle, entries: &[ConnectionHistoryEntry]) -> Result<(), String> {
    write_json(&config_file_path(app, HISTORY_FILE_NAME)?, entries)
}
