use crate::services::setting_service;
use serde::Deserialize;
#[derive(Debug, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case")]
pub enum SettingsCommand {
    ThemeGet,
    ThemeSet { value: String },
    BackgroundColorGet,
    BackgroundColorSet { value: String },
    FontSizeGet,
    FontSizeSet { value: u32 },
}
#[tauri::command]
pub async fn settings(app: tauri::AppHandle, command: SettingsCommand) -> Result<serde_json::Value, String> {
    match command {
        SettingsCommand::ThemeGet => Ok(serde_json::json!(setting_service::get_theme(&app))),
        SettingsCommand::ThemeSet { value } => {
            Ok(serde_json::json!(setting_service::set_theme(&app, value).await?))
        }
        SettingsCommand::BackgroundColorGet => Ok(serde_json::json!(setting_service::get_background_color(&app))),
        SettingsCommand::BackgroundColorSet { value } => {
            Ok(serde_json::json!(setting_service::set_background_color(&app, value).await?))
        }
        SettingsCommand::FontSizeGet => Ok(serde_json::json!(setting_service::get_font_size(&app))),
        SettingsCommand::FontSizeSet { value } => {
            Ok(serde_json::json!(setting_service::set_font_size(&app, value).await?))
        }
    }
}
