
use crate::config::accounts;
use crate::repositories::account_repository;
use std::sync::{Arc, Mutex as SyncMutex};
use tauri::AppHandle;

/// Shared, in-memory accounts store guarded by a sync mutex, mirrored to
/// disk through `repositories::account_repository`.
pub type Accounts = Arc<SyncMutex<Vec<accounts::StoredAccount>>>;

/// Create a new account. Validates the username/password/display name,
/// rejects duplicate usernames, hashes the password, and persists the
/// updated account list. Rolls back the in-memory push on save failure.
pub async fn create_account(
    app: &AppHandle,
    accounts_store: &Accounts,
    username: String,
    password: String,
    display_name: String,
    user_type: accounts::UserType,
) -> Result<accounts::Account, String> {
    let username = accounts::validate_username(&username)?;
    accounts::validate_password(&password)?;
    let display_name = accounts::validate_display_name(&display_name)?;
    let mut guard = accounts_store.lock().unwrap();
    if accounts::username_exists(&guard, &username) {
        return Err("Ce nom d'utilisateur est déjà utilisé.".to_string());
    }
    let password_hash = accounts::hash_password(&password)?;
    let now = chrono::Local::now().to_rfc3339();
    let account = accounts::StoredAccount {
        id: accounts::generate_id(),
        username,
        display_name,
        password_hash,
        user_type,
        status: accounts::AccountStatus::Active,
        created_at: now.clone(),
        last_sign_in_at: None,
        history: vec![accounts::AccountActivityEntry {
            kind: accounts::ActivityKind::Created,
            timestamp: now,
            reason: None,
        }],
    };
    guard.push(account);
    if let Err(err) = account_repository::save(app, &guard) {
        guard.pop();
        return Err(format!("Échec de l'enregistrement du compte : {err}"));
    }
    Ok(accounts::Account::from(guard.last().expect("account was just pushed")))
}

/// All accounts, mapped to their command-boundary view.
pub fn list_accounts(accounts_store: &Accounts) -> Vec<accounts::Account> {
    accounts_store.lock().unwrap().iter().map(accounts::Account::from).collect()
}

/// Modify an existing account's display name, user type, and/or password.
pub async fn update_account(
    app: &AppHandle,
    accounts_store: &Accounts,
    username: String,
    display_name: Option<String>,
    user_type: Option<accounts::UserType>,
    password: Option<String>,
) -> Result<accounts::Account, String> {
    let display_name = match display_name {
        Some(name) => Some(accounts::validate_display_name(&name)?),
        None => None,
    };
    if let Some(ref pwd) = password {
        accounts::validate_password(pwd)?;
    }
    let new_password_hash = match password {
        Some(pwd) => Some(accounts::hash_password(&pwd)?),
        None => None,
    };
    let mut guard = accounts_store.lock().unwrap();
    let account = accounts::find_account_mut(&mut guard, &username)
        .ok_or_else(|| "Compte introuvable.".to_string())?;
    let previous = account.clone();
    if let Some(display_name) = display_name {
        account.display_name = display_name;
    }
    if let Some(user_type) = user_type {
        account.user_type = user_type;
    }
    if let Some(hash) = new_password_hash {
        account.password_hash = hash;
    }
    accounts::record_activity(account, accounts::ActivityKind::Modified, None);
    let updated = accounts::Account::from(&*account);
    if let Err(err) = account_repository::save(app, &guard) {
        if let Some(account) = accounts::find_account_mut(&mut guard, &username) {
            *account = previous;
        }
        return Err(format!("Échec de l'enregistrement du compte : {err}"));
    }
    Ok(updated)
}

/// Suspend an account: a reversible block. The account and its history are
/// left untouched on disk — it's only flagged so it can no longer sign in.
pub async fn suspend_account(
    app: &AppHandle,
    accounts_store: &Accounts,
    username: String,
    reason: Option<String>,
) -> Result<accounts::Account, String> {
    let mut guard = accounts_store.lock().unwrap();
    let account =
        accounts::find_account_mut(&mut guard, &username).ok_or_else(|| "Compte introuvable.".to_string())?;
    let previous = account.clone();
    accounts::suspend(account, reason);
    let updated = accounts::Account::from(&*account);
    if let Err(err) = account_repository::save(app, &guard) {
        if let Some(account) = accounts::find_account_mut(&mut guard, &username) {
            *account = previous;
        }
        return Err(format!("Échec de l'enregistrement de la suspension : {err}"));
    }
    Ok(updated)
}

/// Reactivate a previously suspended account, restoring its access.
pub async fn reactivate_account(
    app: &AppHandle,
    accounts_store: &Accounts,
    username: String,
) -> Result<accounts::Account, String> {
    let mut guard = accounts_store.lock().unwrap();
    let account =
        accounts::find_account_mut(&mut guard, &username).ok_or_else(|| "Compte introuvable.".to_string())?;
    let previous = account.clone();
    accounts::reactivate(account);
    let updated = accounts::Account::from(&*account);
    if let Err(err) = account_repository::save(app, &guard) {
        if let Some(account) = accounts::find_account_mut(&mut guard, &username) {
            *account = previous;
        }
        return Err(format!("Échec de l'enregistrement de la réactivation : {err}"));
    }
    Ok(updated)
}

/// Permanently remove an account.
pub async fn delete_account(app: &AppHandle, accounts_store: &Accounts, username: String) -> Result<(), String> {
    let mut guard = accounts_store.lock().unwrap();
    let index = guard
        .iter()
        .position(|a| a.username.eq_ignore_ascii_case(&username))
        .ok_or_else(|| "Compte introuvable.".to_string())?;
    let removed = guard.remove(index);
    if let Err(err) = account_repository::save(app, &guard) {
        guard.insert(index, removed);
        return Err(format!("Échec de l'enregistrement de la suppression : {err}"));
    }
    Ok(())
}

/// The activity log (created/suspended/reactivated/modified) across every
/// account, most recent first.
pub fn list_account_activities(accounts_store: &Accounts) -> Vec<accounts::AccountActivity> {
    accounts::list_activities(&accounts_store.lock().unwrap())
}
