use argon2::password_hash::rand_core::{OsRng, RngCore};

use crate::models::pricing::ServiceItem;

pub fn generate_id() -> String {
    let mut bytes = [0u8; 8];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn validate_category(category: &str) -> Result<String, String> {
    let trimmed = category.trim();
    if trimmed.is_empty() {
        return Err("La catégorie ne peut pas être vide.".to_string());
    }
    Ok(trimmed.to_string())
}

pub fn validate_label(label: &str) -> Result<String, String> {
    let trimmed = label.trim();
    if trimmed.is_empty() {
        return Err("Le libellé ne peut pas être vide.".to_string());
    }
    Ok(trimmed.to_string())
}

pub fn find_item_mut<'a>(items: &'a mut [ServiceItem], id: &str) -> Option<&'a mut ServiceItem> {
    items.iter_mut().find(|i| i.id == id)
}

pub fn remove_item(items: &mut Vec<ServiceItem>, id: &str) -> bool {
    let len_before = items.len();
    items.retain(|i| i.id != id);
    items.len() != len_before
}
