use crate::config::setting_config::{clamp_font_size, clamp_max_connected_devices};
use crate::models::setting::{AppSettings, Theme};
use crate::repositories::setting_repository;
use std::sync::{Arc, Mutex as SyncMutex};
use tauri::AppHandle;

pub type MaxConnectedDevices = Arc<SyncMutex<u32>>;

static SETTINGS_LOCK: SyncMutex<()> = SyncMutex::new(());

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

fn update_settings(app: &AppHandle, change: impl FnOnce(&mut AppSettings)) -> Result<(), String> {
    let _guard = SETTINGS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut current = setting_repository::load(app);
    change(&mut current);
    setting_repository::save(app, &current)
}

fn validate_background_color(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    let digits = trimmed.strip_prefix('#').unwrap_or("");
    if digits.len() == 6 && digits.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(trimmed.to_string())
    } else {
        Err(format!("Couleur invalide: {value}"))
    }
}

pub async fn set_background_color(app: &AppHandle, value: String) -> Result<String, String> {
    let color = validate_background_color(&value)?;
    update_settings(app, |settings| settings.background_color = color.clone())?;
    Ok(color)
}

pub async fn set_font_size(app: &AppHandle, value: u32) -> Result<u32, String> {
    let clamped = clamp_font_size(value);
    update_settings(app, |settings| settings.font_size = clamped)?;
    Ok(clamped)
}

pub async fn set_theme(app: &AppHandle, value: String) -> Result<String, String> {
    let theme = Theme::from_str(&value)?;
    update_settings(app, |settings| settings.theme = theme.clone())?;
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
    update_settings(app, |settings| settings.max_connected_devices = clamped)
        .map_err(|err| format!("Échec de l'enregistrement du paramètre : {err}"))?;
    *max_connected_devices.lock().unwrap() = clamped;
    Ok(clamped)
}
