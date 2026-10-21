use crate::config::account_config::{DEFAULT_PASSWORD, DEFAULT_USERNAME};
use crate::domain::account;
use crate::models::account::{
    Account, AccountActivity, AccountActivityEntry, AccountStatus, ActivityKind, StoredAccount,
    UserType,
};
use crate::repositories::account_repository;
use std::sync::{Arc, Mutex as SyncMutex};
use tauri::AppHandle;
pub type Accounts = Arc<SyncMutex<Vec<StoredAccount>>>;
pub fn load_or_bootstrap(app: &AppHandle) -> Vec<StoredAccount> {
    let accounts = account_repository::load(app);
    if !accounts.is_empty() {
        return accounts;
    }
    let now = chrono::Local::now().to_rfc3339();
    let default_account = match account::hash_password(DEFAULT_PASSWORD) {
        Ok(password_hash) => StoredAccount {
            id: account::generate_id(),
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
    let _ = account_repository::save(app, &accounts);
    accounts
}
pub fn find_account_view(accounts_store: &Accounts, username: &str) -> Option<Account> {
    accounts_store
        .lock()
        .unwrap()
        .iter()
        .find(|a| a.username.eq_ignore_ascii_case(username))
        .map(Account::from)
}
pub fn verify_active_credentials(
    accounts_store: &Accounts,
    username: &str,
    password: &str,
    user_type: UserType,
) -> Option<String> {
    if account::validate_username(username).is_err() || account::validate_password(password).is_err() {
        return None;
    }
    let username = username.trim();
    let guard = accounts_store.lock().unwrap();
    guard
        .iter()
        .find(|a| {
            a.username.eq_ignore_ascii_case(username)
                && a.user_type == user_type
                && a.status == AccountStatus::Active
                && account::verify_password(password, &a.password_hash)
        })
        .map(|a| a.username.clone())
}
pub async fn create_account(
    app: &AppHandle,
    accounts_store: &Accounts,
    username: String,
    password: String,
    display_name: String,
    user_type: UserType,
) -> Result<Account, String> {
    let username = account::validate_username(&username)?;
    account::validate_password(&password)?;
    let display_name = account::validate_display_name(&display_name)?;
    let mut guard = accounts_store.lock().unwrap();
    if account::username_exists(&guard, &username) {
        return Err("Ce nom d'utilisateur est déjà utilisé.".to_string());
    }
    let password_hash = account::hash_password(&password)?;
    let now = chrono::Local::now().to_rfc3339();
    let account = StoredAccount {
        id: account::generate_id(),
        username,
        display_name,
        password_hash,
        user_type,
        status: AccountStatus::Active,
        created_at: now.clone(),
        last_sign_in_at: None,
        history: vec![AccountActivityEntry {
            kind: ActivityKind::Created,
            timestamp: now,
            reason: None,
        }],
    };
    guard.push(account);
    if let Err(err) = account_repository::save(app, &guard) {
        guard.pop();
        return Err(format!("Échec de l'enregistrement du compte : {err}"));
    }
    Ok(Account::from(guard.last().expect("account was just pushed")))
}
pub fn list_accounts(accounts_store: &Accounts) -> Vec<Account> {
    accounts_store.lock().unwrap().iter().map(Account::from).collect()
}
pub async fn update_account(
    app: &AppHandle,
    accounts_store: &Accounts,
    username: String,
    display_name: Option<String>,
    user_type: Option<UserType>,
    password: Option<String>,
) -> Result<Account, String> {
    let display_name = match display_name {
        Some(name) => Some(account::validate_display_name(&name)?),
        None => None,
    };
    if let Some(ref pwd) = password {
        account::validate_password(pwd)?;
    }
    let new_password_hash = match password {
        Some(pwd) => Some(account::hash_password(&pwd)?),
        None => None,
    };
    let mut guard = accounts_store.lock().unwrap();
    let account = account::find_account_mut(&mut guard, &username)
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
    account::record_activity(account, ActivityKind::Modified, None);
    let updated = Account::from(&*account);
    if let Err(err) = account_repository::save(app, &guard) {
        if let Some(account) = account::find_account_mut(&mut guard, &username) {
            *account = previous;
        }
        return Err(format!("Échec de l'enregistrement du compte : {err}"));
    }
    Ok(updated)
}
pub async fn suspend_account(
    app: &AppHandle,
    accounts_store: &Accounts,
    username: String,
    reason: Option<String>,
) -> Result<Account, String> {
    let mut guard = accounts_store.lock().unwrap();
    let account =
        account::find_account_mut(&mut guard, &username).ok_or_else(|| "Compte introuvable.".to_string())?;
    let previous = account.clone();
    account::suspend(account, reason);
    let updated = Account::from(&*account);
    if let Err(err) = account_repository::save(app, &guard) {
        if let Some(account) = account::find_account_mut(&mut guard, &username) {
            *account = previous;
        }
        return Err(format!("Échec de l'enregistrement de la suspension : {err}"));
    }
    Ok(updated)
}
pub async fn reactivate_account(
    app: &AppHandle,
    accounts_store: &Accounts,
    username: String,
) -> Result<Account, String> {
    let mut guard = accounts_store.lock().unwrap();
    let account =
        account::find_account_mut(&mut guard, &username).ok_or_else(|| "Compte introuvable.".to_string())?;
    let previous = account.clone();
    account::reactivate(account);
    let updated = Account::from(&*account);
    if let Err(err) = account_repository::save(app, &guard) {
        if let Some(account) = account::find_account_mut(&mut guard, &username) {
            *account = previous;
        }
        return Err(format!("Échec de l'enregistrement de la réactivation : {err}"));
    }
    Ok(updated)
}
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
pub fn list_account_activities(accounts_store: &Accounts) -> Vec<AccountActivity> {
    account::list_activities(&accounts_store.lock().unwrap())
}
