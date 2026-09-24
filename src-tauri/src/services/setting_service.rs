use crate::config::setting_config::{clamp_font_size, clamp_max_connected_devices};
use crate::models::setting::{AppSettings, Theme};
use crate::repositories::setting_repository;
use std::sync::{Arc, Mutex as SyncMutex};
use tauri::AppHandle;
pub type MaxConnectedDevices = Arc<SyncMutex<u32>>;
pub fn load_settings(app: &AppHandle) -> AppSettings {
    setting_repository::load(app)
}
pub fn get_theme(app: &AppHandle) -> String {
    setting_repository::load(app).theme.as_str().to_string()
}
pub fn get_background_color(app: &AppHandle) -> String {
    setting_repository::load(app).background_color
}
pub fn get_font_size(app: &AppHandle) -> u32 {
    setting_repository::load(app).font_size
}
pub async fn set_background_color(app: &AppHandle, value: String) -> Result<String, String> {
    let mut current = setting_repository::load(app);
    current.background_color = value.clone();
    setting_repository::save(app, &current)?;
    Ok(value)
}
pub async fn set_font_size(app: &AppHandle, value: u32) -> Result<u32, String> {
    let clamped = clamp_font_size(value);
    let mut current = setting_repository::load(app);
    current.font_size = clamped;
    setting_repository::save(app, &current)?;
    Ok(clamped)
}
pub async fn set_theme(app: &AppHandle, value: String) -> Result<String, String> {
    let theme = Theme::from_str(&value)?;
    let mut current = setting_repository::load(app);
    current.theme = theme.clone();
    setting_repository::save(app, &current)?;
    Ok(theme.as_str().to_string())
}
pub fn get_max_connected_devices(max_connected_devices: &MaxConnectedDevices) -> u32 {
    *max_connected_devices.lock().unwrap()
}
pub async fn set_max_connected_devices(
    app: &AppHandle,
    max_connected_devices: &MaxConnectedDevices,
    value: u32,
) -> Result<u32, String> {
    let clamped = clamp_max_connected_devices(value);
    let mut current = setting_repository::load(app);
    current.max_connected_devices = clamped;
    setting_repository::save(app, &current)
        .map_err(|err| format!("Échec de l'enregistrement du paramètre : {err}"))?;
    *max_connected_devices.lock().unwrap() = clamped;
    Ok(clamped)
}
