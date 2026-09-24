use crate::app::AppState;
use crate::models::account::UserType;
use crate::services::account_service;
use serde::Deserialize;
use tauri::State;
#[derive(Debug, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case")]
pub enum AccountCommand {
    Create {
        username: String,
        password: String,
        display_name: String,
        user_type: UserType,
    },
    List,
    Update {
        username: String,
        display_name: Option<String>,
        user_type: Option<UserType>,
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
            account_service::create_account(&app, &state.accounts, username, password, display_name, user_type)
                .await?
        )),
        AccountCommand::List => Ok(serde_json::json!(account_service::list_accounts(&state.accounts))),
        AccountCommand::Update {
            username,
            display_name,
            user_type,
            password,
        } => Ok(serde_json::json!(
            account_service::update_account(&app, &state.accounts, username, display_name, user_type, password)
                .await?
        )),
        AccountCommand::Suspend { username, reason } => Ok(serde_json::json!(
            account_service::suspend_account(&app, &state.accounts, username, reason).await?
        )),
        AccountCommand::Reactivate { username } => Ok(serde_json::json!(
            account_service::reactivate_account(&app, &state.accounts, username).await?
        )),
        AccountCommand::Delete { username } => {
            account_service::delete_account(&app, &state.accounts, username).await?;
            Ok(serde_json::Value::Null)
        }
        AccountCommand::Activities => Ok(serde_json::json!(account_service::list_account_activities(
            &state.accounts
        ))),
    }
}
