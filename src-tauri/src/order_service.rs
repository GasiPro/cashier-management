
use std::sync::Mutex;
use chrono::{Local, Utc};
use crate::domain::order::price_calculator::CartItem;
use crate::service::order_api_service::{Order, OrderApi, OrderStatus};
pub struct OrderService {
    state: Mutex<OrderState>,
}
#[derive(Clone)]
struct OrderState {
    orders: Vec<Order>,
    next_id: i64,
    next_group_id: i64,
}
impl OrderService {
    pub fn new() -> Self {
        let orders = OrderApi::load_orders();
        let next_id = OrderApi::load_next_id();
        let next_group_id = OrderApi::load_next_group_id();
        Self {
            state: Mutex::new(OrderState {
                orders,
                next_id,
                next_group_id,
            }),
        }
    }
    pub fn get_orders(&self) -> Vec<Order> {
        let guard = self.state.lock().unwrap();
        guard.orders.clone()
    }
    pub fn get_pending(&self) -> Vec<Order> {
        let guard = self.state.lock().unwrap();
        guard.orders
            .iter()
            .filter(|o| o.status == OrderStatus::EnAttente)
            .cloned()
            .collect()
    }
    pub fn get_paid(&self) -> Vec<Order> {
        let guard = self.state.lock().unwrap();
        guard.orders
            .iter()
            .filter(|o| o.status == OrderStatus::Paye)
            .cloned()
            .collect()
    }
    /// Creates one order per cart item. Returns `Err` — leaving the in-memory
    /// state exactly as it was before the call — if the new orders could not
    /// be persisted to disk, so callers never broadcast or report success for
    /// data that didn't actually make it to storage.
    pub fn create_order(&self, cart: &[CartItem], counter_username: &str) -> Result<(), String> {
        if cart.is_empty() {
            return Ok(());
        }
        let mut guard = self.state.lock().unwrap();
        let snapshot = guard.clone();
        let now = Local::now();
        let time = now.format("%H:%M").to_string();
        let created_at = Utc::now().to_rfc3339();
        let group_id = guard.next_group_id;
        guard.next_group_id += 1;
        for item in cart {
            let order = Order {
                id: guard.next_id,
                group_id,
                service_type: format!("{} — {}", item.service.category, item.service.label),
                unit_price: item.unit_price,
                original_unit_price: item.service.price,
                quantity: item.qty,
                status: OrderStatus::EnAttente,
                time: time.clone(),
                counter_username: counter_username.to_string(),
                created_at: created_at.clone(),
                paid_at: None,
                observation: item.observation.clone(),
                raison: None,
            };
            guard.next_id += 1;
            guard.orders.push(order);
        }
        self.commit(&mut guard, snapshot)
    }
    pub fn mark_group_as_paid(&self, group_id: i64) -> Result<(), String> {
        let mut guard = self.state.lock().unwrap();
        let snapshot = guard.clone();
        let paid_at = Utc::now().to_rfc3339();
        let mut changed = false;
        for order in &mut guard.orders {
            if order.group_id == group_id && order.status == OrderStatus::EnAttente {
                order.status = OrderStatus::Paye;
                order.paid_at = Some(paid_at.clone());
                changed = true;
            }
        }
        if !changed {
            return Ok(());
        }
        self.commit(&mut guard, snapshot)
    }
    pub fn reject_group(&self, group_id: i64, raison: Option<String>) -> Result<(), String> {
        let mut guard = self.state.lock().unwrap();
        let snapshot = guard.clone();
        let mut changed = false;
        for order in &mut guard.orders {
            if order.group_id == group_id && order.status == OrderStatus::EnAttente {
                order.status = OrderStatus::Rejetee;
                order.raison = raison.clone();
                changed = true;
            }
        }
        if !changed {
            return Ok(());
        }
        self.commit(&mut guard, snapshot)
    }
    pub fn update_order(&self, id: i64, quantity: u32, unit_price: u32) -> Result<(), String> {
        let mut guard = self.state.lock().unwrap();
        let snapshot = guard.clone();
        let mut changed = false;
        if let Some(order) = guard
            .orders
            .iter_mut()
            .find(|o| o.id == id && o.status == OrderStatus::EnAttente)
        {
            order.quantity = quantity;
            order.unit_price = unit_price;
            changed = true;
        }
        if !changed {
            return Ok(());
        }
        self.commit(&mut guard, snapshot)
    }
    pub fn delete_order(&self, id: i64) -> Result<(), String> {
        let mut guard = self.state.lock().unwrap();
        let snapshot = guard.clone();
        let before = guard.orders.len();
        guard
            .orders
            .retain(|o| !(o.id == id && o.status == OrderStatus::EnAttente));
        if guard.orders.len() == before {
            return Ok(());
        }
        self.commit(&mut guard, snapshot)
    }
    pub fn delete_order_group(&self, group_id: i64) -> Result<(), String> {
        let mut guard = self.state.lock().unwrap();
        let snapshot = guard.clone();
        let before = guard.orders.len();
        guard
            .orders
            .retain(|o| !(o.group_id == group_id && o.status == OrderStatus::EnAttente));
        if guard.orders.len() == before {
            return Ok(());
        }
        self.commit(&mut guard, snapshot)
    }
    /// Persists the current state to disk. On failure the in-memory state is
    /// rolled back to `snapshot` so it can never drift from what's actually
    /// on disk, and a clear, actionable error is returned to the caller
    /// instead of being silently discarded.
    fn commit(&self, guard: &mut OrderState, snapshot: OrderState) -> Result<(), String> {
        if let Err(err) = OrderApi::persist(&guard.orders, guard.next_id, guard.next_group_id) {
            *guard = snapshot;
            return Err(format!(
                "Échec de l'enregistrement des commandes sur le disque : {err}"
            ));
        }
        Ok(())
    }
}
