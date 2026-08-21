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
pub const DEFAULT_BACKGROUND_COLOR: &str = "#FFFFFF";
pub const DEFAULT_FONT_SIZE: u32 = 14;
pub const DEFAULT_THEME: Theme = Theme::Light;

const SETTINGS_FILE_NAME: &str = "settings.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    /// Maximum number of comptoir (counter) devices allowed to be connected to the
    /// cashier at the same time. `0` means unlimited.
    #[serde(default = "default_max_connected_devices")]
    pub max_connected_devices: u32,
    #[serde(default = "default_background_color")]
    pub background_color: String,  // e.g. hex
    #[serde(default = "default_font_size")]
    pub font_size: u32,            // or an enum: Small/Medium/Large
    #[serde(default = "default_theme")]
    pub theme: Theme,              // "light" | "dark" | "custom"
}



// Apply theme
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash, Default)]
pub enum Theme {
    #[default]
    Light,
    Dark,
    System,
}
impl Theme {
    pub fn as_str(&self) -> &'static str {
        match self {
            Theme::Light => "clair",
            Theme::Dark => "sombre",
            Theme::System => "systeme",
        }
    }
    pub fn from_str(value: &str) -> Result<Self, String> {
        match value {
            "clair" => Ok(Theme::Light),
            "sombre" => Ok(Theme::Dark),
            "systeme" => Ok(Theme::System),
            _ => Err(format!("Thème invalide: {value}")),
        }
    }
}




fn default_max_connected_devices() -> u32 {
    DEFAULT_MAX_CONNECTED_DEVICES
}
fn default_background_color() -> String {
    DEFAULT_BACKGROUND_COLOR.to_string()
}
fn default_font_size() -> u32 {
    DEFAULT_FONT_SIZE
}
fn default_theme() -> Theme {
    DEFAULT_THEME
}

// Set default values
impl Default for AppSettings {
    fn default() -> Self {
        Self {
            max_connected_devices: DEFAULT_MAX_CONNECTED_DEVICES,
            background_color: DEFAULT_BACKGROUND_COLOR.to_string(),
            font_size: DEFAULT_FONT_SIZE,
            theme: DEFAULT_THEME,
        }
    }
}

/// Keeps a requested value within the range accepted by the settings UI.
pub fn clamp_max_connected_devices(value: u32) -> u32 {
    value.min(MAX_ALLOWED_CONNECTED_DEVICES)
}
pub fn clamp_font_size(value: u32) -> u32 {
    value.clamp(8, 32)
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

/// Update settings
pub fn update(app: &AppHandle, new_settings: AppSettings) -> Result<(), String> {
    save(app, &new_settings)
}