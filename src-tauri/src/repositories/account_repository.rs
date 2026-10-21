use crate::infrastructure::filesystem::{config_file_path, read_json, write_json};
use crate::models::account::StoredAccount;
use tauri::AppHandle;

const ACCOUNTS_FILE_NAME: &str = "accounts.json";

pub fn load(app: &AppHandle) -> Vec<StoredAccount> {
    config_file_path(app, ACCOUNTS_FILE_NAME)
        .ok()
        .and_then(|path| read_json(&path))
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, accounts: &[StoredAccount]) -> Result<(), String> {
    write_json(&config_file_path(app, ACCOUNTS_FILE_NAME)?, accounts)
}
