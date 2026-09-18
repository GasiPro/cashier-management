use serde::{Deserialize, Serialize};

use crate::models::pricing::ServiceItem;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OrderStatus {
    EnAttente,
    Paye,
    Rejetee,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Order {
    pub id: i64,
    pub group_id: i64,
    pub service_type: String,
    pub unit_price: u32,
    #[serde(default)]
    pub original_unit_price: u32,
    pub quantity: u32,
    pub status: OrderStatus,
    pub time: String,
    #[serde(default)]
    pub counter_username: String,
    pub created_at: String,
    pub paid_at: Option<String>,
    #[serde(default)]
    pub observation: String,
    #[serde(default)]
    pub raison: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CartItem {
    pub service: ServiceItem,
    pub qty: u32,
    #[serde(rename = "unitPrice")]
    pub unit_price: u32,
    pub label: String,
    #[serde(default)]
    pub observation: String,
}
