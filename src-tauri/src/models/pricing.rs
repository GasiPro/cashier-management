use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServiceItemType {
    Product,
    Service,
}
fn default_true() -> bool {
    true
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServiceItem {
    pub id: String,
    #[serde(rename = "type")]
    pub item_type: ServiceItemType,
    pub category: String,
    pub label: String,
    pub price: u32,
    #[serde(default = "default_true")]
    pub available: bool,
    #[serde(default = "default_true")]
    pub allow_majoration: bool,
    #[serde(default = "default_true")]
    pub allow_reduction: bool,
    #[serde(default = "default_true")]
    pub price_editable: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PriceAdjustmentKind {
    Majoration,
    Reduction,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PricePeak {
    Highest,
    Lowest,
}
#[derive(Debug, Clone)]
pub struct PriceAdjustment {
    pub order_id: i64,
    pub item_id: String,
    pub service_type: String,
    pub kind: PriceAdjustmentKind,
    pub normal_price: u32,
    pub applied_price: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceHistoryEntry {
    pub id: String,
    pub at: String,
    pub counter_username: String,
    pub counter_id: String,
    pub order_id: i64,
    pub item_id: String,
    pub service_type: String,
    pub kind: PriceAdjustmentKind,
    pub normal_price: u32,
    pub applied_price: u32,
    #[serde(default)]
    pub peak: Option<PricePeak>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Currency {
    pub code: String,
    pub name: String,
}
#[derive(Debug, Clone, Serialize)]
pub struct CurrencyInfo {
    pub selected: String,
    pub currencies: Vec<Currency>,
}
pub struct MinimalOrderRow {
    pub quantity: u32,
    pub unit_price: u32,
}
pub struct MinimalServiceRow {
    pub service_type: String,
}
