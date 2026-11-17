use crate::infrastructure::filesystem::{config_file_path, read_json, write_json};
use crate::models::stock::StockData;
use tauri::AppHandle;

const STOCKS_FILE_NAME: &str = "stocks.bin";

pub fn load(app: &AppHandle) -> StockData {
    config_file_path(app, STOCKS_FILE_NAME)
        .ok()
        .and_then(|path| read_json(&path))
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, data: &StockData) -> Result<(), String> {
    write_json(&config_file_path(app, STOCKS_FILE_NAME)?, data)
}
