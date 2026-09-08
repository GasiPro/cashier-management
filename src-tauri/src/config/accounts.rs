use argon2::password_hash::{
    rand_core::{OsRng, RngCore},
    PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
};
use argon2::Argon2;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex as SyncMutex};
use tauri::{AppHandle, Manager};
pub const MIN_USERNAME_LEN: usize = 3;
pub const MAX_USERNAME_LEN: usize = 32;
pub const MIN_PASSWORD_LEN: usize = 8;
pub const MAX_DISPLAY_NAME_LEN: usize = 40;
const ACCOUNTS_FILE_NAME: &str = "accounts.json";
const DEFAULT_USERNAME: &str = "admin";
const DEFAULT_PASSWORD: &str = "admin123";
/// How long a session token minted by `authenticate_admin` /
/// `authenticate_cashier` remains valid for. It only needs to survive the
/// brief window between the invoke() call and the frontend's follow-up
/// `cashier_register` / `admin_register` WebSocket message, so this is
/// intentionally short-lived.
pub const SESSION_TOKEN_TTL_SECS: i64 = 30;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccountStatus {
    Active,
    Suspended,
}
impl Default for AccountStatus {
    fn default() -> Self {
        AccountStatus::Active
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UserType {
    Admin,
    Caissier,
    Comptoir,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityKind {
    Created,
    Suspended,
    Reactivated,
    Modified,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountActivityEntry {
    pub kind: ActivityKind,
    pub timestamp: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredAccount {
    pub id: String,
    pub username: String,
    #[serde(default)]
    pub display_name: String,
    pub password_hash: String,
    pub user_type: UserType,
    #[serde(default)]
    pub status: AccountStatus,
    pub created_at: String,
    #[serde(default)]
    pub last_sign_in_at: Option<String>,
    #[serde(default)]
    pub history: Vec<AccountActivityEntry>,
}
#[derive(Debug, Clone, Serialize)]
pub struct Account {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub user_type: UserType,
    pub status: AccountStatus,
    pub created_at: String,
    pub last_sign_in_at: Option<String>,
    pub history: Vec<AccountActivityEntry>,
}
impl From<&StoredAccount> for Account {
    fn from(account: &StoredAccount) -> Self {
        Self {
            id: account.id.clone(),
            username: account.username.clone(),
            display_name: account.display_name.clone(),
            user_type: account.user_type,
            status: account.status,
            created_at: account.created_at.clone(),
            last_sign_in_at: account.last_sign_in_at.clone(),
            history: account.history.clone(),
        }
    }
}
#[derive(Debug, Clone, Serialize)]
pub struct AccountActivity {
    pub account_id: String,
    pub username: String,
    pub kind: ActivityKind,
    pub timestamp: String,
    pub reason: Option<String>,
}
#[derive(Debug, Clone, Serialize)]
pub struct AuthResult {
    pub success: bool,
    pub account: Option<Account>,
    pub error: Option<String>,
    /// Present only on success. A short-lived, single-use token the
    /// frontend must include in its `cashier_register` / `admin_register`
    /// WebSocket message so the server can verify the registration was
    /// actually preceded by a successful `authenticate_admin` /
    /// `authenticate_cashier` call, instead of trusting a client-supplied
    /// username with no credential check.
    pub session_token: Option<String>,
}
/// The privileged role a minted session token grants over the WebSocket
/// connection. Kept distinct from `UserType` because a session is about
/// "what this token may register as", not the account's stored type.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionRole {
    Admin,
    Cashier,
}
#[derive(Debug, Clone)]
pub struct SessionInfo {
    pub username: String,
    pub role: SessionRole,
    pub expires_at: i64,
}
/// In-memory (never persisted) map of session tokens minted by
/// `authenticate_admin` / `authenticate_cashier`, consumed by the WebSocket
/// `cashier_register` / `admin_register` handlers.
pub type Sessions = Arc<SyncMutex<HashMap<String, SessionInfo>>>;
fn accounts_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(ACCOUNTS_FILE_NAME))
}
pub fn load(app: &AppHandle) -> Vec<StoredAccount> {
    let Ok(path) = accounts_file_path(app) else {
        return Vec::new();
    };
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}
pub fn save(app: &AppHandle, accounts: &[StoredAccount]) -> Result<(), String> {
    let path = accounts_file_path(app)?;
    let raw = serde_json::to_string_pretty(accounts).map_err(|e| e.to_string())?;
    std::fs::write(&path, raw).map_err(|e| e.to_string())
}
pub fn load_or_bootstrap(app: &AppHandle) -> Vec<StoredAccount> {
    let accounts = load(app);
    if !accounts.is_empty() {
        return accounts;
    }
    let now = chrono::Local::now().to_rfc3339();
    let default_account = match hash_password(DEFAULT_PASSWORD) {
        Ok(password_hash) => StoredAccount {
            id: generate_id(),
            username: DEFAULT_USERNAME.to_string(),
            display_name: String::new(),
            password_hash,
            user_type: UserType::Admin,
            status: AccountStatus::Active,
            created_at: now.clone(),
            last_sign_in_at: None,
            history: vec![AccountActivityEntry {
                kind: ActivityKind::Created,
                timestamp: now,
                reason: None,
            }],
        },
        Err(_) => return accounts,
    };
    let accounts = vec![default_account];
    let _ = save(app, &accounts);
    accounts
}
pub fn generate_id() -> String {
    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
pub fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|e| e.to_string())
}
pub fn verify_password(password: &str, hash: &str) -> bool {
    let Ok(parsed_hash) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok()
}
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
pub fn validate_password(password: &str) -> Result<(), String> {
    if password.chars().count() < MIN_PASSWORD_LEN {
        return Err(format!(
            "Le mot de passe doit contenir au moins {MIN_PASSWORD_LEN} caractères."
        ));
    }
    let has_letter = password.chars().any(|c| c.is_alphabetic());
    let has_digit = password.chars().any(|c| c.is_ascii_digit());
    if !has_letter || !has_digit {
        return Err("Le mot de passe doit contenir au moins une lettre et un chiffre.".to_string());
    }
    Ok(())
}
pub fn validate_display_name(display_name: &str) -> Result<String, String> {
    let trimmed = display_name.trim();
    if trimmed.chars().count() > MAX_DISPLAY_NAME_LEN {
        return Err(format!(
            "Le nom affiché ne peut pas dépasser {MAX_DISPLAY_NAME_LEN} caractères."
        ));
    }
    Ok(trimmed.to_string())
}
pub fn username_exists(accounts: &[StoredAccount], username: &str) -> bool {
    accounts.iter().any(|a| a.username.eq_ignore_ascii_case(username))
}
pub fn find_account_mut<'a>(accounts: &'a mut [StoredAccount], username: &str) -> Option<&'a mut StoredAccount> {
    accounts.iter_mut().find(|a| a.username.eq_ignore_ascii_case(username))
}
/// Appends an activity entry to an account's history.
pub fn record_activity(account: &mut StoredAccount, kind: ActivityKind, reason: Option<String>) {
    account.history.push(AccountActivityEntry {
        kind,
        timestamp: chrono::Local::now().to_rfc3339(),
        reason,
    });
}
pub fn suspend(account: &mut StoredAccount, reason: Option<String>) {
    account.status = AccountStatus::Suspended;
    record_activity(account, ActivityKind::Suspended, reason);
}
pub fn reactivate(account: &mut StoredAccount) {
    account.status = AccountStatus::Active;
    record_activity(account, ActivityKind::Reactivated, None);
}
pub fn remove_account(accounts: &mut Vec<StoredAccount>, username: &str) -> bool {
    let len_before = accounts.len();
    accounts.retain(|a| !a.username.eq_ignore_ascii_case(username));
    accounts.len() != len_before
}
pub fn list_activities(accounts: &[StoredAccount]) -> Vec<AccountActivity> {
    let mut activities: Vec<AccountActivity> = accounts
        .iter()
        .flat_map(|account| {
            account.history.iter().map(move |entry| AccountActivity {
                account_id: account.id.clone(),
                username: account.username.clone(),
                kind: entry.kind,
                timestamp: entry.timestamp.clone(),
                reason: entry.reason.clone(),
            })
        })
        .collect();
    activities.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    activities
}
fn generate_session_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
/// Mints a short-lived, single-use session token for `username`/`role`,
/// storing it in `sessions`. Expired entries are purged opportunistically
/// while the lock is held so the map doesn't grow unbounded.
pub fn mint_session(sessions: &Sessions, username: &str, role: SessionRole) -> String {
    let token = generate_session_token();
    let now = chrono::Local::now().timestamp();
    let mut guard = sessions.lock().unwrap();
    guard.retain(|_, info| info.expires_at > now);
    guard.insert(
        token.clone(),
        SessionInfo {
            username: username.to_string(),
            role,
            expires_at: now + SESSION_TOKEN_TTL_SECS,
        },
    );
    token
}
/// Consumes (one-time use) `token` if it exists, hasn't expired, and was
/// minted for `expected_role`. Returns the username it was minted for.
pub fn consume_session(sessions: &Sessions, token: &str, expected_role: SessionRole) -> Option<String> {
    let now = chrono::Local::now().timestamp();
    let mut guard = sessions.lock().unwrap();
    match guard.get(token) {
        Some(info) if info.role == expected_role && info.expires_at > now => {
            let username = info.username.clone();
            guard.remove(token);
            Some(username)
        }
        _ => None,
    }
}
