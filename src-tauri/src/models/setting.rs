use crate::config::setting_config::{
    DEFAULT_BACKGROUND_COLOR, DEFAULT_FONT_SIZE, DEFAULT_MAX_CONNECTED_DEVICES,
};
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    pub max_connected_devices: u32,
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
            background_color: DEFAULT_BACKGROUND_COLOR.to_string(),
            font_size: DEFAULT_FONT_SIZE,
            theme: Theme::default(),
        }
    }
}
