use crate::infrastructure::filesystem;
use serde::Deserialize;
#[derive(Debug, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case")]
pub enum FileCommand {
    SaveBinary { path: String, data: Vec<u8> },
    LoadBinary { path: String },
}
#[tauri::command]
pub fn file(command: FileCommand) -> Result<serde_json::Value, String> {
    match command {
        FileCommand::SaveBinary { path, data } => {
            filesystem::save_binary_file(path, data)?;
            Ok(serde_json::Value::Null)
        }
        FileCommand::LoadBinary { path } => {
            Ok(serde_json::json!(filesystem::load_binary_file(path)?))
        }
    }
}
