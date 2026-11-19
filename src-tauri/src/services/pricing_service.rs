use crate::config::pricing_config::{MAX_CUSTOM_CURRENCIES, PRESET_CURRENCIES};
use crate::config::pricing_matrix;
use crate::domain::pricing::{
    consume_use, find_item_mut, generate_id, push_capped, remove_expired_rules, rule_of,
    rule_slot, validate_currency_code, validate_currency_name, validate_mor,
};
use crate::models::pricing::{
    Currency, CurrencyInfo, MorInput, PriceAdjustmentKind, PriceHistoryEntry, PriceLogAction,
    PriceLogEntry, PriceRule, ServiceItem,
};
use crate::repositories::pricing_repository;
use crate::services::account_service::Accounts;
use crate::services::stock_service::{resolve_admin, Admin};
use chrono::Utc;
use std::sync::{Arc, Mutex as SyncMutex};
use tauri::AppHandle;
pub type PricingStore = Arc<SyncMutex<Vec<ServiceItem>>>;
const ITEM_NOT_FOUND: &str = "Article introuvable.";
const CURRENCY_LOG_LABEL: &str = "Devise";
pub fn load_or_bootstrap(app: &AppHandle) -> Vec<ServiceItem> {
    if let Some(mut items) = pricing_repository::load(app) {
        if remove_expired_rules(&mut items, Utc::now().timestamp()) {
            let _ = pricing_repository::save(app, &items);
        }
        return items;
    }
    let items = pricing_matrix::default_items();
    let _ = pricing_repository::save(app, &items);
    items
}
pub fn get_pricing_matrix(pricing: &PricingStore) -> Vec<ServiceItem> {
    pricing.lock().unwrap().clone()
}
fn reset_editable_without_rules(item: &mut ServiceItem) {
    if item.majoration.is_none() && item.reduction.is_none() {
        item.price_editable = false;
    }
}
fn edit_item(
    app: &AppHandle,
    pricing: &PricingStore,
    id: &str,
    change: impl FnOnce(&mut ServiceItem) -> Result<(), String>,
) -> Result<(ServiceItem, ServiceItem, Vec<ServiceItem>), String> {
    let mut guard = pricing.lock().unwrap();
    remove_expired_rules(&mut guard, Utc::now().timestamp());
    let item = find_item_mut(&mut guard, id).ok_or_else(|| ITEM_NOT_FOUND.to_string())?;
    let previous = item.clone();
    if let Err(err) = change(&mut *item) {
        *item = previous;
        return Err(err);
    }
    let updated = item.clone();
    if let Err(err) = pricing_repository::save(app, &guard) {
        if let Some(item) = find_item_mut(&mut guard, id) {
            *item = previous;
        }
        return Err(format!("Échec de l'enregistrement de l'article : {err}"));
    }
    Ok((previous, updated, guard.clone()))
}
fn push_log(app: &AppHandle, entry: PriceLogEntry) {
    if let Err(err) = pricing_repository::update_log(app, |entries| push_capped(entries, entry)) {
        log::warn!("Historique des tarifs non enregistré : {err}");
    }
}
fn record_log(
    app: &AppHandle,
    admin: &Admin,
    item: &ServiceItem,
    action: PriceLogAction,
    kind: Option<PriceAdjustmentKind>,
    before: Option<u32>,
    after: Option<u32>,
) {
    push_log(
        app,
        PriceLogEntry {
            id: generate_id(),
            at: Utc::now().to_rfc3339(),
            admin_username: admin.username.clone(),
            admin_id: admin.id.clone(),
            item_id: item.id.clone(),
            service_type: format!("{} — {}", item.category, item.label),
            action,
            kind,
            before,
            after,
            before_code: None,
            after_code: None,
        },
    );
}
fn record_currency_log(app: &AppHandle, admin: &Admin, before: String, after: String) {
    push_log(
        app,
        PriceLogEntry {
            id: generate_id(),
            at: Utc::now().to_rfc3339(),
            admin_username: admin.username.clone(),
            admin_id: admin.id.clone(),
            item_id: String::new(),
            service_type: CURRENCY_LOG_LABEL.to_string(),
            action: PriceLogAction::CurrencyChanged,
            kind: None,
            before: None,
            after: None,
            before_code: Some(before),
            after_code: Some(after),
        },
    );
}
fn apply_mor(
    item: &mut ServiceItem,
    kind: PriceAdjustmentKind,
    input: MorInput,
    created_at: &str,
) -> Result<(), String> {
    validate_mor(input.rate, input.days, input.max_orders)?;
    if !item.price_editable {
        return Err(format!("Le prix de « {} » n'est pas modifiable.", item.label));
    }
    let slot = rule_slot(item, kind);
    let rule_id = slot
        .as_ref()
        .map_or_else(generate_id, |rule| rule.id.clone());
    *slot = Some(PriceRule {
        id: rule_id,
        rate: input.rate,
        days: input.days,
        max_orders: input.max_orders,
        created_at: created_at.to_string(),
        used_orders: 0,
    });
    Ok(())
}
fn log_added_mors(
    app: &AppHandle,
    admin: &Admin,
    previous: &ServiceItem,
    updated: &ServiceItem,
    mors: &[(PriceAdjustmentKind, Option<MorInput>)],
) {
    for (kind, input) in mors {
        if let Some(input) = input {
            if rule_of(updated, *kind).is_some() {
                record_log(
                    app,
                    admin,
                    updated,
                    PriceLogAction::MorAdded,
                    Some(*kind),
                    rule_of(previous, *kind).map(|rule| rule.rate),
                    Some(input.rate),
                );
            }
        }
    }
}
#[allow(clippy::too_many_arguments)]
pub fn update_pricing_item(
    app: &AppHandle,
    accounts: &Accounts,
    pricing: &PricingStore,
    id: String,
    price: Option<u32>,
    price_editable: Option<bool>,
    majoration: Option<MorInput>,
    reduction: Option<MorInput>,
    username: &str,
) -> Result<(ServiceItem, Vec<ServiceItem>), String> {
    let admin = resolve_admin(accounts, username)?;
    let created_at = Utc::now().to_rfc3339();
    let mors = [
        (PriceAdjustmentKind::Majoration, majoration),
        (PriceAdjustmentKind::Reduction, reduction),
    ];
    let (previous, updated, snapshot) = edit_item(app, pricing, &id, |item| {
        if let Some(price) = price {
            item.price = price;
        }
        if let Some(price_editable) = price_editable {
            item.price_editable = price_editable;
        }
        if !item.price_editable {
            item.majoration = None;
            item.reduction = None;
            return Ok(());
        }
        for (kind, input) in mors {
            if let Some(input) = input {
                apply_mor(item, kind, input, &created_at)?;
            }
        }
        reset_editable_without_rules(item);
        Ok(())
    })?;
    if updated.price != previous.price {
        record_log(
            app,
            &admin,
            &updated,
            PriceLogAction::PriceChanged,
            None,
            Some(previous.price),
            Some(updated.price),
        );
    }
    log_added_mors(app, &admin, &previous, &updated, &mors);
    Ok((updated, snapshot))
}
pub fn set_mor(
    app: &AppHandle,
    accounts: &Accounts,
    pricing: &PricingStore,
    id: String,
    kind: PriceAdjustmentKind,
    input: MorInput,
    username: &str,
) -> Result<(ServiceItem, Vec<ServiceItem>), String> {
    let admin = resolve_admin(accounts, username)?;
    let created_at = Utc::now().to_rfc3339();
    let (previous, updated, snapshot) = edit_item(app, pricing, &id, |item| {
        apply_mor(item, kind, input, &created_at)
    })?;
    log_added_mors(app, &admin, &previous, &updated, &[(kind, Some(input))]);
    Ok((updated, snapshot))
}
pub fn delete_mor(
    app: &AppHandle,
    pricing: &PricingStore,
    id: String,
    kind: PriceAdjustmentKind,
) -> Result<(ServiceItem, Vec<ServiceItem>), String> {
    let (_, updated, snapshot) = edit_item(app, pricing, &id, |item| {
        *rule_slot(item, kind) = None;
        reset_editable_without_rules(item);
        Ok(())
    })?;
    Ok((updated, snapshot))
}
pub fn consume_uses(
    app: &AppHandle,
    pricing: &PricingStore,
    uses: &[(String, PriceAdjustmentKind)],
) -> Option<Vec<ServiceItem>> {
    let mut guard = pricing.lock().unwrap();
    let backup = guard.clone();
    let now = Utc::now().timestamp();
    let mut changed = remove_expired_rules(&mut guard, now);
    for (item_id, kind) in uses {
        changed |= consume_use(&mut guard, item_id, *kind, now);
    }
    if !changed {
        return None;
    }
    if let Err(err) = pricing_repository::save(app, &guard) {
        log::warn!("Compteur de commandes non enregistré : {err}");
        *guard = backup;
        return None;
    }
    Some(guard.clone())
}
pub fn purge_expired(app: &AppHandle, pricing: &PricingStore) -> Option<Vec<ServiceItem>> {
    consume_uses(app, pricing, &[])
}
pub fn get_price_history(app: &AppHandle) -> Vec<PriceHistoryEntry> {
    let mut history = pricing_repository::load_history(app);
    history.reverse();
    history
}
pub fn get_price_log(app: &AppHandle) -> Vec<PriceLogEntry> {
    let mut entries = pricing_repository::load_log(app);
    entries.reverse();
    entries
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
    accounts: &Accounts,
    code: String,
    name: Option<String>,
    username: &str,
) -> Result<CurrencyInfo, String> {
    let admin = resolve_admin(accounts, username)?;
    let code = validate_currency_code(&code)?;
    let (previous, mut custom) = pricing_repository::load_currency(app);
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
    if previous != code {
        record_currency_log(app, &admin, previous, code.clone());
    }
    Ok(currency_info(code, custom))
}
