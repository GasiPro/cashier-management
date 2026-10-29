use crate::app::AppState;
use crate::infrastructure::websocket::broadcast_orders_to_approved;
use crate::models::order::CartItem;
use serde::Deserialize;
use tauri::State;
#[derive(Debug, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case")]
pub enum OrderCommand {
    List,
    Pending,
    Paid,
    Create {
        cart: Vec<CartItem>,
        counter_username: String,
    },
    GroupMarkPaid {
        group_id: i64,
    },
    GroupReject {
        group_id: i64,
        raison: Option<String>,
    },
}
async fn broadcast_orders(state: &AppState) {
    broadcast_orders_to_approved(&state.peers, &state.order_service.get_orders()).await;
}
#[tauri::command]
pub async fn order(
    state: State<'_, AppState>,
    command: OrderCommand,
) -> Result<serde_json::Value, String> {
    let orders = &state.order_service;
    match command {
        OrderCommand::List => Ok(serde_json::json!(orders.get_orders())),
        OrderCommand::Pending => Ok(serde_json::json!(orders.get_pending())),
        OrderCommand::Paid => Ok(serde_json::json!(orders.get_paid())),
        OrderCommand::Create {
            cart,
            counter_username,
        } => {
            orders.create_order(&cart, &counter_username, None)?;
            broadcast_orders(&state).await;
            Ok(serde_json::Value::Null)
        }
        OrderCommand::GroupMarkPaid { group_id } => {
            orders.mark_group_as_paid(group_id)?;
            broadcast_orders(&state).await;
            Ok(serde_json::Value::Null)
        }
        OrderCommand::GroupReject { group_id, raison } => {
            orders.reject_group(group_id, raison)?;
            broadcast_orders(&state).await;
            Ok(serde_json::Value::Null)
        }
    }
}
