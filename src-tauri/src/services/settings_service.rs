
use crate::config::settings::{self, Theme};
use crate::repositories::settings_repository;
use std::sync::{Arc, Mutex as SyncMutex};
use tauri::AppHandle;

/// Live cache of the current connected-device cap, kept in sync with the
/// persisted settings file so it can be read without a disk round-trip.
pub type MaxConnectedDevices = Arc<SyncMutex<u32>>;

pub fn get_theme(app: &AppHandle) -> String {
    settings_repository::load(app).theme.as_str().to_string()
}

pub fn get_background_color(app: &AppHandle) -> String {
    settings_repository::load(app).background_color
}

pub fn get_font_size(app: &AppHandle) -> u32 {
    settings_repository::load(app).font_size
}

pub async fn set_background_color(app: &AppHandle, value: String) -> Result<String, String> {
    let mut current = settings_repository::load(app);
    current.background_color = value.clone();
    settings_repository::save(app, &current)?;
    Ok(value)
}

pub async fn set_font_size(app: &AppHandle, value: u32) -> Result<u32, String> {
    let clamped = settings::clamp_font_size(value);
    let mut current = settings_repository::load(app);
    current.font_size = clamped;
    settings_repository::save(app, &current)?;
    Ok(clamped)
}

pub async fn set_theme(app: &AppHandle, value: String) -> Result<String, String> {
    let theme = Theme::from_str(&value)?;
    let mut current = settings_repository::load(app);
    current.theme = theme.clone();
    settings_repository::save(app, &current)?;
    Ok(theme.as_str().to_string())
}

/// Current cap on connected comptoir devices (`0` = unlimited).
pub fn get_max_connected_devices(max_connected_devices: &MaxConnectedDevices) -> u32 {
    *max_connected_devices.lock().unwrap()
}

/// Update the cap on connected comptoir devices. Persists to disk and takes
/// effect immediately for new connection requests; already-connected
/// devices are left untouched. Returns the value actually applied (clamped
/// to a sane range).
pub async fn set_max_connected_devices(
    app: &AppHandle,
    max_connected_devices: &MaxConnectedDevices,
    value: u32,
) -> Result<u32, String> {
    let clamped = settings::clamp_max_connected_devices(value);
    let mut current = settings_repository::load(app);
    current.max_connected_devices = clamped;
    settings_repository::save(app, &current)
        .map_err(|err| format!("Échec de l'enregistrement du paramètre : {err}"))?;
    *max_connected_devices.lock().unwrap() = clamped;
    Ok(clamped)
}
