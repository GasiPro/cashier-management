use argon2::password_hash::rand_core::{OsRng, RngCore};
use std::cmp::Ordering;
use crate::config::pricing_config::{
    MAX_CURRENCY_CODE_LEN, MAX_CURRENCY_NAME_LEN, MAX_PRICE_HISTORY_ENTRIES,
    MIN_CURRENCY_CODE_LEN,
};
use crate::models::pricing::{
    PriceAdjustment, PriceAdjustmentKind, PriceHistoryEntry, PricePeak, ServiceItem,
};
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
pub fn check_price_change(
    item: Option<&ServiceItem>,
    normal_price: u32,
    unit_price: u32,
) -> Result<Option<PriceAdjustmentKind>, String> {
    let kind = match unit_price.cmp(&normal_price) {
        Ordering::Equal => return Ok(None),
        Ordering::Greater => PriceAdjustmentKind::Majoration,
        Ordering::Less => PriceAdjustmentKind::Reduction,
    };
    if let Some(item) = item {
        if !item.price_editable {
            return Err(format!("Le prix de « {} » n'est pas modifiable.", item.label));
        }
        if kind == PriceAdjustmentKind::Majoration && !item.allow_majoration {
            return Err(format!(
                "La majoration n'est pas autorisée pour « {} ».",
                item.label
            ));
        }
        if kind == PriceAdjustmentKind::Reduction && !item.allow_reduction {
            return Err(format!(
                "La réduction n'est pas autorisée pour « {} ».",
                item.label
            ));
        }
    }
    Ok(Some(kind))
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
    history.push(PriceHistoryEntry {
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
    });
    if history.len() > MAX_PRICE_HISTORY_ENTRIES {
        let excess = history.len() - MAX_PRICE_HISTORY_ENTRIES;
        history.drain(..excess);
    }
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
