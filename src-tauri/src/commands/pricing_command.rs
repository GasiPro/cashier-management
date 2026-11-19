use crate::app::AppState;
use crate::infrastructure::websocket::broadcast_to_approved;
use crate::models::connection::ServerMessage;
use crate::models::pricing::{MorInput, PriceAdjustmentKind};
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
        price_editable: Option<bool>,
        majoration: Option<MorInput>,
        reduction: Option<MorInput>,
        username: String,
    },
    MorSet {
        id: String,
        kind: PriceAdjustmentKind,
        rate: u32,
        days: Option<u32>,
        max_orders: Option<u32>,
        username: String,
    },
    MorDelete {
        id: String,
        kind: PriceAdjustmentKind,
    },
    HistoryGet,
    LogGet,
    CurrencyGet,
    CurrencySet {
        code: String,
        name: Option<String>,
        username: String,
    },
}
#[tauri::command]
pub async fn pricing(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    command: PricingCommand,
) -> Result<serde_json::Value, String> {
    match command {
        PricingCommand::GetMatrix => {
            if let Some(snapshot) = pricing_service::purge_expired(&app, &state.pricing) {
                broadcast_to_approved(&state.peers, &ServerMessage::Pricing { data: snapshot })
                    .await;
            }
            Ok(serde_json::json!(pricing_service::get_pricing_matrix(
                &state.pricing
            )))
        }
        PricingCommand::ItemUpdate {
            id,
            price,
            price_editable,
            majoration,
            reduction,
            username,
        } => {
            let (updated, snapshot) = pricing_service::update_pricing_item(
                &app,
                &state.accounts,
                &state.pricing,
                id,
                price,
                price_editable,
                majoration,
                reduction,
                &username,
            )?;
            broadcast_to_approved(&state.peers, &ServerMessage::Pricing { data: snapshot }).await;
            Ok(serde_json::json!(updated))
        }
        PricingCommand::MorSet {
            id,
            kind,
            rate,
            days,
            max_orders,
            username,
        } => {
            let input = MorInput {
                rate,
                days,
                max_orders,
            };
            let (updated, snapshot) = pricing_service::set_mor(
                &app,
                &state.accounts,
                &state.pricing,
                id,
                kind,
                input,
                &username,
            )?;
            broadcast_to_approved(&state.peers, &ServerMessage::Pricing { data: snapshot }).await;
            Ok(serde_json::json!(updated))
        }
        PricingCommand::MorDelete { id, kind } => {
            let (updated, snapshot) =
                pricing_service::delete_mor(&app, &state.pricing, id, kind)?;
            broadcast_to_approved(&state.peers, &ServerMessage::Pricing { data: snapshot }).await;
            Ok(serde_json::json!(updated))
        }
        PricingCommand::HistoryGet => Ok(serde_json::json!(pricing_service::get_price_history(
            &app
        ))),
        PricingCommand::LogGet => Ok(serde_json::json!(pricing_service::get_price_log(&app))),
        PricingCommand::CurrencyGet => Ok(serde_json::json!(pricing_service::get_currency(&app))),
        PricingCommand::CurrencySet {
            code,
            name,
            username,
        } => Ok(serde_json::json!(pricing_service::set_currency(
            &app,
            &state.accounts,
            code,
            name,
            &username
        )?)),
    }
}
