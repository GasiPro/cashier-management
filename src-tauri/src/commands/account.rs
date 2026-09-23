use crate::config::accounts;
use crate::AppState;
use serde::Deserialize;
use tauri::State;

async fn create_account(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    username: String,
    password: String,
    display_name: String,
    user_type: accounts::UserType,
) -> Result<accounts::Account, String> {
    let username = accounts::validate_username(&username)?;
    accounts::validate_password(&password)?;
    let display_name = accounts::validate_display_name(&display_name)?;
    let mut guard = state.accounts.lock().unwrap();
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
    if let Err(err) = accounts::save(&app, &guard) {
        guard.pop();
        return Err(format!("Échec de l'enregistrement du compte : {err}"));
    }
    Ok(accounts::Account::from(guard.last().expect("account was just pushed")))
}
fn list_accounts(state: State<'_, AppState>) -> Vec<accounts::Account> {
    state.accounts.lock().unwrap().iter().map(accounts::Account::from).collect()
}
/// Modify an existing account's display name, user type, and/or password.
async fn update_account(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
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
    let mut guard = state.accounts.lock().unwrap();
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
    if let Err(err) = accounts::save(&app, &guard) {
        if let Some(account) = accounts::find_account_mut(&mut guard, &username) {
            *account = previous;
        }
        return Err(format!("Échec de l'enregistrement du compte : {err}"));
    }
    Ok(updated)
}
/// Suspend an account: a reversible block. The account and its history are
/// left untouched on disk — it's only flagged so it can no longer
async fn suspend_account(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    username: String,
    reason: Option<String>,
) -> Result<accounts::Account, String> {
    let mut guard = state.accounts.lock().unwrap();
    let account =
        accounts::find_account_mut(&mut guard, &username).ok_or_else(|| "Compte introuvable.".to_string())?;
    let previous = account.clone();
    accounts::suspend(account, reason);
    let updated = accounts::Account::from(&*account);
    if let Err(err) = accounts::save(&app, &guard) {
        if let Some(account) = accounts::find_account_mut(&mut guard, &username) {
            *account = previous;
        }
        return Err(format!("Échec de l'enregistrement de la suspension : {err}"));
    }
    Ok(updated)
}
/// Reactivate a previously suspended account, restoring its access. Called
/// from the Réglages UI via invoke().
async fn reactivate_account(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    username: String,
) -> Result<accounts::Account, String> {
    let mut guard = state.accounts.lock().unwrap();
    let account =
        accounts::find_account_mut(&mut guard, &username).ok_or_else(|| "Compte introuvable.".to_string())?;
    let previous = account.clone();
    accounts::reactivate(account);
    let updated = accounts::Account::from(&*account);
    if let Err(err) = accounts::save(&app, &guard) {
        if let Some(account) = accounts::find_account_mut(&mut guard, &username) {
            *account = previous;
        }
        return Err(format!("Échec de l'enregistrement de la réactivation : {err}"));
    }
    Ok(updated)
}
async fn delete_account(app: tauri::AppHandle, state: State<'_, AppState>, username: String) -> Result<(), String> {
    let mut guard = state.accounts.lock().unwrap();
    let index = guard
        .iter()
        .position(|a| a.username.eq_ignore_ascii_case(&username))
        .ok_or_else(|| "Compte introuvable.".to_string())?;
    let removed = guard.remove(index);
    if let Err(err) = accounts::save(&app, &guard) {
        guard.insert(index, removed);
        return Err(format!("Échec de l'enregistrement de la suppression : {err}"));
    }
    Ok(())
}
/// The activity log (created/suspended/reactivated/modified) across every
/// account, most recent first. Called from the Réglages UI via invoke().
fn list_account_activities(state: State<'_, AppState>) -> Vec<accounts::AccountActivity> {
    accounts::list_activities(&state.accounts.lock().unwrap())
}
#[derive(Debug, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case")]
enum AccountCommand {
    Create {
        username: String,
        password: String,
        display_name: String,
        user_type: accounts::UserType,
    },
    List,
    Update {
        username: String,
        display_name: Option<String>,
        user_type: Option<accounts::UserType>,
        password: Option<String>,
    },
    Suspend {
        username: String,
        reason: Option<String>,
    },
    Reactivate {
        username: String,
    },
    Delete {
        username: String,
    },
    Activities,
}
#[tauri::command]
pub async fn account(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    command: AccountCommand,
) -> Result<serde_json::Value, String> {
    match command {
        AccountCommand::Create {
            username,
            password,
            display_name,
            user_type,
        } => Ok(serde_json::json!(
            create_account(app, state, username, password, display_name, user_type).await?
        )),
        AccountCommand::List => Ok(serde_json::json!(list_accounts(state))),
        AccountCommand::Update {
            username,
            display_name,
            user_type,
            password,
        } => Ok(serde_json::json!(
            update_account(app, state, username, display_name, user_type, password).await?
        )),
        AccountCommand::Suspend { username, reason } => {
            Ok(serde_json::json!(suspend_account(app, state, username, reason).await?))
        }
        AccountCommand::Reactivate { username } => {
            Ok(serde_json::json!(reactivate_account(app, state, username).await?))
        }
        AccountCommand::Delete { username } => {
            delete_account(app, state, username).await?;
            Ok(serde_json::Value::Null)
        }
        AccountCommand::Activities => Ok(serde_json::json!(list_account_activities(state))),
    }
}
