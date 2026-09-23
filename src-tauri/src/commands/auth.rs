use crate::config::{accounts, rate_limit};
use crate::AppState;
use serde::Deserialize;
use tauri::State;

async fn authenticate_admin(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> Result<accounts::AuthResult, String> {
    let username = accounts::validate_username(&username)?;
    accounts::validate_password(&password)?;
    let attempt_key = format!("admin:{}", username.to_lowercase());
    if let Some(remaining) = rate_limit::seconds_until_unlocked(&state.auth_attempts, &attempt_key) {
        return Ok(accounts::AuthResult {
            success: false,
            account: None,
            error: Some(format!(
                "Trop de tentatives échouées. Réessayez dans {remaining} seconde(s)."
            )),
            session_token: None,
        });
    }
    let mut guard = state.accounts.lock().unwrap();
    let found = guard.iter_mut().find(|a| {
        a.username.eq_ignore_ascii_case(&username) && a.user_type == accounts::UserType::Admin
    });
    let verified = match &found {
        Some(a) => accounts::verify_password(&password, &a.password_hash),
        None => false,
    };
    if !verified {
        drop(guard);
        rate_limit::record_failure(&state.auth_attempts, &attempt_key);
        return Ok(accounts::AuthResult {
            success: false,
            account: None,
            error: Some("Nom d'utilisateur ou mot de passe incorrect.".to_string()),
            session_token: None,
        });
    }
    let account = found.expect("verified implies the account was found");
    if account.status == accounts::AccountStatus::Suspended {
        drop(guard);
        rate_limit::record_failure(&state.auth_attempts, &attempt_key);
        return Ok(accounts::AuthResult {
            success: false,
            account: None,
            error: Some("Ce compte a été suspendu. Contactez un administrateur.".to_string()),
            session_token: None,
        });
    }
    let previous_last_sign_in = account.last_sign_in_at.clone();
    account.last_sign_in_at = Some(chrono::Local::now().to_rfc3339());
    let view = accounts::Account::from(&*account);
    if let Err(err) = accounts::save(&app, &guard) {
        if let Some(account) = accounts::find_account_mut(&mut guard, &username) {
            account.last_sign_in_at = previous_last_sign_in;
        }
        return Err(err);
    }
    drop(guard);
    rate_limit::record_success(&state.auth_attempts, &attempt_key);
    let token = accounts::mint_session(&state.sessions, &view.username, accounts::SessionRole::Admin);
    Ok(accounts::AuthResult {
        success: true,
        account: Some(view),
        error: None,
        session_token: Some(token),
    })
}
async fn authenticate_cashier(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> Result<accounts::AuthResult, String> {
    let username = accounts::validate_username(&username)?;
    accounts::validate_password(&password)?;
    let attempt_key = format!("cashier:{}", username.to_lowercase());
    if let Some(remaining) = rate_limit::seconds_until_unlocked(&state.auth_attempts, &attempt_key) {
        return Ok(accounts::AuthResult {
            success: false,
            account: None,
            error: Some(format!(
                "Trop de tentatives échouées. Réessayez dans {remaining} seconde(s)."
            )),
            session_token: None,
        });
    }
    let mut guard = state.accounts.lock().unwrap();
    let found = guard.iter_mut().find(|a| {
        a.username.eq_ignore_ascii_case(&username) && a.user_type == accounts::UserType::Caissier
    });
    let verified = match &found {
        Some(a) => accounts::verify_password(&password, &a.password_hash),
        None => false,
    };
    if !verified {
        drop(guard);
        rate_limit::record_failure(&state.auth_attempts, &attempt_key);
        return Ok(accounts::AuthResult {
            success: false,
            account: None,
            error: Some("Nom d'utilisateur ou mot de passe incorrect.".to_string()),
            session_token: None,
        });
    }
    let account = found.expect("verified implies the account was found");
    if account.status == accounts::AccountStatus::Suspended {
        drop(guard);
        rate_limit::record_failure(&state.auth_attempts, &attempt_key);
        return Ok(accounts::AuthResult {
            success: false,
            account: None,
            error: Some("Ce compte a été suspendu. Contactez un administrateur.".to_string()),
            session_token: None,
        });
    }
    let previous_last_sign_in = account.last_sign_in_at.clone();
    account.last_sign_in_at = Some(chrono::Local::now().to_rfc3339());
    let view = accounts::Account::from(&*account);
    if let Err(err) = accounts::save(&app, &guard) {
        if let Some(account) = accounts::find_account_mut(&mut guard, &username) {
            account.last_sign_in_at = previous_last_sign_in;
        }
        return Err(err);
    }
    drop(guard);
    rate_limit::record_success(&state.auth_attempts, &attempt_key);
    let token = accounts::mint_session(&state.sessions, &view.username, accounts::SessionRole::Cashier);
    Ok(accounts::AuthResult {
        success: true,
        account: Some(view),
        error: None,
        session_token: Some(token),
    })
}
async fn authenticate_counter(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> Result<accounts::AuthResult, String> {
    let username = accounts::validate_username(&username)?;
    accounts::validate_password(&password)?;
    let attempt_key = format!("counter:{}", username.to_lowercase());
    if let Some(remaining) = rate_limit::seconds_until_unlocked(&state.auth_attempts, &attempt_key) {
        return Ok(accounts::AuthResult {
            success: false,
            account: None,
            error: Some(format!(
                "Trop de tentatives échouées. Réessayez dans {remaining} seconde(s)."
            )),
            session_token: None,
        });
    }
    let mut guard = state.accounts.lock().unwrap();
    let found = guard.iter_mut().find(|a| {
        a.username.eq_ignore_ascii_case(&username) && a.user_type == accounts::UserType::Comptoir
    });
    let verified = match &found {
        Some(a) => accounts::verify_password(&password, &a.password_hash),
        None => false,
    };
    if !verified {
        drop(guard);
        rate_limit::record_failure(&state.auth_attempts, &attempt_key);
        return Ok(accounts::AuthResult {
            success: false,
            account: None,
            error: Some("Nom d'utilisateur ou mot de passe incorrect.".to_string()),
            session_token: None,
        });
    }
    let account = found.expect("verified implies the account was found");
    if account.status == accounts::AccountStatus::Suspended {
        drop(guard);
        rate_limit::record_failure(&state.auth_attempts, &attempt_key);
        return Ok(accounts::AuthResult {
            success: false,
            account: None,
            error: Some("Ce compte a été suspendu. Contactez un administrateur.".to_string()),
            session_token: None,
        });
    }
    let previous_last_sign_in = account.last_sign_in_at.clone();
    account.last_sign_in_at = Some(chrono::Local::now().to_rfc3339());
    let view = accounts::Account::from(&*account);
    if let Err(err) = accounts::save(&app, &guard) {
        if let Some(account) = accounts::find_account_mut(&mut guard, &username) {
            account.last_sign_in_at = previous_last_sign_in;
        }
        return Err(err);
    }
    drop(guard);
    rate_limit::record_success(&state.auth_attempts, &attempt_key);
    let token = accounts::mint_session(&state.sessions, &view.username, accounts::SessionRole::Counter);
    Ok(accounts::AuthResult {
        success: true,
        account: Some(view),
        error: None,
        session_token: Some(token),
    })
}
#[derive(Debug, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case")]
enum AuthCommand {
    Admin { username: String, password: String },
    Cashier { username: String, password: String },
    Counter { username: String, password: String },
}
#[tauri::command]
pub async fn auth(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    command: AuthCommand,
) -> Result<accounts::AuthResult, String> {
    match command {
        AuthCommand::Admin { username, password } => authenticate_admin(app, state, username, password).await,
        AuthCommand::Cashier { username, password } => authenticate_cashier(app, state, username, password).await,
        AuthCommand::Counter { username, password } => authenticate_counter(app, state, username, password).await,
    }
}
