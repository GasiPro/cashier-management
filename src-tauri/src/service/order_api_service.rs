use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OrderStatus {
    EnAttente, // Matches 'EN_ATTENTE' when serialized
    Paye,      // Matches 'PAYE' when serialized
    Rejetee,   // Matches 'REJETEE' when serialized
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Order {
    pub id: i64,
    pub group_id: i64,
    pub service_type: String,
    pub unit_price: u32,
    /// Catalogue price for this service at the time the order was created, before
    /// any manual adjustment by the counter. Used to detect and display discounts
    /// on the order, in the history, and in the cashier's report.
    #[serde(default)]
    pub original_unit_price: u32,
    pub quantity: u32,
    pub status: OrderStatus,
    pub time: String,

    /// Username of the counter (comptoir) that placed the order.
    #[serde(default)]
    pub counter_username: String,

   pub created_at: String,
    pub paid_at: Option<String>, // 'string | null' becomes Option<String>

    /// Free-text note left by the counter for the cashier at the time the order was
    /// placed (e.g. special instructions). Defaults to an empty string for orders
    /// persisted before this field existed.
    #[serde(default)]
    pub observation: String,

    /// Optional reason given by the cashier when cancelling (rejecting) a pending order.
    #[serde(default)]
    pub raison: Option<String>,
}

pub struct OrderApi;

impl OrderApi {
    const STORAGE_ORDERS_KEY: &'static str = "gasipro_orders.json";
    const STORAGE_ID_KEY: &'static str = "gasipro_nextId.txt";
    const STORAGE_GID_KEY: &'static str = "gasipro_nextGroupId.txt";

    pub fn load_orders() -> Vec<Order> {
        if !Path::new(Self::STORAGE_ORDERS_KEY).exists() {
            return Vec::new();
        }

        fs::read_to_string(Self::STORAGE_ORDERS_KEY)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_else(Vec::new)
    }

    pub fn load_next_id() -> i64 {
        fs::read_to_string(Self::STORAGE_ID_KEY)
            .ok()
            .and_then(|raw| raw.trim().parse::<i64>().ok())
            .unwrap_or(1000)
    }

    pub fn load_next_group_id() -> i64 {
        fs::read_to_string(Self::STORAGE_GID_KEY)
            .ok()
            .and_then(|raw| raw.trim().parse::<i64>().ok())
            .unwrap_or(1)
    }

    pub fn persist(orders: &[Order], next_id: i64, next_group_id: i64) -> Result<(), std::io::Error> {
        let orders_json = serde_json::to_string(orders)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

        fs::write(Self::STORAGE_ORDERS_KEY, orders_json)?;
        fs::write(Self::STORAGE_ID_KEY, next_id.to_string())?;
        fs::write(Self::STORAGE_GID_KEY, next_group_id.to_string())?;

        Ok(())
    }
}
