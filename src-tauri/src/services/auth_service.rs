
use crate::config::accounts;
use crate::config::rate_limit;
use crate::repositories::account_repository;
use crate::services::account::Accounts;
use tauri::AppHandle;

/// Authenticate a user against a specific role (admin/cashier/counter),
/// applying per-role rate limiting, verifying the password hash, checking
/// account status, and minting a short-lived session token on success.
async fn authenticate(
    app: &AppHandle,
    accounts_store: &Accounts,
    auth_attempts: &rate_limit::AttemptTracker,
    sessions: &accounts::Sessions,
    username: String,
    password: String,
    expected_type: accounts::UserType,
    role: accounts::SessionRole,
    attempt_prefix: &str,
) -> Result<accounts::AuthResult, String> {
    let username = accounts::validate_username(&username)?;
    accounts::validate_password(&password)?;
    let attempt_key = format!("{attempt_prefix}:{}", username.to_lowercase());
    if let Some(remaining) = rate_limit::seconds_until_unlocked(auth_attempts, &attempt_key) {
        return Ok(accounts::AuthResult {
            success: false,
            account: None,
            error: Some(format!(
                "Trop de tentatives échouées. Réessayez dans {remaining} seconde(s)."
            )),
            session_token: None,
        });
    }
    let mut guard = accounts_store.lock().unwrap();
    let found = guard
        .iter_mut()
        .find(|a| a.username.eq_ignore_ascii_case(&username) && a.user_type == expected_type);
    let verified = match &found {
        Some(a) => accounts::verify_password(&password, &a.password_hash),
        None => false,
    };
    if !verified {
        drop(guard);
        rate_limit::record_failure(auth_attempts, &attempt_key);
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
        rate_limit::record_failure(auth_attempts, &attempt_key);
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
    if let Err(err) = account_repository::save(app, &guard) {
        if let Some(account) = accounts::find_account_mut(&mut guard, &username) {
            account.last_sign_in_at = previous_last_sign_in;
        }
        return Err(err);
    }
    drop(guard);
    rate_limit::record_success(auth_attempts, &attempt_key);
    let token = accounts::mint_session(sessions, &view.username, role);
    Ok(accounts::AuthResult {
        success: true,
        account: Some(view),
        error: None,
        session_token: Some(token),
    })
}

pub async fn authenticate_admin(
    app: &AppHandle,
    accounts_store: &Accounts,
    auth_attempts: &rate_limit::AttemptTracker,
    sessions: &accounts::Sessions,
    username: String,
    password: String,
) -> Result<accounts::AuthResult, String> {
    authenticate(
        app,
        accounts_store,
        auth_attempts,
        sessions,
        username,
        password,
        accounts::UserType::Admin,
        accounts::SessionRole::Admin,
        "admin",
    )
    .await
}

pub async fn authenticate_cashier(
    app: &AppHandle,
    accounts_store: &Accounts,
    auth_attempts: &rate_limit::AttemptTracker,
    sessions: &accounts::Sessions,
    username: String,
    password: String,
) -> Result<accounts::AuthResult, String> {
    authenticate(
        app,
        accounts_store,
        auth_attempts,
        sessions,
        username,
        password,
        accounts::UserType::Caissier,
        accounts::SessionRole::Cashier,
        "cashier",
    )
    .await
}

pub async fn authenticate_counter(
    app: &AppHandle,
    accounts_store: &Accounts,
    auth_attempts: &rate_limit::AttemptTracker,
    sessions: &accounts::Sessions,
    username: String,
    password: String,
) -> Result<accounts::AuthResult, String> {
    authenticate(
        app,
        accounts_store,
        auth_attempts,
        sessions,
        username,
        password,
        accounts::UserType::Comptoir,
        accounts::SessionRole::Counter,
        "counter",
    )
    .await
}
