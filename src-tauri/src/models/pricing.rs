use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServiceItemType {
    Product,
    Service,
}
fn default_available() -> bool {
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
    #[serde(default = "default_available")]
    pub available: bool,
}
pub struct MinimalOrderRow {
    pub quantity: u32,
    pub unit_price: u32,
}
pub struct MinimalServiceRow {
    pub service_type: String,
}
