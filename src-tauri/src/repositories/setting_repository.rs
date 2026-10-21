use crate::infrastructure::filesystem::{config_file_path, read_json, write_json};
use crate::models::setting::AppSettings;
use tauri::AppHandle;

const SETTINGS_FILE_NAME: &str = "settings.json";

pub fn load(app: &AppHandle) -> AppSettings {
    config_file_path(app, SETTINGS_FILE_NAME)
        .ok()
        .and_then(|path| read_json(&path))
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    write_json(&config_file_path(app, SETTINGS_FILE_NAME)?, settings)
}
