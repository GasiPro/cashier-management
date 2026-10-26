use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};
const READ_ATTEMPTS: u32 = 3;
const READ_RETRY_DELAY: Duration = Duration::from_millis(100);
const KEYRING_SERVICE: &str = "gasipro";
const KEYRING_USER: &str = "data-encryption-key";
const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const MAGIC: &[u8] = b"GSP1";
static CIPHER: Mutex<Option<Aes256Gcm>> = Mutex::new(None);
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
fn load_or_create_key() -> Result<Key<Aes256Gcm>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())?;
    match entry.get_secret() {
        Ok(secret) if secret.len() == KEY_LEN => Ok(Key::<Aes256Gcm>::clone_from_slice(&secret)),
        Ok(_) => Err("Clé de chiffrement invalide dans le trousseau du système.".to_string()),
        Err(keyring::Error::NoEntry) => {
            let key = Aes256Gcm::generate_key(OsRng);
            entry.set_secret(key.as_slice()).map_err(|e| e.to_string())?;
            Ok(key)
        }
        Err(err) => Err(err.to_string()),
    }
}
fn cipher() -> Result<Aes256Gcm, String> {
    let mut guard = CIPHER.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(cipher) = guard.as_ref() {
        return Ok(cipher.clone());
    }
    let cipher = Aes256Gcm::new(&load_or_create_key()?);
    *guard = Some(cipher.clone());
    Ok(cipher)
}
fn encrypt(plain: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = cipher()?;
    let nonce = Aes256Gcm::generate_nonce(OsRng);
    let sealed = cipher
        .encrypt(&nonce, plain)
        .map_err(|_| "Échec du chiffrement.".to_string())?;
    let mut out = Vec::with_capacity(MAGIC.len() + NONCE_LEN + sealed.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&sealed);
    Ok(out)
}
fn decrypt(cipher: &Aes256Gcm, data: &[u8]) -> Option<Vec<u8>> {
    if data.len() < NONCE_LEN {
        return None;
    }
    let (nonce, sealed) = data.split_at(NONCE_LEN);
    cipher.decrypt(Nonce::from_slice(nonce), sealed).ok()
}
fn write_bytes_atomic(path: &Path, contents: &[u8]) -> Result<(), String> {
    let mut tmp_name = path.as_os_str().to_owned();
    tmp_name.push(".tmp");
    let tmp_path = PathBuf::from(tmp_name);
    let result = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(&tmp_path)?;
        file.write_all(contents)?;
        file.sync_all()?;
        std::fs::rename(&tmp_path, path)
    })();
    result.map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        e.to_string()
    })
}
pub(crate) fn write_json<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<(), String> {
    let plain = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    write_bytes_atomic(path, &encrypt(&plain)?)
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
fn quarantine(path: &Path, reason: &str) {
    log::error!("Fichier illisible {} : {reason}", path.display());
    let _ = std::fs::rename(path, path.with_extension("corrupt"));
}
fn migrate_to_encrypted(path: &Path, plain: &[u8]) {
    let result = encrypt(plain).and_then(|sealed| write_bytes_atomic(path, &sealed));
    if let Err(err) = result {
        log::warn!("Chiffrement du fichier {} impossible : {err}", path.display());
    }
}
pub(crate) fn read_json<T: DeserializeOwned>(path: &Path) -> Option<T> {
    let bytes = read_bytes(path)?;
    let encrypted = bytes.starts_with(MAGIC);
    let plain = if encrypted {
        let cipher = match cipher() {
            Ok(cipher) => cipher,
            Err(err) => {
                log::error!("Clé de chiffrement indisponible pour {} : {err}", path.display());
                return None;
            }
        };
        match decrypt(&cipher, &bytes[MAGIC.len()..]) {
            Some(plain) => plain,
            None => {
                quarantine(path, "déchiffrement impossible");
                return None;
            }
        }
    } else {
        bytes
    };
    match serde_json::from_slice(&plain) {
        Ok(value) => {
            if !encrypted {
                migrate_to_encrypted(path, &plain);
            }
            Some(value)
        }
        Err(err) => {
            quarantine(path, &err.to_string());
            None
        }
    }
}
