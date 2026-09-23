use crate::domain::order::price_calculator::{ServiceItem, ServiceItemType as PriceCalculatorItemType};
use crate::{broadcast_to_approved, config, AppState, ServerMessage};
use serde::Deserialize;
use tauri::State;

fn get_pricing_matrix(state: State<'_, AppState>) -> Vec<ServiceItem> {
    state.pricing.lock().unwrap().clone()
}
/// Add a new item (service or product) to the pricing matrix. Persists to
/// disk and returns the created item, including its generated `id`.
async fn create_pricing_item(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    category: String,
    label: String,
    price: u32,
    item_type: PriceCalculatorItemType,
) -> Result<ServiceItem, String> {
    let category = config::pricing_matrix::validate_category(&category)?;
    let label = config::pricing_matrix::validate_label(&label)?;
    let (item, snapshot) = {
        let mut guard = state.pricing.lock().unwrap();
        let item = ServiceItem {
            id: config::pricing_matrix::generate_id(),
            item_type,
            category,
            label,
            price,
        };
        guard.push(item.clone());
        if let Err(err) = config::pricing_matrix::save(&app, &guard) {
            guard.pop();
            return Err(format!("Échec de l'enregistrement de l'article : {err}"));
        }
        (item, guard.clone())
    };
    broadcast_to_approved(&state.peers, &ServerMessage::Pricing { data: snapshot }).await;
    Ok(item)
}
async fn update_pricing_item(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    category: Option<String>,
    label: Option<String>,
    price: Option<u32>,
    item_type: Option<PriceCalculatorItemType>,
) -> Result<ServiceItem, String> {
    let category = match category {
        Some(c) => Some(config::pricing_matrix::validate_category(&c)?),
        None => None,
    };
    let label = match label {
        Some(l) => Some(config::pricing_matrix::validate_label(&l)?),
        None => None,
    };
    let (updated, snapshot) = {
        let mut guard = state.pricing.lock().unwrap();
        let item = config::pricing_matrix::find_item_mut(&mut guard, &id)
            .ok_or_else(|| "Article introuvable.".to_string())?;
        let previous = item.clone();
        if let Some(category) = category {
            item.category = category;
        }
        if let Some(label) = label {
            item.label = label;
        }
        if let Some(price) = price {
            item.price = price;
        }
        if let Some(item_type) = item_type {
            item.item_type = item_type;
        }
        let updated = item.clone();
        if let Err(err) = config::pricing_matrix::save(&app, &guard) {
            if let Some(item) = config::pricing_matrix::find_item_mut(&mut guard, &id) {
                *item = previous;
            }
            return Err(format!("Échec de l'enregistrement de l'article : {err}"));
        }
        (updated, guard.clone())
    };
    broadcast_to_approved(&state.peers, &ServerMessage::Pricing { data: snapshot }).await;
    Ok(updated)
}
/// Remove an item from the pricing matrix.
async fn delete_pricing_item(app: tauri::AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    let snapshot = {
        let mut guard = state.pricing.lock().unwrap();
        let index = guard
            .iter()
            .position(|item| item.id == id)
            .ok_or_else(|| "Article introuvable.".to_string())?;
        let removed = guard.remove(index);
        if let Err(err) = config::pricing_matrix::save(&app, &guard) {
            guard.insert(index, removed);
            return Err(format!("Échec de l'enregistrement de la suppression : {err}"));
        }
        guard.clone()
    };
    broadcast_to_approved(&state.peers, &ServerMessage::Pricing { data: snapshot }).await;
    Ok(())
}
#[derive(Debug, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case")]
enum PricingCommand {
    GetMatrix,
    ItemCreate {
        category: String,
        label: String,
        price: u32,
        item_type: PriceCalculatorItemType,
    },
    ItemUpdate {
        id: String,
        category: Option<String>,
        label: Option<String>,
        price: Option<u32>,
        item_type: Option<PriceCalculatorItemType>,
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
        PricingCommand::GetMatrix => Ok(serde_json::json!(get_pricing_matrix(state))),
        PricingCommand::ItemCreate {
            category,
            label,
            price,
            item_type,
        } => Ok(serde_json::json!(
            create_pricing_item(app, state, category, label, price, item_type).await?
        )),
        PricingCommand::ItemUpdate {
            id,
            category,
            label,
            price,
            item_type,
        } => Ok(serde_json::json!(
            update_pricing_item(app, state, id, category, label, price, item_type).await?
        )),
        PricingCommand::ItemDelete { id } => {
            delete_pricing_item(app, state, id).await?;
            Ok(serde_json::Value::Null)
        }
    }
}
