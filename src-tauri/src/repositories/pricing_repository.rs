use crate::config::pricing_config::DEFAULT_CURRENCY;
use crate::infrastructure::filesystem::{config_file_path, read_json, write_json};
use crate::models::pricing::{Currency, PriceHistoryEntry, ServiceItem};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::AppHandle;
const PRICING_FILE_NAME: &str = "pricing_matrix.bin";
static FILE_LOCK: Mutex<()> = Mutex::new(());
#[derive(Serialize, Deserialize)]
#[serde(default)]
struct PricingFile {
    items: Vec<ServiceItem>,
    currency: String,
    custom_currencies: Vec<Currency>,
    history: Vec<PriceHistoryEntry>,
}
impl Default for PricingFile {
    fn default() -> Self {
        Self {
            items: Vec::new(),
            currency: DEFAULT_CURRENCY.to_string(),
            custom_currencies: Vec::new(),
            history: Vec::new(),
        }
    }
}
#[derive(Deserialize)]
#[serde(untagged)]
enum StoredPricing {
    Legacy(Vec<ServiceItem>),
    Current(PricingFile),
}
fn lock() -> std::sync::MutexGuard<'static, ()> {
    FILE_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}
fn read(app: &AppHandle) -> Option<PricingFile> {
    let path = config_file_path(app, PRICING_FILE_NAME).ok()?;
    match read_json::<StoredPricing>(&path)? {
        StoredPricing::Legacy(items) => Some(PricingFile {
            items,
            ..PricingFile::default()
        }),
        StoredPricing::Current(file) => Some(file),
    }
}
fn write(app: &AppHandle, file: &PricingFile) -> Result<(), String> {
    write_json(&config_file_path(app, PRICING_FILE_NAME)?, file)
}
fn modify(app: &AppHandle, change: impl FnOnce(&mut PricingFile)) -> Result<(), String> {
    let _guard = lock();
    let mut file = read(app).ok_or_else(|| "Grille tarifaire introuvable.".to_string())?;
    change(&mut file);
    write(app, &file)
}
pub fn load(app: &AppHandle) -> Option<Vec<ServiceItem>> {
    let _guard = lock();
    read(app).map(|file| file.items)
}
pub fn save(app: &AppHandle, items: &[ServiceItem]) -> Result<(), String> {
    let _guard = lock();
    let mut file = read(app).unwrap_or_default();
    file.items = items.to_vec();
    write(app, &file)
}
pub fn load_history(app: &AppHandle) -> Vec<PriceHistoryEntry> {
    let _guard = lock();
    read(app).map(|file| file.history).unwrap_or_default()
}
pub fn update_history(
    app: &AppHandle,
    change: impl FnOnce(&mut Vec<PriceHistoryEntry>),
) -> Result<(), String> {
    modify(app, |file| change(&mut file.history))
}
pub fn load_currency(app: &AppHandle) -> (String, Vec<Currency>) {
    let _guard = lock();
    let file = read(app).unwrap_or_default();
    (file.currency, file.custom_currencies)
}
pub fn save_currency(
    app: &AppHandle,
    selected: String,
    custom: Vec<Currency>,
) -> Result<(), String> {
    modify(app, |file| {
        file.currency = selected;
        file.custom_currencies = custom;
    })
}
