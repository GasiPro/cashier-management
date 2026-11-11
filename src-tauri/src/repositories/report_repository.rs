use crate::infrastructure::filesystem::{config_file_path, read_json, write_json};
use crate::models::report::Report;
use tauri::AppHandle;

const REPORTS_FILE_NAME: &str = "reports.bin";

pub fn load(app: &AppHandle) -> Vec<Report> {
    config_file_path(app, REPORTS_FILE_NAME)
        .ok()
        .and_then(|path| read_json(&path))
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, reports: &[Report]) -> Result<(), String> {
    write_json(&config_file_path(app, REPORTS_FILE_NAME)?, reports)
}
