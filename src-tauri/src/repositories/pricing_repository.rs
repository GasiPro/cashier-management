use crate::models::pricing::ServiceItem as PriceCalcServiceItem;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
const PRICING_FILE_NAME: &str = "pricing_matrix.json";
fn pricing_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(PRICING_FILE_NAME))
}
pub fn load(app: &AppHandle) -> Option<Vec<PriceCalcServiceItem>> {
    let path = pricing_file_path(app).ok()?;
    let raw = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&raw).ok()
}
pub fn save(app: &AppHandle, items: &[PriceCalcServiceItem]) -> Result<(), String> {
    let path = pricing_file_path(app)?;
    let raw = serde_json::to_string_pretty(items).map_err(|e| e.to_string())?;
    std::fs::write(&path, raw).map_err(|e| e.to_string())
}
