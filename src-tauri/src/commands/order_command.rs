use crate::app::AppState;
use crate::infrastructure::websocket::{broadcast_orders_to_approved, notify_counter};
use crate::models::connection::ServerMessage;
use crate::models::order::{CartItem, OrderChange, OrderChangeKind};
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
        handled_by: Option<String>,
    },
    GroupReject {
        group_id: i64,
        raison: Option<String>,
        handled_by: Option<String>,
    },
}
async fn broadcast_orders(state: &AppState) {
    broadcast_orders_to_approved(&state.peers, &state.order_service.get_orders()).await;
}
fn pending_group_owner(state: &AppState, group_id: i64) -> Option<String> {
    state
        .order_service
        .get_pending()
        .into_iter()
        .find(|o| o.group_id == group_id)
        .map(|o| o.counter_username)
        .filter(|name| !name.is_empty())
}
async fn notify_group_owner(
    state: &AppState,
    owner: Option<String>,
    kind: OrderChangeKind,
    group_id: i64,
    reason: Option<String>,
) {
    let Some(counter_username) = owner else {
        return;
    };
    let message = ServerMessage::OrderNotification {
        data: OrderChange {
            kind,
            group_id,
            counter_username: counter_username.clone(),
            reason,
        },
    };
    notify_counter(&state.peers, &counter_username, &message).await;
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
        OrderCommand::GroupMarkPaid {
            group_id,
            handled_by,
        } => {
            let owner = pending_group_owner(&state, group_id);
            orders.mark_group_as_paid(group_id, handled_by)?;
            broadcast_orders(&state).await;
            notify_group_owner(&state, owner, OrderChangeKind::Paid, group_id, None).await;
            Ok(serde_json::Value::Null)
        }
        OrderCommand::GroupReject {
            group_id,
            raison,
            handled_by,
        } => {
            let owner = pending_group_owner(&state, group_id);
            let reason = raison
                .as_deref()
                .map(str::trim)
                .filter(|r| !r.is_empty())
                .map(str::to_string);
            orders.reject_group(group_id, raison, handled_by)?;
            broadcast_orders(&state).await;
            notify_group_owner(&state, owner, OrderChangeKind::Rejected, group_id, reason).await;
            Ok(serde_json::Value::Null)
        }
    }
}
