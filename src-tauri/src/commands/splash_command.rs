use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case")]
pub enum SplashCommand {
    Close,
}

#[tauri::command]
pub async fn splash(
    app: tauri::AppHandle,
    command: SplashCommand,
) -> Result<serde_json::Value, String> {
    match command {
        SplashCommand::Close => {
            crate::infrastructure::splash::close(&app).map_err(|err| err.to_string())?;
            Ok(serde_json::Value::Null)
        }
    }
}
