use crate::domain::order::price_calculator::CartItem;
use crate::service::order_api_service::Order;
use crate::{broadcast_orders_to_approved, AppState};
use serde::Deserialize;
use tauri::State;

/// One-shot invoke()-based fetch of every order, for admin/read-only views.
/// This is the invoke() alternative to the WebSocket `orders` broadcast that
/// approved peers (see `AdminRegister` / `CashierRegister`) receive live.
fn get_orders(state: State<'_, AppState>) -> Vec<Order> {
    state.order_service.get_orders()
}
fn get_pending_orders(state: State<'_, AppState>) -> Vec<Order> {
    state.order_service.get_pending()
}
/// invoke()-based alternative to the WebSocket `orders` broadcast, scoped to
/// paid orders only.
fn get_paid_orders(state: State<'_, AppState>) -> Vec<Order> {
    state.order_service.get_paid()
}
async fn create_order(state: State<'_, AppState>, cart: Vec<CartItem>, counter_username: String) -> Result<(), String> {
    state.order_service.create_order(&cart, &counter_username)?;
    broadcast_orders_to_approved(&state.peers, &state.order_service.get_orders()).await;
    Ok(())
}
async fn mark_group_as_paid(state: State<'_, AppState>, group_id: i64) -> Result<(), String> {
    state.order_service.mark_group_as_paid(group_id)?;
    broadcast_orders_to_approved(&state.peers, &state.order_service.get_orders()).await;
    Ok(())
}
async fn reject_group(state: State<'_, AppState>, group_id: i64, raison: Option<String>) -> Result<(), String> {
    state.order_service.reject_group(group_id, raison)?;
    broadcast_orders_to_approved(&state.peers, &state.order_service.get_orders()).await;
    Ok(())
}
#[derive(Debug, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case")]
enum OrderCommand {
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
/// Consolidated Tauri command for the order surface. The frontend invokes a
/// single `order` command with a tagged `method` field, and this dispatches
/// to the corresponding implementation below:
///
/// - `list`             -> `get_orders`
/// - `pending`           -> `get_pending_orders`
/// - `paid`              -> `get_paid_orders`
/// - `create`            -> `create_order`
/// - `group_mark_paid`   -> `mark_group_as_paid`
/// - `group_reject`      -> `reject_group`
#[tauri::command]
pub async fn order(state: State<'_, AppState>, command: OrderCommand) -> Result<serde_json::Value, String> {
    match command {
        OrderCommand::List => Ok(serde_json::json!(get_orders(state))),
        OrderCommand::Pending => Ok(serde_json::json!(get_pending_orders(state))),
        OrderCommand::Paid => Ok(serde_json::json!(get_paid_orders(state))),
        OrderCommand::Create { cart, counter_username } => {
            create_order(state, cart, counter_username).await?;
            Ok(serde_json::Value::Null)
        }
        OrderCommand::GroupMarkPaid { group_id } => {
            mark_group_as_paid(state, group_id).await?;
            Ok(serde_json::Value::Null)
        }
        OrderCommand::GroupReject { group_id, raison } => {
            reject_group(state, group_id, raison).await?;
            Ok(serde_json::Value::Null)
        }
    }
}
