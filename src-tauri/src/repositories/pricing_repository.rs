use crate::infrastructure::filesystem::{config_file_path, read_json, write_json};
use crate::models::pricing::ServiceItem;
use tauri::AppHandle;

const PRICING_FILE_NAME: &str = "pricing_matrix.json";

pub fn load(app: &AppHandle) -> Option<Vec<ServiceItem>> {
    config_file_path(app, PRICING_FILE_NAME)
        .ok()
        .and_then(|path| read_json(&path))
}

pub fn save(app: &AppHandle, items: &[ServiceItem]) -> Result<(), String> {
    write_json(&config_file_path(app, PRICING_FILE_NAME)?, items)
}
