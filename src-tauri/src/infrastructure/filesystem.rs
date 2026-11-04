use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Manager};
#[cfg(target_arch = "x86")]
use std::arch::x86::__cpuid;
#[cfg(target_arch = "x86_64")]
use std::arch::x86_64::__cpuid;
const READ_ATTEMPTS: u32 = 3;
const READ_RETRY_DELAY: Duration = Duration::from_millis(100);
const KEYRING_SERVICE: &str = "gasipro";
const KEYRING_USER: &str = "data-encryption-key";
const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const MAGIC: &[u8] = b"GSP2";
const LEGACY_MAGIC: &[u8] = b"GSP1";
static CIPHER: Mutex<Option<Aes256Gcm>> = Mutex::new(None);
static FINGERPRINT: OnceLock<String> = OnceLock::new();
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
#[cfg(any(windows, target_os = "macos"))]
fn run(program: &str, args: &[&str]) -> Result<String, String> {
    let mut command = std::process::Command::new(program);
    command.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let output = command.output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!("Commande {program} en échec."));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}
fn normalize_mac(mac: &str) -> String {
    mac.trim().replace('-', ":").to_uppercase()
}
#[cfg(windows)]
fn board_uuid_and_mac() -> Result<(String, String), String> {
    const SCRIPT: &str = "(Get-CimInstance Win32_ComputerSystemProduct).UUID; \
        $a = Get-CimInstance Win32_NetworkAdapter | Where-Object { $_.MACAddress }; \
        $p = $a | Where-Object { $_.PNPDeviceID -like 'PCI*' }; \
        if (-not $p) { $p = $a | Where-Object { $_.PhysicalAdapter } }; \
        $p | ForEach-Object { $_.MACAddress } | Sort-Object | Select-Object -First 1";
    let output = run(
        "powershell.exe",
        &["-NoProfile", "-NonInteractive", "-Command", SCRIPT],
    )?;
    let mut lines = output.lines().map(str::trim).filter(|l| !l.is_empty());
    let uuid = lines.next().unwrap_or_default();
    let mac = lines.next().unwrap_or_default();
    Ok((uuid.to_uppercase(), normalize_mac(mac)))
}
#[cfg(target_os = "linux")]
fn board_uuid_and_mac() -> Result<(String, String), String> {
    let uuid =
        std::fs::read_to_string("/sys/class/dmi/id/product_uuid").map_err(|e| e.to_string())?;
    let mut macs: Vec<String> = std::fs::read_dir("/sys/class/net")
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|entry| {
            let dir = entry.path();
            let device = std::fs::canonicalize(dir.join("device")).ok()?;
            if device.to_string_lossy().contains("/usb") {
                return None;
            }
            std::fs::read_to_string(dir.join("address")).ok()
        })
        .map(|mac| normalize_mac(&mac))
        .filter(|mac| mac != "00:00:00:00:00:00")
        .collect();
    macs.sort();
    Ok((
        uuid.trim().to_uppercase(),
        macs.into_iter().next().unwrap_or_default(),
    ))
}
#[cfg(target_os = "macos")]
fn board_uuid_and_mac() -> Result<(String, String), String> {
    let registry = run("ioreg", &["-rd1", "-c", "IOPlatformExpertDevice"])?;
    let uuid = registry
        .lines()
        .find(|line| line.contains("IOPlatformUUID"))
        .and_then(|line| line.split('"').nth(3))
        .unwrap_or_default();
    let interface = run("ifconfig", &["en0"])?;
    let mac = interface
        .lines()
        .find_map(|line| line.trim().strip_prefix("ether "))
        .unwrap_or_default();
    Ok((uuid.to_uppercase(), normalize_mac(mac)))
}
#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
fn board_uuid_and_mac() -> Result<(String, String), String> {
    Err("Système non pris en charge pour la signature matérielle.".to_string())
}
#[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
#[allow(unused_unsafe)]
fn cpu_id() -> String {
    unsafe {
        let vendor = __cpuid(0);
        let signature = __cpuid(1).eax;
        let mut brand = Vec::new();
        if __cpuid(0x8000_0000).eax >= 0x8000_0004 {
            for leaf in 0x8000_0002..=0x8000_0004 {
                let regs = __cpuid(leaf);
                for reg in [regs.eax, regs.ebx, regs.ecx, regs.edx] {
                    brand.extend_from_slice(&reg.to_le_bytes());
                }
            }
        }
        let brand = String::from_utf8_lossy(&brand)
            .trim_matches(|c: char| c == '\0' || c.is_whitespace())
            .to_string();
        format!(
            "{:08x}{:08x}{:08x}{:08x}{brand}",
            vendor.ebx, vendor.edx, vendor.ecx, signature
        )
    }
}
#[cfg(not(any(target_arch = "x86", target_arch = "x86_64")))]
fn cpu_id() -> String {
    std::env::consts::ARCH.to_string()
}
fn fingerprint() -> Result<String, String> {
    if let Some(value) = FINGERPRINT.get() {
        return Ok(value.clone());
    }
    let (uuid, mac) = board_uuid_and_mac()?;
    if uuid.is_empty() || mac.is_empty() {
        return Err("Identifiants matériels indisponibles.".to_string());
    }
    let value = format!("gasipro|{uuid}|{mac}|{}", cpu_id());
    let _ = FINGERPRINT.set(value.clone());
    Ok(value)
}
fn load_or_create_key() -> Result<Key<Aes256Gcm>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())?;
    match entry.get_secret() {
        Ok(secret) if secret.len() == KEY_LEN => Ok(Key::<Aes256Gcm>::clone_from_slice(&secret)),
        Ok(_) => Err("Clé de chiffrement invalide dans le trousseau du système.".to_string()),
        Err(keyring::Error::NoEntry) => {
            let key = Aes256Gcm::generate_key(OsRng);
            entry
                .set_secret(key.as_slice())
                .map_err(|e| e.to_string())?;
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
    let signature = fingerprint()?;
    let nonce = Aes256Gcm::generate_nonce(OsRng);
    let sealed = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: plain,
                aad: signature.as_bytes(),
            },
        )
        .map_err(|_| "Échec du chiffrement.".to_string())?;
    let mut out = Vec::with_capacity(MAGIC.len() + NONCE_LEN + sealed.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&sealed);
    Ok(out)
}
fn decrypt(cipher: &Aes256Gcm, data: &[u8], aad: &[u8]) -> Option<Vec<u8>> {
    if data.len() < NONCE_LEN {
        return None;
    }
    let (nonce, sealed) = data.split_at(NONCE_LEN);
    cipher
        .decrypt(Nonce::from_slice(nonce), Payload { msg: sealed, aad })
        .ok()
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
        log::warn!(
            "Chiffrement du fichier {} impossible : {err}",
            path.display()
        );
    }
}
pub(crate) fn read_json<T: DeserializeOwned>(path: &Path) -> Option<T> {
    let bytes = read_bytes(path)?;
    let signed = bytes.starts_with(MAGIC);
    let plain = if signed || bytes.starts_with(LEGACY_MAGIC) {
        let cipher = match cipher() {
            Ok(cipher) => cipher,
            Err(err) => {
                log::error!(
                    "Clé de chiffrement indisponible pour {} : {err}",
                    path.display()
                );
                return None;
            }
        };
        let aad = if signed {
            match fingerprint() {
                Ok(signature) => signature.into_bytes(),
                Err(err) => {
                    log::error!(
                        "Signature matérielle indisponible pour {} : {err}",
                        path.display()
                    );
                    return None;
                }
            }
        } else {
            Vec::new()
        };
        match decrypt(&cipher, &bytes[MAGIC.len()..], &aad) {
            Some(plain) => plain,
            None => {
                quarantine(path, "signature ou déchiffrement invalide");
                return None;
            }
        }
    } else {
        bytes
    };
    match serde_json::from_slice(&plain) {
        Ok(value) => {
            if !signed {
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
