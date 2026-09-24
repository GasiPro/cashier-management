use serde::{Deserialize, Serialize};

pub const MAX_ALLOWED_CONNECTED_DEVICES: u32 = 50;
pub const DEFAULT_MAX_CONNECTED_DEVICES: u32 = 10;
pub const DEFAULT_BACKGROUND_COLOR: &str = "#FFFFFF";
pub const DEFAULT_FONT_SIZE: u32 = 14;
pub const DEFAULT_THEME: Theme = Theme::Light;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    #[serde(default = "default_max_connected_devices")]
    pub max_connected_devices: u32,
    #[serde(default = "default_background_color")]
    pub background_color: String,
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    #[serde(default = "default_theme")]
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
