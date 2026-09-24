use serde::Deserialize;

fn save_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, data).map_err(|e| e.to_string())
}
/// Read a file's raw bytes from disk. Exposed under the consolidated `file`
fn load_binary_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}
#[derive(Debug, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case")]
enum FileCommand {
    SaveBinary { path: String, data: Vec<u8> },
    LoadBinary { path: String },
}
#[tauri::command]
pub fn file(command: FileCommand) -> Result<serde_json::Value, String> {
    match command {
        FileCommand::SaveBinary { path, data } => {
            save_binary_file(path, data)?;
            Ok(serde_json::Value::Null)
        }
        FileCommand::LoadBinary { path } => Ok(serde_json::json!(load_binary_file(path)?)),
    }
}
