use crate::config::stock_config::{
    MAX_ITEM_CATEGORY_LEN, MAX_ITEM_LABEL_LEN, MAX_ITEM_PRICE, MAX_QUANTITY,
    MAX_STOCK_HISTORY_ENTRIES,
};
use crate::domain::pricing::{find_item_mut, generate_id};
use crate::models::account::{AccountStatus, UserType};
use crate::models::pricing::{ServiceItem, ServiceItemType};
use crate::models::stock::{
    NewStockItem, StockAction, StockData, StockHistoryEntry, StockItemFields, StockItemView,
};
use crate::repositories::{pricing_repository, stock_repository};
use crate::services::account_service::Accounts;
use crate::services::pricing_service::PricingStore;
use std::sync::{Arc, Mutex as SyncMutex};
use tauri::AppHandle;
pub type StockStore = Arc<SyncMutex<StockData>>;
const ITEM_NOT_FOUND: &str = "Article introuvable.";
const ADMIN_NOT_FOUND: &str = "Compte administrateur introuvable ou inactif.";
pub(crate) struct Admin {
    pub(crate) username: String,
    pub(crate) id: String,
}
pub fn load(app: &AppHandle) -> StockData {
    stock_repository::load(app)
}
pub(crate) fn resolve_admin(accounts: &Accounts, username: &str) -> Result<Admin, String> {
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
fn push_quantity_history(
    data: &mut StockData,
    admin: &Admin,
    item: &ServiceItem,
    previous: Option<u32>,
    quantity: Option<u32>,
) {
    let before = format_quantity(item.item_type, previous);
    let after = format_quantity(item.item_type, quantity);
    push_history(
        data,
        admin,
        item,
        StockAction::Quantity,
        before.clone(),
        after.clone(),
    );
    if quantity == Some(0) {
        push_history(data, admin, item, StockAction::Empty, before, after);
    }
}
fn check_quantity(quantity: Option<u32>) -> Result<(), String> {
    if quantity.is_some_and(|value| value > MAX_QUANTITY) {
        return Err(format!("La quantité ne peut pas dépasser {MAX_QUANTITY}."));
    }
    Ok(())
}
fn clean_fields(fields: StockItemFields) -> Result<StockItemFields, String> {
    let label = fields.label.trim().to_string();
    let category = fields.category.trim().to_string();
    if label.is_empty() {
        return Err("Le nom de l'article est obligatoire.".to_string());
    }
    if category.is_empty() {
        return Err("La catégorie est obligatoire.".to_string());
    }
    if label.chars().count() > MAX_ITEM_LABEL_LEN {
        return Err(format!(
            "Le nom ne peut pas dépasser {MAX_ITEM_LABEL_LEN} caractères."
        ));
    }
    if category.chars().count() > MAX_ITEM_CATEGORY_LEN {
        return Err(format!(
            "La catégorie ne peut pas dépasser {MAX_ITEM_CATEGORY_LEN} caractères."
        ));
    }
    Ok(StockItemFields {
        item_type: fields.item_type,
        category,
        label,
    })
}
fn ensure_unique(
    items: &[ServiceItem],
    fields: &StockItemFields,
    except_id: Option<&str>,
) -> Result<(), String> {
    let same = |a: &str, b: &str| a.to_lowercase() == b.to_lowercase();
    let exists = items.iter().any(|i| {
        Some(i.id.as_str()) != except_id
            && same(i.category.as_str(), fields.category.as_str())
            && same(i.label.as_str(), fields.label.as_str())
    });
    if exists {
        return Err(format!(
            "« {} » existe déjà dans la catégorie « {} ».",
            fields.label, fields.category
        ));
    }
    Ok(())
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
    check_quantity(quantity)?;
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
        push_quantity_history(&mut data, &admin, item, previous, quantity);
        if let Err(err) = stock_repository::save(app, &data) {
            *data = snapshot;
            return Err(format!("Échec de l'enregistrement du stock : {err}"));
        }
    }
    Ok(to_view(item, quantity))
}
pub fn create_item(
    app: &AppHandle,
    accounts: &Accounts,
    pricing: &PricingStore,
    stock: &StockStore,
    new: NewStockItem,
    username: &str,
) -> Result<(StockItemView, Vec<ServiceItem>), String> {
    let admin = resolve_admin(accounts, username)?;
    let fields = clean_fields(new.fields)?;
    let price = new.price.unwrap_or(0);
    if price > MAX_ITEM_PRICE {
        return Err(format!("Le prix ne peut pas dépasser {MAX_ITEM_PRICE}."));
    }
    check_quantity(new.quantity)?;
    let mut items = pricing.lock().unwrap();
    ensure_unique(&items, &fields, None)?;
    let mut id = generate_id();
    while items.iter().any(|i| i.id == id) {
        id = generate_id();
    }
    let item = ServiceItem {
        id,
        item_type: fields.item_type,
        category: fields.category,
        label: fields.label,
        price,
        available: true,
        majoration: None,
        reduction: None,
        price_editable: false,
    };
    items.push(item.clone());
    if let Err(err) = pricing_repository::save(app, &items) {
        items.pop();
        return Err(format!("Échec de l'enregistrement de l'article : {err}"));
    }
    if let Some(quantity) = new.quantity {
        let mut data = stock.lock().unwrap();
        let snapshot = data.clone();
        data.quantities.insert(item.id.clone(), quantity);
        push_quantity_history(&mut data, &admin, &item, None, Some(quantity));
        if let Err(err) = stock_repository::save(app, &data) {
            *data = snapshot;
            items.pop();
            if let Err(rollback) = pricing_repository::save(app, &items) {
                log::error!(
                    "Annulation de l'ajout de l'article « {} » impossible : {rollback}",
                    item.label
                );
            }
            return Err(format!("Échec de l'enregistrement du stock : {err}"));
        }
    }
    Ok((to_view(&item, new.quantity), items.clone()))
}
pub fn update_item(
    app: &AppHandle,
    pricing: &PricingStore,
    stock: &StockStore,
    id: String,
    fields: StockItemFields,
) -> Result<(StockItemView, Vec<ServiceItem>), String> {
    let fields = clean_fields(fields)?;
    let mut items = pricing.lock().unwrap();
    ensure_unique(&items, &fields, Some(id.as_str()))?;
    let item = find_item_mut(&mut items, &id).ok_or_else(|| ITEM_NOT_FOUND.to_string())?;
    let previous = item.clone();
    item.item_type = fields.item_type;
    item.category = fields.category;
    item.label = fields.label;
    let updated = item.clone();
    if updated != previous {
        if let Err(err) = pricing_repository::save(app, &items) {
            if let Some(item) = find_item_mut(&mut items, &id) {
                *item = previous;
            }
            return Err(format!("Échec de l'enregistrement de l'article : {err}"));
        }
    }
    let quantity = stock.lock().unwrap().quantities.get(&id).copied();
    Ok((to_view(&updated, quantity), items.clone()))
}
