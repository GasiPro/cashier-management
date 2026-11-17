use crate::config::stock_config::{MAX_QUANTITY, MAX_STOCK_HISTORY_ENTRIES};
use crate::domain::pricing::find_item_mut;
use crate::models::account::{AccountStatus, UserType};
use crate::models::pricing::{ServiceItem, ServiceItemType};
use crate::models::stock::{StockAction, StockData, StockHistoryEntry, StockItemView};
use crate::repositories::{pricing_repository, stock_repository};
use crate::services::account_service::Accounts;
use crate::services::pricing_service::PricingStore;
use std::sync::{Arc, Mutex as SyncMutex};
use tauri::AppHandle;

pub type StockStore = Arc<SyncMutex<StockData>>;

const ITEM_NOT_FOUND: &str = "Article introuvable.";
const ADMIN_NOT_FOUND: &str = "Compte administrateur introuvable ou inactif.";

struct Admin {
    username: String,
    id: String,
}

pub fn load(app: &AppHandle) -> StockData {
    stock_repository::load(app)
}

fn resolve_admin(accounts: &Accounts, username: &str) -> Result<Admin, String> {
    let username = username.trim();
    accounts
        .lock()
        .unwrap()
        .iter()
        .find(|a| {
            a.username.eq_ignore_ascii_case(username)
                && a.user_type == UserType::Admin
                && a.status == AccountStatus::Active
        })
        .map(|a| Admin {
            username: a.username.clone(),
            id: a.id.clone(),
        })
        .ok_or_else(|| ADMIN_NOT_FOUND.to_string())
}

fn format_availability(available: bool) -> String {
    if available { "Disponible" } else { "Indisponible" }.to_string()
}

fn format_quantity(item_type: ServiceItemType, quantity: Option<u32>) -> String {
    match quantity {
        Some(value) => value.to_string(),
        None => match item_type {
            ServiceItemType::Service => "Illimité",
            ServiceItemType::Product => "Non suivi",
        }
        .to_string(),
    }
}

fn to_view(item: &ServiceItem, quantity: Option<u32>) -> StockItemView {
    StockItemView {
        id: item.id.clone(),
        label: item.label.clone(),
        category: item.category.clone(),
        item_type: item.item_type,
        available: item.available,
        quantity,
    }
}

fn push_history(
    data: &mut StockData,
    admin: &Admin,
    item: &ServiceItem,
    action: StockAction,
    before: String,
    after: String,
) {
    let id = data.history.iter().map(|e| e.id).max().unwrap_or(0) + 1;
    data.history.push(StockHistoryEntry {
        id,
        at: chrono::Local::now().to_rfc3339(),
        admin_username: admin.username.clone(),
        admin_id: admin.id.clone(),
        item_id: item.id.clone(),
        item_label: item.label.clone(),
        item_category: item.category.clone(),
        item_type: item.item_type,
        action,
        before,
        after,
    });
    if data.history.len() > MAX_STOCK_HISTORY_ENTRIES {
        let overflow = data.history.len() - MAX_STOCK_HISTORY_ENTRIES;
        data.history.drain(0..overflow);
    }
}

fn persist_history(app: &AppHandle, data: &StockData) {
    if let Err(err) = stock_repository::save(app, data) {
        log::error!("Échec de l'enregistrement de l'historique des stocks : {err}");
    }
}

pub fn list_items(pricing: &PricingStore, stock: &StockStore) -> Vec<StockItemView> {
    let items = pricing.lock().unwrap();
    let data = stock.lock().unwrap();
    items
        .iter()
        .map(|item| to_view(item, data.quantities.get(&item.id).copied()))
        .collect()
}

pub fn list_history(stock: &StockStore) -> Vec<StockHistoryEntry> {
    stock.lock().unwrap().history.iter().rev().cloned().collect()
}

pub fn set_availability(
    app: &AppHandle,
    accounts: &Accounts,
    pricing: &PricingStore,
    stock: &StockStore,
    id: String,
    available: bool,
    username: &str,
) -> Result<(StockItemView, Vec<ServiceItem>), String> {
    let admin = resolve_admin(accounts, username)?;
    let mut items = pricing.lock().unwrap();
    let item = find_item_mut(&mut items, &id).ok_or_else(|| ITEM_NOT_FOUND.to_string())?;
    let previous = item.clone();
    let mut updated = previous.clone();
    updated.available = available;
    if previous.available != available {
        *item = updated.clone();
        if let Err(err) = pricing_repository::save(app, &items) {
            if let Some(item) = find_item_mut(&mut items, &id) {
                *item = previous;
            }
            return Err(format!("Échec de l'enregistrement de l'article : {err}"));
        }
        let mut data = stock.lock().unwrap();
        push_history(
            &mut data,
            &admin,
            &updated,
            StockAction::Availability,
            format_availability(previous.available),
            format_availability(available),
        );
        persist_history(app, &data);
    }
    let quantity = stock.lock().unwrap().quantities.get(&id).copied();
    Ok((to_view(&updated, quantity), items.clone()))
}

pub fn set_quantity(
    app: &AppHandle,
    accounts: &Accounts,
    pricing: &PricingStore,
    stock: &StockStore,
    id: String,
    quantity: Option<u32>,
    username: &str,
) -> Result<StockItemView, String> {
    let admin = resolve_admin(accounts, username)?;
    if quantity.is_some_and(|value| value > MAX_QUANTITY) {
        return Err(format!("La quantité ne peut pas dépasser {MAX_QUANTITY}."));
    }
    let items = pricing.lock().unwrap();
    let item = items
        .iter()
        .find(|i| i.id == id)
        .ok_or_else(|| ITEM_NOT_FOUND.to_string())?;
    let mut data = stock.lock().unwrap();
    let previous = data.quantities.get(&id).copied();
    if previous != quantity {
        let snapshot = data.clone();
        match quantity {
            Some(value) => {
                data.quantities.insert(id.clone(), value);
            }
            None => {
                data.quantities.remove(&id);
            }
        }
        let item_type = item.item_type;
        push_history(
            &mut data,
            &admin,
            item,
            StockAction::Quantity,
            format_quantity(item_type, previous),
            format_quantity(item_type, quantity),
        );
        if quantity == Some(0) {
            push_history(
                &mut data,
                &admin,
                item,
                StockAction::Empty,
                format_quantity(item_type, previous),
                format_quantity(item_type, quantity),
            );
        }
        if let Err(err) = stock_repository::save(app, &data) {
            *data = snapshot;
            return Err(format!("Échec de l'enregistrement du stock : {err}"));
        }
    }
    Ok(to_view(item, quantity))
}
