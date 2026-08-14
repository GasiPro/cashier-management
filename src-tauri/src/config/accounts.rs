//! Persisted cashier accounts (username + hashed password).
//!
//! Mirrors the persistence pattern used by `settings`: a JSON file inside the
//! app's config directory, loaded once at startup and rewritten whenever it
//! changes. Passwords are never stored, logged, or sent back to the frontend
//! in plain text — only an Argon2 hash ever touches disk.
//!
//! This module currently supports creating, listing, and modifying accounts.
//! Usernames are immutable by design: there is deliberately no "rename"
//! function, since the rest of the app (the login flow's `LS_USERNAME`
//! identity) treats the username as a stable identifier. The display name and
//! password, on the other hand, can both be changed after creation — see
//! `find_account_mut`, used by the "modify" command to locate an account by
//! its (unchanging) username before updating the rest of it.

use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Username length bounds, enforced both client- and server-side.
pub const MIN_USERNAME_LEN: usize = 3;
pub const MAX_USERNAME_LEN: usize = 32;
/// Minimum password length. Not a strength requirement — just a floor
/// against trivially guessable one-character passwords.
pub const MIN_PASSWORD_LEN: usize = 6;
/// Maximum length for the optional display name.
pub const MAX_DISPLAY_NAME_LEN: usize = 40;

const ACCOUNTS_FILE_NAME: &str = "cashier_accounts.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CashierAccount {
    /// Immutable once created — the same identifier used by the existing
    /// username-based login/identity flow (`LS_USERNAME` on the frontend).
    pub username: String,
    /// Friendlier label shown in place of the raw username where that helps
    /// (e.g. account lists). Empty by default: the counter operating this
    /// account is expected to fill it in, and an admin can set or correct it
    /// later from Réglages. `#[serde(default)]` keeps accounts persisted
    /// before this field existed loading correctly as `""`.
    #[serde(default)]
    pub display_name: String,
    pub password_hash: String,
    pub created_at: String,
}

/// Public view of an account — the only shape ever sent across the Tauri IPC
/// boundary. Never carries the password hash.
#[derive(Debug, Clone, Serialize)]
pub struct CashierAccountView {
    pub username: String,
    pub display_name: String,
    pub created_at: String,
}

impl From<&CashierAccount> for CashierAccountView {
    fn from(account: &CashierAccount) -> Self {
        Self {
            username: account.username.clone(),
            display_name: account.display_name.clone(),
            created_at: account.created_at.clone(),
        }
    }
}

fn accounts_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(ACCOUNTS_FILE_NAME))
}

/// Loads persisted accounts from disk. Falls back to an empty list if the
/// file is missing, unreadable, or malformed — a broken or absent accounts
/// file should never stop the app from starting (same contract as
/// `settings::load`).
pub fn load(app: &AppHandle) -> Vec<CashierAccount> {
    let Ok(path) = accounts_file_path(app) else {
        return Vec::new();
    };
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// Persists the full account list to disk.
pub fn save(app: &AppHandle, accounts: &[CashierAccount]) -> Result<(), String> {
    let path = accounts_file_path(app)?;
    let raw = serde_json::to_string_pretty(accounts).map_err(|e| e.to_string())?;
    std::fs::write(&path, raw).map_err(|e| e.to_string())
}

/// Hashes a password with a freshly generated random salt. The returned
/// string is the full PHC-formatted hash (algorithm, salt and digest
/// together) — no separate salt storage is needed.
pub fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|e| e.to_string())
}

/// Verifies a plain-text password against a previously hashed one. Reserved
/// for the login flow — not wired up yet, since account-based authentication
/// isn't part of this step, but kept alongside `hash_password` so the two
/// stay in sync.
#[allow(dead_code)]
pub fn verify_password(password: &str, hash: &str) -> bool {
    let Ok(parsed_hash) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok()
}

/// Validates and normalizes a candidate username (trims surrounding
/// whitespace, checks length bounds). Uniqueness is checked separately via
/// `username_exists`, since that requires the current account list.
pub fn validate_username(username: &str) -> Result<String, String> {
    let trimmed = username.trim();
    if trimmed.chars().count() < MIN_USERNAME_LEN {
        return Err(format!(
            "Le nom d'utilisateur doit contenir au moins {MIN_USERNAME_LEN} caractères."
        ));
    }
    if trimmed.chars().count() > MAX_USERNAME_LEN {
        return Err(format!(
            "Le nom d'utilisateur ne peut pas dépasser {MAX_USERNAME_LEN} caractères."
        ));
    }
    Ok(trimmed.to_string())
}

/// Validates a candidate password's length. Never logs or persists the raw
/// value beyond this check.
pub fn validate_password(password: &str) -> Result<(), String> {
    if password.chars().count() < MIN_PASSWORD_LEN {
        return Err(format!(
            "Le mot de passe doit contenir au moins {MIN_PASSWORD_LEN} caractères."
        ));
    }
    Ok(())
}

/// Validates and normalizes a candidate display name (trims surrounding
/// whitespace, checks the max length). Unlike the username, an empty display
/// name is valid — it just means the account doesn't have one set yet.
pub fn validate_display_name(display_name: &str) -> Result<String, String> {
    let trimmed = display_name.trim();
    if trimmed.chars().count() > MAX_DISPLAY_NAME_LEN {
        return Err(format!(
            "Le nom affiché ne peut pas dépasser {MAX_DISPLAY_NAME_LEN} caractères."
        ));
    }
    Ok(trimmed.to_string())
}

/// `true` if `username` is already taken by an existing account. Compared
/// case-insensitively, since the existing username-based login/identity flow
/// treats e.g. "Caisse1" and "caisse1" as the same identity.
pub fn username_exists(accounts: &[CashierAccount], username: &str) -> bool {
    accounts.iter().any(|a| a.username.eq_ignore_ascii_case(username))
}

/// Locates a mutable reference to an account by username, compared the same
/// case-insensitive way as `username_exists`. Used to apply a "modify" (never
/// a rename — the caller only ever changes the fields on the returned
/// account, not its username) once the request has already been validated.
pub fn find_account_mut<'a>(accounts: &'a mut [CashierAccount], username: &str) -> Option<&'a mut CashierAccount> {
    accounts.iter_mut().find(|a| a.username.eq_ignore_ascii_case(username))
}
