use crate::config::pricing_matrix;
use crate::domain::order::price_calculator;
use crate::models::pricing::{ServiceItem, ServiceItemType};
use crate::repositories::pricing_repository;
use std::sync::{Arc, Mutex as SyncMutex};
use tauri::AppHandle;
pub type PricingStore = Arc<SyncMutex<Vec<ServiceItem>>>;
pub fn load_or_bootstrap(app: &AppHandle) -> Vec<ServiceItem> {
    if let Some(items) = pricing_repository::load(app) {
        return items;
    }
    let items = pricing_matrix::default_items();
    let _ = pricing_repository::save(app, &items);
    items
}
pub fn get_pricing_matrix(pricing: &PricingStore) -> Vec<ServiceItem> {
    pricing.lock().unwrap().clone()
}
pub async fn create_pricing_item(
    app: &AppHandle,
    pricing: &PricingStore,
    category: String,
    label: String,
    price: u32,
    item_type: ServiceItemType,
) -> Result<(ServiceItem, Vec<ServiceItem>), String> {
    let category = price_calculator::validate_category(&category)?;
    let label = price_calculator::validate_label(&label)?;
    let mut guard = pricing.lock().unwrap();
    let item = ServiceItem {
        id: price_calculator::generate_id(),
        item_type,
        category,
        label,
        price,
    };
    guard.push(item.clone());
    if let Err(err) = pricing_repository::save(app, &guard) {
        guard.pop();
        return Err(format!("Échec de l'enregistrement de l'article : {err}"));
    }
    Ok((item, guard.clone()))
}
pub async fn update_pricing_item(
    app: &AppHandle,
    pricing: &PricingStore,
    id: String,
    category: Option<String>,
    label: Option<String>,
    price: Option<u32>,
    item_type: Option<ServiceItemType>,
) -> Result<(ServiceItem, Vec<ServiceItem>), String> {
    let category = match category {
        Some(c) => Some(price_calculator::validate_category(&c)?),
        None => None,
    };
    let label = match label {
        Some(l) => Some(price_calculator::validate_label(&l)?),
        None => None,
    };
    let mut guard = pricing.lock().unwrap();
    let item =
        price_calculator::find_item_mut(&mut guard, &id).ok_or_else(|| "Article introuvable.".to_string())?;
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
    if let Err(err) = pricing_repository::save(app, &guard) {
        if let Some(item) = price_calculator::find_item_mut(&mut guard, &id) {
            *item = previous;
        }
        return Err(format!("Échec de l'enregistrement de l'article : {err}"));
    }
    Ok((updated, guard.clone()))
}
pub async fn delete_pricing_item(
    app: &AppHandle,
    pricing: &PricingStore,
    id: String,
) -> Result<Vec<ServiceItem>, String> {
    let mut guard = pricing.lock().unwrap();
    let index = guard
        .iter()
        .position(|item| item.id == id)
        .ok_or_else(|| "Article introuvable.".to_string())?;
    let removed = guard.remove(index);
    if let Err(err) = pricing_repository::save(app, &guard) {
        guard.insert(index, removed);
        return Err(format!("Échec de l'enregistrement de la suppression : {err}"));
    }
    Ok(guard.clone())
}
