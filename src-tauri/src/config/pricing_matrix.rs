use crate::domain::order::price_calculator::{
    ServiceItem as PriceCalcServiceItem, ServiceItemType as PriceCalcServiceItemType,
};
use argon2::password_hash::rand_core::{OsRng, RngCore};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceItemType {
    Service,
    Product,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceItem {
    pub id: &'static str,
    pub category: &'static str,
    pub label: &'static str,
    pub price: u32,
    pub item_type: ServiceItemType,
}
pub const PRICING_MATRIX: &[ServiceItem] = &[
    ServiceItem { id: "pca3nb", category: "Photocopie", label: "A3 NB", price: 1000, item_type: ServiceItemType::Service },
    ServiceItem { id: "pca3cl", category: "Photocopie", label: "A3 Couleur", price: 2000, item_type: ServiceItemType::Service },
    ServiceItem { id: "pca4etnb", category: "Photocopie", label: "A4 Étudiant NB", price: 100, item_type: ServiceItemType::Service },
    ServiceItem { id: "pca4nb", category: "Photocopie", label: "A4 Normal NB", price: 200, item_type: ServiceItemType::Service },
    ServiceItem { id: "pca4cl", category: "Photocopie", label: "A4 Couleur", price: 500, item_type: ServiceItemType::Service },
    ServiceItem { id: "impetnb", category: "Impression", label: "Étudiant NB", price: 100, item_type: ServiceItemType::Service },
    ServiceItem { id: "impnb", category: "Impression", label: "Normal NB", price: 400, item_type: ServiceItemType::Service },
    ServiceItem { id: "impcl", category: "Impression", label: "Couleur", price: 500, item_type: ServiceItemType::Service },
    ServiceItem { id: "saibul", category: "Saisie", label: "Bulletin naissance", price: 600, item_type: ServiceItemType::Service },
    ServiceItem { id: "sainor", category: "Saisie", label: "Normal", price: 1500, item_type: ServiceItemType::Service },
    ServiceItem { id: "saicmp", category: "Saisie", label: "Complexe", price: 2000, item_type: ServiceItemType::Service },
    ServiceItem { id: "plas1", category: "Plastification", label: "Petite", price: 1000, item_type: ServiceItemType::Service },
    ServiceItem { id: "plas2", category: "Plastification", label: "Moyenne", price: 1500, item_type: ServiceItemType::Service },
    ServiceItem { id: "plas3", category: "Plastification", label: "Grande", price: 2000, item_type: ServiceItemType::Service },
    ServiceItem { id: "plas4", category: "Plastification", label: "A4", price: 3000, item_type: ServiceItemType::Service },
    ServiceItem { id: "plas5", category: "Plastification", label: "A3", price: 5000, item_type: ServiceItemType::Service },
    ServiceItem { id: "ph1015", category: "Photo", label: "10×15", price: 500, item_type: ServiceItemType::Service },
    ServiceItem { id: "pha5", category: "Photo", label: "A5", price: 1500, item_type: ServiceItemType::Service },
    ServiceItem { id: "pha4", category: "Photo", label: "A4", price: 3000, item_type: ServiceItemType::Service },
    ServiceItem { id: "pha3", category: "Photo", label: "A3", price: 5000, item_type: ServiceItemType::Service },
    ServiceItem { id: "cp20", category: "Connexion Poste", label: "20 min", price: 600, item_type: ServiceItemType::Service },
    ServiceItem { id: "cp40", category: "Connexion Poste", label: "40 min", price: 1000, item_type: ServiceItemType::Service },
    ServiceItem { id: "cp90", category: "Connexion Poste", label: "1h30", price: 2000, item_type: ServiceItemType::Service },
    ServiceItem { id: "cp4h", category: "Connexion Poste", label: "4h", price: 5000, item_type: ServiceItemType::Service },
    ServiceItem { id: "scan", category: "Service", label: "Scan", price: 500, item_type: ServiceItemType::Service },
    ServiceItem { id: "mail", category: "Service", label: "Envoi Mail", price: 600, item_type: ServiceItemType::Service },
    ServiceItem { id: "cptcreate", category: "Service", label: "Création compte", price: 1000, item_type: ServiceItemType::Service },
    ServiceItem { id: "rel1", category: "Reliure", label: "1 000 Ar", price: 1000, item_type: ServiceItemType::Service },
    ServiceItem { id: "rel2", category: "Reliure", label: "1 500 Ar", price: 1500, item_type: ServiceItemType::Service },
    ServiceItem { id: "rel3", category: "Reliure", label: "2 000 Ar", price: 2000, item_type: ServiceItemType::Service },
    ServiceItem { id: "rel4", category: "Reliure", label: "3 000 Ar", price: 3000, item_type: ServiceItemType::Service },
    ServiceItem { id: "rel5", category: "Reliure", label: "5 000 Ar", price: 5000, item_type: ServiceItemType::Service },
    ServiceItem { id: "film", category: "Divers", label: "Film", price: 200, item_type: ServiceItemType::Product },
    ServiceItem { id: "serie", category: "Divers", label: "Série", price: 1000, item_type: ServiceItemType::Product },
    ServiceItem { id: "prpfnl", category: "Carnet LP", label: "PFNL", price: 12500, item_type: ServiceItemType::Product },
    ServiceItem { id: "prchar", category: "Carnet LP", label: "Charbon", price: 12500, item_type: ServiceItemType::Product },
    ServiceItem { id: "prbois", category: "Carnet LP", label: "Bois", price: 12000, item_type: ServiceItemType::Product },
    ServiceItem { id: "prchant", category: "Carnet LP", label: "Cahier chantier", price: 14000, item_type: ServiceItemType::Product },
    ServiceItem { id: "envc5", category: "Enveloppe", label: "C5", price: 100, item_type: ServiceItemType::Product },
    ServiceItem { id: "enva5", category: "Enveloppe", label: "A5", price: 400, item_type: ServiceItemType::Product },
    ServiceItem { id: "enva4", category: "Enveloppe", label: "A4", price: 500, item_type: ServiceItemType::Product },
    ServiceItem { id: "enva3", category: "Enveloppe", label: "A3", price: 800, item_type: ServiceItemType::Product },
    ServiceItem { id: "journal", category: "Produit", label: "Journal", price: 9000, item_type: ServiceItemType::Product },
    ServiceItem { id: "chemise", category: "Produit", label: "Chemise", price: 400, item_type: ServiceItemType::Product },
    ServiceItem { id: "classeur", category: "Produit", label: "Classeur", price: 3000, item_type: ServiceItemType::Product },
    ServiceItem { id: "bristol", category: "Produit", label: "Bristol", price: 500, item_type: ServiceItemType::Product },
];
const PRICING_FILE_NAME: &str = "pricing_matrix.json";
fn pricing_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(PRICING_FILE_NAME))
}
pub fn load(app: &AppHandle) -> Option<Vec<PriceCalcServiceItem>> {
    let path = pricing_file_path(app).ok()?;
    let raw = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&raw).ok()
}
pub fn save(app: &AppHandle, items: &[PriceCalcServiceItem]) -> Result<(), String> {
    let path = pricing_file_path(app)?;
    let raw = serde_json::to_string_pretty(items).map_err(|e| e.to_string())?;
    std::fs::write(&path, raw).map_err(|e| e.to_string())
}
/// Loads the persisted pricing matrix, or — on first run — bootstraps it
/// from the built-in `PRICING_MATRIX` defaults and persists that snapshot so
/// later mutations (create/update/delete) have somewhere to be saved.
pub fn load_or_bootstrap(app: &AppHandle) -> Vec<PriceCalcServiceItem> {
    if let Some(items) = load(app) {
        return items;
    }
    let items: Vec<PriceCalcServiceItem> = PRICING_MATRIX
        .iter()
        .map(|item| PriceCalcServiceItem {
            id: item.id.to_string(),
            item_type: match item.item_type {
                ServiceItemType::Service => PriceCalcServiceItemType::Service,
                ServiceItemType::Product => PriceCalcServiceItemType::Product,
            },
            category: item.category.to_string(),
            label: item.label.to_string(),
            price: item.price,
        })
        .collect();
    let _ = save(app, &items);
    items
}
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
pub fn find_item_mut<'a>(items: &'a mut [PriceCalcServiceItem], id: &str) -> Option<&'a mut PriceCalcServiceItem> {
    items.iter_mut().find(|i| i.id == id)
}
pub fn remove_item(items: &mut Vec<PriceCalcServiceItem>, id: &str) -> bool {
    let len_before = items.len();
    items.retain(|i| i.id != id);
    items.len() != len_before
}
