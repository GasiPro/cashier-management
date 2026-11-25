use crate::config::setting_config::{
    DEFAULT_BACKGROUND_COLOR, DEFAULT_DATE_FORMAT, DEFAULT_FONT_SIZE, DEFAULT_MAX_CONNECTED_DEVICES,
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
pub struct Organization {
    pub name: String,
    pub email: String,
    pub phone: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    pub max_connected_devices: u32,
    pub mode: Option<AppMode>,
    pub organization: Option<Organization>,
    pub product_key: String,
    pub activated: bool,
    pub users: HashMap<String, DisplayPrefs>,
    pub datetime: DateTimeSettings,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DateTimeSettings {
    pub auto: bool,
    pub timezone: String,
    pub hour12: bool,
    pub date_format: String,
    pub offset_secs: i64,
    pub utc_offset_secs: i32,
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
            organization: None,
            product_key: String::new(),
            activated: false,
            users: HashMap::new(),
            datetime: DateTimeSettings::default(),
        }
    }
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DateTimeSync {
    pub settings: DateTimeSettings,
    pub server_ms: i64,
}
impl Default for DateTimeSettings {
    fn default() -> Self {
        Self {
            auto: true,
            timezone: String::new(),
            hour12: false,
            date_format: DEFAULT_DATE_FORMAT.to_string(),
            offset_secs: 0,
            utc_offset_secs: 0,
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
