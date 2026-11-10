use crate::models::account::UserType;
use crate::services::setting_service;
use serde::Deserialize;
#[derive(Debug, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case")]
pub enum SettingsCommand {
    ThemeGet { user_type: UserType, username: String },
    ThemeSet { user_type: UserType, username: String, value: String },
    BackgroundColorGet { user_type: UserType, username: String },
    BackgroundColorSet { user_type: UserType, username: String, value: String },
    FontSizeGet { user_type: UserType, username: String },
    FontSizeSet { user_type: UserType, username: String, value: u32 },
    ActivationGet,
    ActivationSet { value: String },
}
#[tauri::command]
pub async fn settings(
    app: tauri::AppHandle,
    command: SettingsCommand,
) -> Result<serde_json::Value, String> {
    match command {
        SettingsCommand::ThemeGet { user_type, username } => Ok(serde_json::json!(
            setting_service::get_theme(&app, user_type, &username)
        )),
        SettingsCommand::ThemeSet { user_type, username, value } => Ok(serde_json::json!(
            setting_service::set_theme(&app, user_type, &username, value).await?
        )),
        SettingsCommand::BackgroundColorGet { user_type, username } => Ok(serde_json::json!(
            setting_service::get_background_color(&app, user_type, &username)
        )),
        SettingsCommand::BackgroundColorSet { user_type, username, value } => Ok(serde_json::json!(
            setting_service::set_background_color(&app, user_type, &username, value).await?
        )),
        SettingsCommand::FontSizeGet { user_type, username } => Ok(serde_json::json!(
            setting_service::get_font_size(&app, user_type, &username)
        )),
        SettingsCommand::FontSizeSet { user_type, username, value } => Ok(serde_json::json!(
            setting_service::set_font_size(&app, user_type, &username, value).await?
        )),
        SettingsCommand::ActivationGet => Ok(serde_json::json!(setting_service::is_activated(&app))),
        SettingsCommand::ActivationSet { value } => Ok(serde_json::json!(
            setting_service::activate(&app, value).await?
        )),
    }
}
