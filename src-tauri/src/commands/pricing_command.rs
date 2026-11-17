use crate::app::AppState;
use crate::infrastructure::websocket::broadcast_to_approved;
use crate::models::connection::ServerMessage;
use crate::services::pricing_service;
use serde::Deserialize;
use tauri::State;
#[derive(Debug, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case")]
pub enum PricingCommand {
    GetMatrix,
    ItemUpdate {
        id: String,
        price: Option<u32>,
        allow_majoration: Option<bool>,
        allow_reduction: Option<bool>,
        price_editable: Option<bool>,
    },
    HistoryGet,
    CurrencyGet,
    CurrencySet {
        code: String,
        name: Option<String>,
    },
}
#[tauri::command]
pub async fn pricing(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    command: PricingCommand,
) -> Result<serde_json::Value, String> {
    match command {
        PricingCommand::GetMatrix => Ok(serde_json::json!(pricing_service::get_pricing_matrix(
            &state.pricing
        ))),
        PricingCommand::ItemUpdate {
            id,
            price,
            allow_majoration,
            allow_reduction,
            price_editable,
        } => {
            let (updated, snapshot) = pricing_service::update_pricing_item(
                &app,
                &state.pricing,
                id,
                price,
                allow_majoration,
                allow_reduction,
                price_editable,
            )
            .await?;
            broadcast_to_approved(&state.peers, &ServerMessage::Pricing { data: snapshot }).await;
            Ok(serde_json::json!(updated))
        }
        PricingCommand::HistoryGet => Ok(serde_json::json!(pricing_service::get_price_history(
            &app
        ))),
        PricingCommand::CurrencyGet => Ok(serde_json::json!(pricing_service::get_currency(&app))),
        PricingCommand::CurrencySet { code, name } => Ok(serde_json::json!(
            pricing_service::set_currency(&app, code, name)?
        )),
    }
}
