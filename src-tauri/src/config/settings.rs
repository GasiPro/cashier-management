//! Persisted application settings (as opposed to `pricing_matrix`, which is
//! compiled-in and never changes at runtime).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Upper bound accepted from the settings UI. Not a technical limitation — just a
/// sane ceiling so a mistyped value can't produce something unmanageable.
pub const MAX_ALLOWED_CONNECTED_DEVICES: u32 = 50;
/// Applied the first time the app runs, before any settings file exists on disk.
pub const DEFAULT_MAX_CONNECTED_DEVICES: u32 = 10;

const SETTINGS_FILE_NAME: &str = "settings.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    /// Maximum number of comptoir (counter) devices allowed to be connected to the
    /// cashier at the same time. `0` means unlimited.
    #[serde(default = "default_max_connected_devices")]
    pub max_connected_devices: u32,
}

fn default_max_connected_devices() -> u32 {
    DEFAULT_MAX_CONNECTED_DEVICES
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            max_connected_devices: DEFAULT_MAX_CONNECTED_DEVICES,
        }
    }
}

/// Keeps a requested value within the range accepted by the settings UI.
pub fn clamp_max_connected_devices(value: u32) -> u32 {
    value.min(MAX_ALLOWED_CONNECTED_DEVICES)
}

fn settings_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(SETTINGS_FILE_NAME))
}

/// Loads settings from disk. Falls back to defaults if the file is missing,
/// unreadable, or malformed — a broken or absent settings file should never stop
/// the app from starting.
pub fn load(app: &AppHandle) -> AppSettings {
    let Ok(path) = settings_file_path(app) else {
        return AppSettings::default();
    };
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// Persists settings to disk.
pub fn save(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_file_path(app)?;
    let raw = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, raw).map_err(|e| e.to_string())
}
