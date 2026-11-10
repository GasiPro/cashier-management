use crate::config::setting_config::{clamp_font_size, clamp_max_connected_devices, PRODUCT_KEY};
use crate::models::account::UserType;
use crate::models::setting::{AppSettings, DisplayPrefs, Theme};
use crate::repositories::setting_repository;
use std::sync::{Arc, Mutex as SyncMutex};
use tauri::AppHandle;
pub type MaxConnectedDevices = Arc<SyncMutex<u32>>;
static SETTINGS_LOCK: SyncMutex<()> = SyncMutex::new(());
pub fn load_settings(app: &AppHandle) -> AppSettings {
    setting_repository::load(app)
}
fn user_key(user_type: UserType, username: &str) -> String {
    let kind = match user_type {
        UserType::Admin => "admin",
        UserType::Caissier => "caissier",
        UserType::Comptoir => "comptoir",
    };
    format!("{kind}:{}", username.trim().to_lowercase())
}
fn display_prefs(app: &AppHandle, user_type: UserType, username: &str) -> DisplayPrefs {
    setting_repository::load(app)
        .users
        .get(&user_key(user_type, username))
        .cloned()
        .unwrap_or_default()
}
pub fn get_theme(app: &AppHandle, user_type: UserType, username: &str) -> String {
    display_prefs(app, user_type, username).theme.as_str().to_string()
}
pub fn get_background_color(app: &AppHandle, user_type: UserType, username: &str) -> String {
    display_prefs(app, user_type, username).background_color
}
pub fn get_font_size(app: &AppHandle, user_type: UserType, username: &str) -> u32 {
    display_prefs(app, user_type, username).font_size
}
pub fn is_activated(app: &AppHandle) -> bool {
    let settings = setting_repository::load(app);
    settings.activated && settings.product_key == PRODUCT_KEY
}
fn update_settings(app: &AppHandle, change: impl FnOnce(&mut AppSettings)) -> Result<(), String> {
    let _guard = SETTINGS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut current = setting_repository::load(app);
    change(&mut current);
    setting_repository::save(app, &current)
}
fn update_display_prefs(
    app: &AppHandle,
    user_type: UserType,
    username: &str,
    change: impl FnOnce(&mut DisplayPrefs),
) -> Result<(), String> {
    if username.trim().is_empty() {
        return Err("Aucun compte connecté.".to_string());
    }
    let key = user_key(user_type, username);
    update_settings(app, |settings| change(settings.users.entry(key).or_default()))
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
pub async fn set_background_color(
    app: &AppHandle,
    user_type: UserType,
    username: &str,
    value: String,
) -> Result<String, String> {
    let color = validate_background_color(&value)?;
    update_display_prefs(app, user_type, username, |prefs| {
        prefs.background_color = color.clone()
    })?;
    Ok(color)
}
pub async fn set_font_size(
    app: &AppHandle,
    user_type: UserType,
    username: &str,
    value: u32,
) -> Result<u32, String> {
    let clamped = clamp_font_size(value);
    update_display_prefs(app, user_type, username, |prefs| prefs.font_size = clamped)?;
    Ok(clamped)
}
pub async fn activate(app: &AppHandle, key: String) -> Result<bool, String> {
    if key.trim() != PRODUCT_KEY {
        return Ok(false);
    }
    update_settings(app, |settings| {
        settings.product_key = PRODUCT_KEY.to_string();
        settings.activated = true;
    })?;
    Ok(true)
}
pub async fn set_theme(
    app: &AppHandle,
    user_type: UserType,
    username: &str,
    value: String,
) -> Result<String, String> {
    let theme = Theme::from_str(&value)?;
    update_display_prefs(app, user_type, username, |prefs| prefs.theme = theme.clone())?;
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
