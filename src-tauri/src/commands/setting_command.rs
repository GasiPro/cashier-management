use crate::config::settings;
use serde::Deserialize;

fn get_theme(app: tauri::AppHandle) -> String {
    settings::load(&app).theme.as_str().to_string()
}
fn get_background_color(app: tauri::AppHandle) -> String {
    settings::load(&app).background_color
}
fn get_font_size(app: tauri::AppHandle) -> u32 {
    settings::load(&app).font_size
}
async fn set_background_color(app: tauri::AppHandle, value: String) -> Result<String, String> {
    let mut current = settings::load(&app);
    current.background_color = value.clone();
    settings::update(&app, current)?;
    Ok(value)
}
async fn set_font_size(app: tauri::AppHandle, value: u32) -> Result<u32, String> {
    let clamped = settings::clamp_font_size(value);
    let mut current = settings::load(&app);
    current.font_size = clamped;
    settings::update(&app, current)?;
    Ok(clamped)
}
async fn set_theme(app: tauri::AppHandle, value: String) -> Result<String, String> {
    let theme = settings::Theme::from_str(&value)?;
    let mut current = settings::load(&app);
    current.theme = theme.clone();
    settings::update(&app, current)?;
    Ok(theme.as_str().to_string())
}
#[derive(Debug, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case")]
enum SettingsCommand {
    ThemeGet,
    ThemeSet { value: String },
    BackgroundColorGet,
    BackgroundColorSet { value: String },
    FontSizeGet,
    FontSizeSet { value: u32 },
}
/// Consolidated Tauri command for the settings surface. The frontend invokes
/// a single `settings` command with a tagged `method` field, and this
/// dispatches to the corresponding implementation below:
///
/// - `theme_get`             -> `get_theme`
/// - `theme_set`             -> `set_theme`
/// - `background_color_get`  -> `get_background_color`
/// - `background_color_set`  -> `set_background_color`
/// - `font_size_get`         -> `get_font_size`
/// - `font_size_set`         -> `set_font_size`
#[tauri::command]
pub async fn settings(app: tauri::AppHandle, command: SettingsCommand) -> Result<serde_json::Value, String> {
    match command {
        SettingsCommand::ThemeGet => Ok(serde_json::json!(get_theme(app))),
        SettingsCommand::ThemeSet { value } => Ok(serde_json::json!(set_theme(app, value).await?)),
        SettingsCommand::BackgroundColorGet => Ok(serde_json::json!(get_background_color(app))),
        SettingsCommand::BackgroundColorSet { value } => {
            Ok(serde_json::json!(set_background_color(app, value).await?))
        }
        SettingsCommand::FontSizeGet => Ok(serde_json::json!(get_font_size(app))),
        SettingsCommand::FontSizeSet { value } => Ok(serde_json::json!(set_font_size(app, value).await?)),
    }
}
