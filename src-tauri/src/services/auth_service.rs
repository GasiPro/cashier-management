use crate::config::rate_limit;
use crate::domain::account;
use crate::models::account::{Account, AccountStatus, AuthResult, SessionRole, Sessions, UserType};
use crate::repositories::account_repository;
use crate::services::account_service::Accounts;
use tauri::AppHandle;
async fn authenticate(
    app: &AppHandle,
    accounts_store: &Accounts,
    auth_attempts: &rate_limit::AttemptTracker,
    sessions: &Sessions,
    username: String,
    password: String,
    expected_type: UserType,
    role: SessionRole,
    attempt_prefix: &str,
) -> Result<AuthResult, String> {
    let username = account::validate_username(&username)?;
    account::validate_password(&password)?;
    let attempt_key = format!("{attempt_prefix}:{}", username.to_lowercase());
    if let Some(remaining) = rate_limit::seconds_until_unlocked(auth_attempts, &attempt_key) {
        return Ok(AuthResult {
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
        Some(a) => account::verify_password(&password, &a.password_hash),
        None => false,
    };
    if !verified {
        drop(guard);
        rate_limit::record_failure(auth_attempts, &attempt_key);
        return Ok(AuthResult {
            success: false,
            account: None,
            error: Some("Nom d'utilisateur ou mot de passe incorrect.".to_string()),
            session_token: None,
        });
    }
    let account = found.expect("verified implies the account was found");
    if account.status == AccountStatus::Suspended {
        drop(guard);
        rate_limit::record_failure(auth_attempts, &attempt_key);
        return Ok(AuthResult {
            success: false,
            account: None,
            error: Some("Ce compte a été suspendu. Contactez un administrateur.".to_string()),
            session_token: None,
        });
    }
    let previous_last_sign_in = account.last_sign_in_at.clone();
    account.last_sign_in_at = Some(chrono::Local::now().to_rfc3339());
    let view = Account::from(&*account);
    if let Err(err) = account_repository::save(app, &guard) {
        if let Some(account) = account::find_account_mut(&mut guard, &username) {
            account.last_sign_in_at = previous_last_sign_in;
        }
        return Err(err);
    }
    drop(guard);
    rate_limit::record_success(auth_attempts, &attempt_key);
    let token = account::mint_session(sessions, &view.username, role);
    Ok(AuthResult {
        success: true,
        account: Some(view),
        error: None,
        session_token: Some(token),
    })
}
pub(crate) async fn authenticate_admin(
    app: &AppHandle,
    accounts_store: &Accounts,
    auth_attempts: &rate_limit::AttemptTracker,
    sessions: &Sessions,
    username: String,
    password: String,
) -> Result<AuthResult, String> {
    authenticate(
        app,
        accounts_store,
        auth_attempts,
        sessions,
        username,
        password,
        UserType::Admin,
        SessionRole::Admin,
        "admin",
    )
    .await
}
pub(crate) async fn authenticate_cashier(
    app: &AppHandle,
    accounts_store: &Accounts,
    auth_attempts: &rate_limit::AttemptTracker,
    sessions: &Sessions,
    username: String,
    password: String,
) -> Result<AuthResult, String> {
    authenticate(
        app,
        accounts_store,
        auth_attempts,
        sessions,
        username,
        password,
        UserType::Caissier,
        SessionRole::Cashier,
        "cashier",
    )
    .await
}
pub(crate) async fn authenticate_counter(
    app: &AppHandle,
    accounts_store: &Accounts,
    auth_attempts: &rate_limit::AttemptTracker,
    sessions: &Sessions,
    username: String,
    password: String,
) -> Result<AuthResult, String> {
    authenticate(
        app,
        accounts_store,
        auth_attempts,
        sessions,
        username,
        password,
        UserType::Comptoir,
        SessionRole::Counter,
        "counter",
    )
    .await
}
