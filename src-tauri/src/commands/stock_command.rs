use crate::app::AppState;
use crate::infrastructure::websocket::broadcast_to_approved;
use crate::models::connection::ServerMessage;
use crate::models::pricing::ServiceItemType;
use crate::models::stock::{NewStockItem, StockItemFields};
use crate::services::stock_service;
use serde::Deserialize;
use tauri::State;
#[derive(Debug, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case")]
pub enum StockCommand {
    List,
    History,
    SetAvailability {
        id: String,
        available: bool,
        username: String,
    },
    SetQuantity {
        id: String,
        quantity: Option<u32>,
        username: String,
    },
    CreateItem {
        #[serde(rename = "type")]
        item_type: ServiceItemType,
        category: String,
        label: String,
        price: Option<u32>,
        quantity: Option<u32>,
        username: String,
    },
    UpdateItem {
        id: String,
        #[serde(rename = "type")]
        item_type: ServiceItemType,
        category: String,
        label: String,
    },
}
#[tauri::command]
pub async fn stock(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    command: StockCommand,
) -> Result<serde_json::Value, String> {
    match command {
        StockCommand::List => Ok(serde_json::json!(stock_service::list_items(
            &state.pricing,
            &state.stock
        ))),
        StockCommand::History => Ok(serde_json::json!(stock_service::list_history(
            &state.stock
        ))),
        StockCommand::SetAvailability {
            id,
            available,
            username,
        } => {
            let (view, snapshot) = stock_service::set_availability(
                &app,
                &state.accounts,
                &state.pricing,
                &state.stock,
                id,
                available,
                &username,
            )?;
            broadcast_to_approved(&state.peers, &ServerMessage::Pricing { data: snapshot }).await;
            Ok(serde_json::json!(view))
        }
        StockCommand::SetQuantity {
            id,
            quantity,
            username,
        } => Ok(serde_json::json!(stock_service::set_quantity(
            &app,
            &state.accounts,
            &state.pricing,
            &state.stock,
            id,
            quantity,
            &username,
        )?)),
        StockCommand::CreateItem {
            item_type,
            category,
            label,
            price,
            quantity,
            username,
        } => {
            let (view, snapshot) = stock_service::create_item(
                &app,
                &state.accounts,
                &state.pricing,
                &state.stock,
                NewStockItem {
                    fields: StockItemFields {
                        item_type,
                        category,
                        label,
                    },
                    price,
                    quantity,
                },
                &username,
            )?;
            broadcast_to_approved(&state.peers, &ServerMessage::Pricing { data: snapshot }).await;
            Ok(serde_json::json!(view))
        }
        StockCommand::UpdateItem {
            id,
            item_type,
            category,
            label,
        } => {
            let (view, snapshot) = stock_service::update_item(
                &app,
                &state.pricing,
                &state.stock,
                id,
                StockItemFields {
                    item_type,
                    category,
                    label,
                },
            )?;
            broadcast_to_approved(&state.peers, &ServerMessage::Pricing { data: snapshot }).await;
            Ok(serde_json::json!(view))
        }
    }
}
