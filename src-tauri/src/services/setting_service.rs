use crate::config::setting_config::{
    clamp_font_size, clamp_max_connected_devices, MAX_ORGANIZATION_NAME_LEN, PRODUCT_KEY,
};
use crate::models::account::UserType;
use crate::models::setting::{AppMode, AppSettings, DisplayPrefs, Organization, Theme};
use crate::repositories::{account_repository, setting_repository};
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
pub fn is_setup_complete(app: &AppHandle) -> bool {
    is_activated(app) && load_mode(app).is_some()
}
pub fn load_organization(app: &AppHandle) -> Option<Organization> {
    setting_repository::load(app).organization
}
fn validate_organization(name: &str, email: &str, phone: &str) -> Result<Organization, String> {
    let (name, email, phone) = (name.trim(), email.trim(), phone.trim());
    if name.is_empty() || name.chars().count() > MAX_ORGANIZATION_NAME_LEN {
        return Err("Nom de l'organisation invalide.".to_string());
    }
    let email_ok = email.split_once('@').is_some_and(|(local, domain)| {
        !local.is_empty()
            && !domain.contains('@')
            && domain.contains('.')
            && !domain.starts_with('.')
            && !domain.ends_with('.')
            && !email.contains(char::is_whitespace)
    });
    if !email_ok {
        return Err("Adresse e-mail invalide.".to_string());
    }
    let digits = phone.chars().filter(char::is_ascii_digit).count();
    let phone_ok = phone.starts_with('+')
        && (7..=15).contains(&digits)
        && phone[1..].chars().all(|c| c.is_ascii_digit() || c == ' ');
    if !phone_ok {
        return Err("Numéro de téléphone invalide.".to_string());
    }
    Ok(Organization {
        name: name.to_string(),
        email: email.to_string(),
        phone: phone.to_string(),
    })
}
pub fn set_organization(
    app: &AppHandle,
    name: &str,
    email: &str,
    phone: &str,
) -> Result<Organization, String> {
    if !is_activated(app) {
        return Err("Produit non activé.".to_string());
    }
    let organization = validate_organization(name, email, phone)?;
    update_settings(app, |settings| settings.organization = Some(organization.clone()))?;
    Ok(organization)
}
pub fn load_mode(app: &AppHandle) -> Option<AppMode> {
    let settings = setting_repository::load(app);
    if settings.mode.is_some() {
        return settings.mode;
    }
    let legacy_install = settings.activated
        && settings.product_key == PRODUCT_KEY
        && !account_repository::load(app).is_empty();
    if !legacy_install {
        return None;
    }
    update_settings(app, |current| current.mode = Some(AppMode::Caisse)).ok()?;
    Some(AppMode::Caisse)
}
pub fn set_mode(app: &AppHandle, value: &str) -> Result<AppMode, String> {
    let mode = AppMode::from_str(value)?;
    if !is_activated(app) {
        return Err("Produit non activé.".to_string());
    }
    if load_settings(app).mode.is_some() {
        return Err("Le mode est déjà défini.".to_string());
    }
    if load_organization(app).is_none() {
        return Err("Organisation non renseignée.".to_string());
    }
    let mut already_set = false;
    update_settings(app, |settings| match settings.mode {
        Some(_) => already_set = true,
        None => settings.mode = Some(mode),
    })?;
    if already_set {
        return Err("Le mode est déjà défini.".to_string());
    }
    Ok(mode)
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
