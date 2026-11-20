use crate::config::setting_config::{
    DEFAULT_BACKGROUND_COLOR, DEFAULT_FONT_SIZE, DEFAULT_MAX_CONNECTED_DEVICES,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AppMode {
    Caisse,
    Comptoir,
}
impl AppMode {
    pub fn from_str(value: &str) -> Result<Self, String> {
        match value {
            "caisse" => Ok(AppMode::Caisse),
            "comptoir" => Ok(AppMode::Comptoir),
            _ => Err(format!("Mode invalide: {value}")),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    pub max_connected_devices: u32,
    pub mode: Option<AppMode>,
    pub product_key: String,
    pub activated: bool,
    pub users: HashMap<String, DisplayPrefs>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct DisplayPrefs {
    pub background_color: String,
    pub font_size: u32,
    pub theme: Theme,
}
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
impl Default for AppSettings {
    fn default() -> Self {
        Self {
            max_connected_devices: DEFAULT_MAX_CONNECTED_DEVICES,
            mode: None,
            product_key: String::new(),
            activated: false,
            users: HashMap::new(),
        }
    }
}
impl Default for DisplayPrefs {
    fn default() -> Self {
        Self {
            background_color: DEFAULT_BACKGROUND_COLOR.to_string(),
            font_size: DEFAULT_FONT_SIZE,
            theme: Theme::default(),
        }
    }
}
