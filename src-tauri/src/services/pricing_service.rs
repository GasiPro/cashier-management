use crate::config::pricing_config::{MAX_CUSTOM_CURRENCIES, PRESET_CURRENCIES};
use crate::config::pricing_matrix;
use crate::domain::pricing::{find_item_mut, validate_currency_code, validate_currency_name};
use crate::models::pricing::{Currency, CurrencyInfo, PriceHistoryEntry, ServiceItem};
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
pub async fn update_pricing_item(
    app: &AppHandle,
    pricing: &PricingStore,
    id: String,
    price: Option<u32>,
    allow_majoration: Option<bool>,
    allow_reduction: Option<bool>,
    price_editable: Option<bool>,
) -> Result<(ServiceItem, Vec<ServiceItem>), String> {
    let mut guard = pricing.lock().unwrap();
    let item = find_item_mut(&mut guard, &id).ok_or_else(|| "Article introuvable.".to_string())?;
    let previous = item.clone();
    if let Some(price) = price {
        item.price = price;
    }
    if let Some(allow_majoration) = allow_majoration {
        item.allow_majoration = allow_majoration;
    }
    if let Some(allow_reduction) = allow_reduction {
        item.allow_reduction = allow_reduction;
    }
    if let Some(price_editable) = price_editable {
        item.price_editable = price_editable;
    }
    let updated = item.clone();
    if let Err(err) = pricing_repository::save(app, &guard) {
        if let Some(item) = find_item_mut(&mut guard, &id) {
            *item = previous;
        }
        return Err(format!("Échec de l'enregistrement de l'article : {err}"));
    }
    Ok((updated, guard.clone()))
}
pub fn get_price_history(app: &AppHandle) -> Vec<PriceHistoryEntry> {
    let mut history = pricing_repository::load_history(app);
    history.reverse();
    history
}
fn currency_info(selected: String, custom: Vec<Currency>) -> CurrencyInfo {
    let mut currencies: Vec<Currency> = PRESET_CURRENCIES
        .iter()
        .map(|(code, name)| Currency {
            code: code.to_string(),
            name: name.to_string(),
        })
        .collect();
    currencies.extend(custom);
    CurrencyInfo {
        selected,
        currencies,
    }
}
pub fn get_currency(app: &AppHandle) -> CurrencyInfo {
    let (selected, custom) = pricing_repository::load_currency(app);
    currency_info(selected, custom)
}
pub fn set_currency(
    app: &AppHandle,
    code: String,
    name: Option<String>,
) -> Result<CurrencyInfo, String> {
    let code = validate_currency_code(&code)?;
    let (_, mut custom) = pricing_repository::load_currency(app);
    let is_known =
        PRESET_CURRENCIES.iter().any(|(c, _)| *c == code) || custom.iter().any(|c| c.code == code);
    if !is_known {
        if custom.len() >= MAX_CUSTOM_CURRENCIES {
            return Err("Trop de devises personnalisées.".to_string());
        }
        custom.push(Currency {
            name: validate_currency_name(name, &code)?,
            code: code.clone(),
        });
    }
    pricing_repository::save_currency(app, code.clone(), custom.clone())
        .map_err(|err| format!("Échec de l'enregistrement de la devise : {err}"))?;
    Ok(currency_info(code, custom))
}
