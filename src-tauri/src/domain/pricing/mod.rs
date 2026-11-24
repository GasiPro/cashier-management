use argon2::password_hash::rand_core::{OsRng, RngCore};
use chrono::DateTime;
use std::cmp::Ordering;
use crate::config::pricing_config::{
    MAX_CURRENCY_CODE_LEN, MAX_CURRENCY_NAME_LEN, MAX_DENOMINATIONS, MAX_DENOMINATION_VALUE,
    MAX_MOR_DAYS, MAX_MOR_ORDERS, MAX_PRICE_HISTORY_ENTRIES, MAX_RATE_PERCENT,
    MIN_CURRENCY_CODE_LEN, MIN_RATE_PERCENT,
};
use crate::models::pricing::{
    PriceAdjustment, PriceAdjustmentKind, PriceHistoryEntry, PricePeak, PriceRule, ServiceItem,
};
const SECONDS_PER_DAY: i64 = 86_400;
pub fn generate_id() -> String {
    let mut bytes = [0u8; 8];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
pub fn find_item_mut<'a>(items: &'a mut [ServiceItem], id: &str) -> Option<&'a mut ServiceItem> {
    items.iter_mut().find(|i| i.id == id)
}
pub fn find_item_by_service_type<'a>(
    items: &'a [ServiceItem],
    service_type: &str,
) -> Option<&'a ServiceItem> {
    items
        .iter()
        .find(|i| format!("{} — {}", i.category, i.label) == service_type)
}
pub fn remove_item(items: &mut Vec<ServiceItem>, id: &str) -> bool {
    let len_before = items.len();
    items.retain(|i| i.id != id);
    items.len() != len_before
}
pub fn adjusted_price(normal_price: u32, rate: u32, kind: PriceAdjustmentKind) -> u32 {
    let delta = u32::try_from((u64::from(normal_price) * u64::from(rate) + 50) / 100)
        .unwrap_or(u32::MAX);
    match kind {
        PriceAdjustmentKind::Majoration => normal_price.saturating_add(delta),
        PriceAdjustmentKind::Reduction => normal_price.saturating_sub(delta),
    }
}
pub fn rule_of(item: &ServiceItem, kind: PriceAdjustmentKind) -> Option<&PriceRule> {
    match kind {
        PriceAdjustmentKind::Majoration => item.majoration.as_ref(),
        PriceAdjustmentKind::Reduction => item.reduction.as_ref(),
    }
}
pub fn rule_slot(item: &mut ServiceItem, kind: PriceAdjustmentKind) -> &mut Option<PriceRule> {
    match kind {
        PriceAdjustmentKind::Majoration => &mut item.majoration,
        PriceAdjustmentKind::Reduction => &mut item.reduction,
    }
}
pub fn validate_mor(rate: u32, days: Option<u32>, max_orders: Option<u32>) -> Result<(), String> {
    if !(MIN_RATE_PERCENT..=MAX_RATE_PERCENT).contains(&rate) {
        return Err(format!(
            "Le taux doit être compris entre {MIN_RATE_PERCENT} et {MAX_RATE_PERCENT} %."
        ));
    }
    if days.is_some_and(|d| d == 0 || d > MAX_MOR_DAYS) {
        return Err(format!(
            "La durée doit être comprise entre 1 et {MAX_MOR_DAYS} jours."
        ));
    }
    if max_orders.is_some_and(|n| n == 0 || n > MAX_MOR_ORDERS) {
        return Err(format!(
            "Le nombre de commandes doit être compris entre 1 et {MAX_MOR_ORDERS}."
        ));
    }
    Ok(())
}
pub fn is_expired(rule: &PriceRule, now: i64) -> bool {
    let by_orders = rule.max_orders.is_some_and(|max| rule.used_orders >= max);
    let by_days = rule.days.is_some_and(|days| {
        DateTime::parse_from_rfc3339(&rule.created_at)
            .is_ok_and(|start| now >= start.timestamp() + i64::from(days) * SECONDS_PER_DAY)
    });
    by_orders || by_days
}
pub fn remove_expired_rules(items: &mut [ServiceItem], now: i64) -> bool {
    let mut changed = false;
    for item in items {
        for slot in [&mut item.majoration, &mut item.reduction] {
            if slot.as_ref().is_some_and(|rule| is_expired(rule, now)) {
                *slot = None;
                changed = true;
            }
        }
    }
    changed
}
pub fn consume_use(
    items: &mut [ServiceItem],
    item_id: &str,
    kind: PriceAdjustmentKind,
    now: i64,
) -> bool {
    let Some(item) = find_item_mut(items, item_id) else {
        return false;
    };
    let slot = rule_slot(item, kind);
    let Some(rule) = slot.as_mut() else {
        return false;
    };
    rule.used_orders = rule.used_orders.saturating_add(1);
    if is_expired(rule, now) {
        *slot = None;
    }
    true
}
pub fn price_kind(normal_price: u32, price: u32) -> Option<PriceAdjustmentKind> {
    match price.cmp(&normal_price) {
        Ordering::Equal => None,
        Ordering::Greater => Some(PriceAdjustmentKind::Majoration),
        Ordering::Less => Some(PriceAdjustmentKind::Reduction),
    }
}
pub fn check_price_change(
    item: Option<&ServiceItem>,
    normal_price: u32,
    unit_price: u32,
    pending_uses: u32,
    now: i64,
) -> Result<Option<PriceAdjustmentKind>, String> {
    let Some(kind) = price_kind(normal_price, unit_price) else {
        return Ok(None);
    };
    if let Some(item) = item {
        if !item.price_editable {
            return Err(format!("Le prix de « {} » n'est pas modifiable.", item.label));
        }
        let name = match kind {
            PriceAdjustmentKind::Majoration => "majoration",
            PriceAdjustmentKind::Reduction => "réduction",
        };
        let Some(rule) = rule_of(item, kind).filter(|rule| !is_expired(rule, now)) else {
            return Err(format!(
                "La {name} n'est pas autorisée pour « {} ».",
                item.label
            ));
        };
        if rule
            .max_orders
            .is_some_and(|max| rule.used_orders.saturating_add(pending_uses) >= max)
        {
            return Err(format!(
                "La {name} de « {} » a atteint son nombre maximal de commandes.",
                item.label
            ));
        }
        let limit = adjusted_price(normal_price, rule.rate, kind);
        let beyond = match kind {
            PriceAdjustmentKind::Majoration => unit_price > limit,
            PriceAdjustmentKind::Reduction => unit_price < limit,
        };
        if beyond {
            return Err(format!(
                "La {name} de « {} » est limitée à {limit} ({} %).",
                item.label, rule.rate
            ));
        }
    }
    Ok(Some(kind))
}
pub fn push_capped<T>(list: &mut Vec<T>, entry: T) {
    list.push(entry);
    if list.len() > MAX_PRICE_HISTORY_ENTRIES {
        let excess = list.len() - MAX_PRICE_HISTORY_ENTRIES;
        list.drain(..excess);
    }
}
pub fn push_history_entry(
    history: &mut Vec<PriceHistoryEntry>,
    adjustment: PriceAdjustment,
    counter_username: &str,
    counter_id: &str,
    at: &str,
) {
    let previous = history
        .iter()
        .filter(|e| e.service_type == adjustment.service_type && e.kind == adjustment.kind)
        .map(|e| e.applied_price);
    let peak = match adjustment.kind {
        PriceAdjustmentKind::Majoration => previous
            .max()
            .filter(|highest| adjustment.applied_price > *highest)
            .map(|_| PricePeak::Highest),
        PriceAdjustmentKind::Reduction => previous
            .min()
            .filter(|lowest| adjustment.applied_price < *lowest)
            .map(|_| PricePeak::Lowest),
    };
    let entry = PriceHistoryEntry {
        id: generate_id(),
        at: at.to_string(),
        counter_username: counter_username.to_string(),
        counter_id: counter_id.to_string(),
        order_id: adjustment.order_id,
        item_id: adjustment.item_id,
        service_type: adjustment.service_type,
        kind: adjustment.kind,
        normal_price: adjustment.normal_price,
        applied_price: adjustment.applied_price,
        peak,
    };
    push_capped(history, entry);
}
pub fn validate_currency_code(code: &str) -> Result<String, String> {
    let code = code.trim().to_ascii_uppercase();
    let len = code.chars().count();
    if len < MIN_CURRENCY_CODE_LEN
        || len > MAX_CURRENCY_CODE_LEN
        || !code.chars().all(|c| c.is_ascii_alphabetic())
    {
        return Err(format!(
            "Code de devise invalide : {MIN_CURRENCY_CODE_LEN} à {MAX_CURRENCY_CODE_LEN} lettres attendues (ex. : USD, EUR, MGA)."
        ));
    }
    Ok(code)
}
pub fn validate_currency_name(name: Option<String>, code: &str) -> Result<String, String> {
    let name = name.map(|n| n.trim().to_string()).unwrap_or_default();
    if name.is_empty() {
        return Ok(code.to_string());
    }
    if name.chars().count() > MAX_CURRENCY_NAME_LEN {
        return Err("Le nom de la devise est trop long.".to_string());
    }
    Ok(name)
}
pub fn validate_denominations(mut values: Vec<u32>) -> Result<Vec<u32>, String> {
    if values.iter().any(|v| *v == 0 || *v > MAX_DENOMINATION_VALUE) {
        return Err(format!(
            "Chaque valeur doit être comprise entre 1 et {MAX_DENOMINATION_VALUE}."
        ));
    }
    values.sort_unstable_by(|a, b| b.cmp(a));
    values.dedup();
    if values.len() > MAX_DENOMINATIONS {
        return Err(format!("Trop de valeurs : {MAX_DENOMINATIONS} au maximum."));
    }
    Ok(values)
}
