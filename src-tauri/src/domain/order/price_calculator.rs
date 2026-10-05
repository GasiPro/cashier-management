use std::collections::HashMap;

use crate::models::pricing::{MinimalOrderRow, MinimalServiceRow};

pub struct PriceCalculator;

impl PriceCalculator {
    #[inline]
    pub fn calculate_line_total(qty: u32, unit_price: u32) -> u32 {
        qty * unit_price
    }

    pub fn calculate_revenue(paid_orders: &[MinimalOrderRow]) -> u32 {
        paid_orders
            .iter()
            .fold(0, |sum, o| sum + Self::calculate_line_total(o.quantity, o.unit_price))
    }

    pub fn aggregate_volume_by_service(paid_orders: &[MinimalServiceRow]) -> HashMap<String, u32> {
        paid_orders.iter().fold(HashMap::new(), |mut acc, o| {
            *acc.entry(o.service_type.clone()).or_insert(0) += 1;
            acc
        })
    }
}
