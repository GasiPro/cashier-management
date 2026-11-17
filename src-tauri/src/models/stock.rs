use crate::models::pricing::ServiceItemType;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StockAction {
    Availability,
    Quantity,
    Empty,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StockHistoryEntry {
    pub id: i64,
    pub at: String,
    pub admin_username: String,
    pub admin_id: String,
    pub item_id: String,
    pub item_label: String,
    pub item_category: String,
    pub item_type: ServiceItemType,
    pub action: StockAction,
    pub before: String,
    pub after: String,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct StockData {
    pub quantities: HashMap<String, u32>,
    pub history: Vec<StockHistoryEntry>,
}
#[derive(Debug, Clone, Serialize)]
pub struct StockItemView {
    pub id: String,
    pub label: String,
    pub category: String,
    #[serde(rename = "type")]
    pub item_type: ServiceItemType,
    pub available: bool,
    pub quantity: Option<u32>,
}
#[derive(Debug, Clone)]
pub struct StockItemFields {
    pub item_type: ServiceItemType,
    pub category: String,
    pub label: String,
}
#[derive(Debug, Clone)]
pub struct NewStockItem {
    pub fields: StockItemFields,
    pub price: Option<u32>,
    pub quantity: Option<u32>,
}
