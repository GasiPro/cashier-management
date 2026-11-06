use crate::services::setting_service;
use serde::Deserialize;
#[derive(Debug, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case")]
pub enum SettingsCommand {
    ThemeGet { username: String },
    ThemeSet { username: String, value: String },
    BackgroundColorGet { username: String },
    BackgroundColorSet { username: String, value: String },
    FontSizeGet { username: String },
    FontSizeSet { username: String, value: u32 },
    ActivationGet,
    ActivationSet { value: String },
}
#[tauri::command]
pub async fn settings(
    app: tauri::AppHandle,
    command: SettingsCommand,
) -> Result<serde_json::Value, String> {
    match command {
        SettingsCommand::ThemeGet { username } => {
            Ok(serde_json::json!(setting_service::get_theme(&app, &username)))
        }
        SettingsCommand::ThemeSet { username, value } => Ok(serde_json::json!(
            setting_service::set_theme(&app, &username, value).await?
        )),
        SettingsCommand::BackgroundColorGet { username } => Ok(serde_json::json!(
            setting_service::get_background_color(&app, &username)
        )),
        SettingsCommand::BackgroundColorSet { username, value } => Ok(serde_json::json!(
            setting_service::set_background_color(&app, &username, value).await?
        )),
        SettingsCommand::FontSizeGet { username } => Ok(serde_json::json!(
            setting_service::get_font_size(&app, &username)
        )),
        SettingsCommand::FontSizeSet { username, value } => Ok(serde_json::json!(
            setting_service::set_font_size(&app, &username, value).await?
        )),
        SettingsCommand::ActivationGet => Ok(serde_json::json!(setting_service::is_activated(&app))),
        SettingsCommand::ActivationSet { value } => Ok(serde_json::json!(
            setting_service::activate(&app, value).await?
        )),
    }
}
