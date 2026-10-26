use serde::de::DeserializeOwned;
use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Manager};

const READ_ATTEMPTS: u32 = 3;
const READ_RETRY_DELAY: Duration = Duration::from_millis(100);

pub(crate) fn save_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, data).map_err(|e| e.to_string())
}

pub(crate) fn load_binary_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

pub(crate) fn config_file_path(app: &AppHandle, file_name: &str) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(file_name))
}

pub(crate) fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let mut tmp_name = path.as_os_str().to_owned();
    tmp_name.push(".tmp");
    let tmp_path = PathBuf::from(tmp_name);
    let result = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(&tmp_path)?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
        std::fs::rename(&tmp_path, path)
    })();
    result.map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        e.to_string()
    })
}

pub(crate) fn write_json<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    write_atomic(path, &raw)
}

fn read_bytes(path: &Path) -> Option<Vec<u8>> {
    for attempt in 1..=READ_ATTEMPTS {
        match std::fs::read(path) {
            Ok(bytes) => return Some(bytes),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return None,
            Err(err) => {
                log::warn!(
                    "Lecture impossible de {} (tentative {attempt}/{READ_ATTEMPTS}) : {err}",
                    path.display()
                );
                if attempt < READ_ATTEMPTS {
                    std::thread::sleep(READ_RETRY_DELAY);
                }
            }
        }
    }
    None
}

pub(crate) fn read_json<T: DeserializeOwned>(path: &Path) -> Option<T> {
    let bytes = read_bytes(path)?;
    match serde_json::from_slice(&bytes) {
        Ok(value) => Some(value),
        Err(err) => {
            log::error!("Fichier illisible {} : {err}", path.display());
            let _ = std::fs::rename(path, path.with_extension("corrupt"));
            None
        }
    }
}
