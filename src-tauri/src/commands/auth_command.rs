use crate::app::AppState;
use crate::models::account::AuthResult;
use crate::services::auth_service;
use serde::Deserialize;
use tauri::State;
#[derive(Debug, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case")]
pub enum AuthCommand {
    Admin { username: String, password: String },
    Cashier { username: String, password: String },
    Counter { username: String, password: String },
}
#[tauri::command]
pub async fn auth(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    command: AuthCommand,
) -> Result<AuthResult, String> {
    match command {
        AuthCommand::Admin { username, password } => {
            auth_service::authenticate_admin(
                &app,
                &state.accounts,
                &state.auth_attempts,
                &state.sessions,
                username,
                password,
            )
            .await
        }
        AuthCommand::Cashier { username, password } => {
            auth_service::authenticate_cashier(
                &app,
                &state.accounts,
                &state.auth_attempts,
                &state.sessions,
                username,
                password,
            )
            .await
        }
        AuthCommand::Counter { username, password } => {
            auth_service::authenticate_counter(
                &app,
                &state.accounts,
                &state.auth_attempts,
                &state.sessions,
                username,
                password,
            )
            .await
        }
    }
}
