use crate::app::AppState;
use crate::infrastructure::websocket::broadcast_to_approved;
use crate::models::connection::ServerMessage;
use crate::models::pricing::ServiceItemType;
use crate::services::pricing_service;
use serde::Deserialize;
use tauri::State;
#[derive(Debug, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case")]
pub enum PricingCommand {
    GetMatrix,
    ItemCreate {
        category: String,
        label: String,
        price: u32,
        item_type: ServiceItemType,
    },
    ItemUpdate {
        id: String,
        category: Option<String>,
        label: Option<String>,
        price: Option<u32>,
        item_type: Option<ServiceItemType>,
    },
    ItemDelete {
        id: String,
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
        PricingCommand::ItemCreate {
            category,
            label,
            price,
            item_type,
        } => {
            let (item, snapshot) = pricing_service::create_pricing_item(
                &app,
                &state.pricing,
                category,
                label,
                price,
                item_type,
            )
            .await?;
            broadcast_to_approved(&state.peers, &ServerMessage::Pricing { data: snapshot }).await;
            Ok(serde_json::json!(item))
        }
        PricingCommand::ItemUpdate {
            id,
            category,
            label,
            price,
            item_type,
        } => {
            let (updated, snapshot) = pricing_service::update_pricing_item(
                &app,
                &state.pricing,
                id,
                category,
                label,
                price,
                item_type,
            )
            .await?;
            broadcast_to_approved(&state.peers, &ServerMessage::Pricing { data: snapshot }).await;
            Ok(serde_json::json!(updated))
        }
        PricingCommand::ItemDelete { id } => {
            let snapshot = pricing_service::delete_pricing_item(&app, &state.pricing, id).await?;
            broadcast_to_approved(&state.peers, &ServerMessage::Pricing { data: snapshot }).await;
            Ok(serde_json::Value::Null)
        }
    }
}
