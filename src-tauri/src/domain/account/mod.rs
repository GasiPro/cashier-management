use argon2::password_hash::{
    rand_core::{OsRng, RngCore},
    PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
};
use argon2::Argon2;

use crate::config::account_config::{
    MAX_DISPLAY_NAME_LEN, MAX_USERNAME_LEN, MIN_PASSWORD_LEN, MIN_USERNAME_LEN,
    SESSION_TOKEN_TTL_SECS,
};
use crate::models::account::{
    numeric_id, AccountActivity, AccountActivityEntry, AccountStatus, ActivityKind, SessionInfo,
    SessionRole, Sessions, StoredAccount,
};

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
    accounts
        .iter()
        .any(|a| a.username.eq_ignore_ascii_case(username))
}

pub fn find_account_mut<'a>(
    accounts: &'a mut [StoredAccount],
    username: &str,
) -> Option<&'a mut StoredAccount> {
    accounts
        .iter_mut()
        .find(|a| a.username.eq_ignore_ascii_case(username))
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
            account
                .history
                .iter()
                .enumerate()
                .map(move |(index, entry)| AccountActivity {
                    id: numeric_id(&format!("{}#{index}", account.id)),
                    account_username: account.username.clone(),
                    action: entry.kind.label().to_string(),
                    detail: entry.reason.clone().unwrap_or_default(),
                    at: entry.timestamp.clone(),
                })
        })
        .collect();
    activities.sort_by(|a, b| b.at.cmp(&a.at));
    activities
}

fn generate_session_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

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

pub fn consume_session(
    sessions: &Sessions,
    token: &str,
    expected_role: SessionRole,
) -> Option<String> {
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
