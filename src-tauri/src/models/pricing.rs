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
pub struct PriceRule {
    pub id: String,
    pub rate: u32,
    pub days: Option<u32>,
    pub max_orders: Option<u32>,
    pub created_at: String,
    #[serde(default)]
    pub used_orders: u32,
}
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct MorInput {
    pub rate: u32,
    pub days: Option<u32>,
    pub max_orders: Option<u32>,
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
    #[serde(default)]
    pub majoration: Option<PriceRule>,
    #[serde(default)]
    pub reduction: Option<PriceRule>,
    #[serde(default)]
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
    pub new_use: bool,
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PriceLogAction {
    MorAdded,
    PriceChanged,
    CurrencyChanged,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceLogEntry {
    pub id: String,
    pub at: String,
    pub admin_username: String,
    pub admin_id: String,
    pub item_id: String,
    pub service_type: String,
    pub action: PriceLogAction,
    pub kind: Option<PriceAdjustmentKind>,
    pub before: Option<u32>,
    pub after: Option<u32>,
    #[serde(default)]
    pub before_code: Option<String>,
    #[serde(default)]
    pub after_code: Option<String>,
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
