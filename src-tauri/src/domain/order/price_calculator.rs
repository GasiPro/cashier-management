use std::collections::HashMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServiceItemType {
    Product, // Serializes/deserializes to "product" or "produit" via serde configs if needed
    Service, // Serializes/deserializes to "service"
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServiceItem {
    pub id: String,
    #[serde(rename = "type")]
    pub item_type: ServiceItemType, // 'type' is a reserved keyword in Rust
    pub category: String,
    pub label: String,
    pub price: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CartItem {
    pub service: ServiceItem,
    pub qty: u32,
    #[serde(rename = "unitPrice")]
    pub unit_price: u32,
    /// Free-text note left by the counter for the cashier (e.g. special instructions).
    /// Defaults to an empty string so payloads sent before this field existed still
    /// deserialize cleanly.
    #[serde(default)]
    pub observation: String,
}

// Trait bounds / duck-typing structures used for looser function signatures
pub struct MinimalOrderRow {
    pub quantity: u32,
    pub unit_price: u32,
}

pub struct MinimalServiceRow {
    pub service_type: String,
}

pub struct PriceCalculator;

impl PriceCalculator {
    #[inline]
    pub fn calculate_line_total(qty: u32, unit_price: u32) -> u32 {
        qty * unit_price
    }

    /// Accumulates total revenue from an array slice of orders
    pub fn calculate_revenue(paid_orders: &[MinimalOrderRow]) -> u32 {
        paid_orders
            .iter()
            .fold(0, |sum, o| sum + Self::calculate_line_total(o.quantity, o.unit_price))
    }

    /// Groups and counts matching occurrences of service types into a HashMap
    pub fn aggregate_volume_by_service(paid_orders: &[MinimalServiceRow]) -> HashMap<String, u32> {
        paid_orders.iter().fold(HashMap::new(), |mut acc, o| {
            // entry() inserts a default 0 if key doesn't exist yet, then returns a mutable reference
            *acc.entry(o.service_type.clone()).or_insert(0) += 1;
            acc
        })
    }
}
