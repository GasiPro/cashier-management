use crate::app::AppState;
use crate::services::report_service;
use serde::Deserialize;
use tauri::State;

#[derive(Debug, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case")]
pub enum ReportCommand {
    List,
    Submit {
        cashier_username: String,
        payload: serde_json::Value,
    },
}

#[tauri::command]
pub async fn report(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    command: ReportCommand,
) -> Result<serde_json::Value, String> {
    match command {
        ReportCommand::List => Ok(serde_json::json!(report_service::list_reports(
            &state.reports
        ))),
        ReportCommand::Submit {
            cashier_username,
            payload,
        } => {
            report_service::submit_report(&app, &state.reports, cashier_username, payload)?;
            Ok(serde_json::Value::Null)
        }
    }
}
