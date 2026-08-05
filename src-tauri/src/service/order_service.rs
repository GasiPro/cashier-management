use std::sync::Mutex;
use chrono::{Local, Utc};
use crate::domain::order::price_calculator::CartItem;
use crate::service::order_api_service::{Order, OrderApi, OrderStatus};

pub struct OrderService {
    state: Mutex<OrderState>,
}

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

    pub fn create_order(&self, cart: &[CartItem], counter_username: &str) {
        if cart.is_empty() {
            return;
        }

        let mut guard = self.state.lock().unwrap();
        
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
                quantity: item.qty,
                status: OrderStatus::EnAttente,
                time: time.clone(),
                counter_username: counter_username.to_string(),
                created_at: created_at.clone(),
                paid_at: None,
            };
            guard.next_id += 1;
            guard.orders.push(order);
        }

        self.commit(&mut guard);
    }

    pub fn mark_group_as_paid(&self, group_id: i64) {
        let mut guard = self.state.lock().unwrap();
        let paid_at = Utc::now().to_rfc3339();
        let mut changed = false;

        for order in &mut guard.orders {
            if order.group_id == group_id && order.status == OrderStatus::EnAttente {
                order.status = OrderStatus::Paye;
                order.paid_at = Some(paid_at.clone());
                changed = true;
            }
        }

        if changed {
            self.commit(&mut guard);
        }
    }

    /// Caisse: refuse an entire pending order group (e.g. out of stock, client left).
    pub fn reject_group(&self, group_id: i64) {
        let mut guard = self.state.lock().unwrap();
        let mut changed = false;

        for order in &mut guard.orders {
            if order.group_id == group_id && order.status == OrderStatus::EnAttente {
                order.status = OrderStatus::Rejetee;
                changed = true;
            }
        }

        if changed {
            self.commit(&mut guard);
        }
    }

    /// Comptoir: edit the quantity/price of a single pending order line.
    /// No-op if the order isn't pending (already paid/rejected) or doesn't exist.
    pub fn update_order(&self, id: i64, quantity: u32, unit_price: u32) {
        let mut guard = self.state.lock().unwrap();
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

        if changed {
            self.commit(&mut guard);
        }
    }

    /// Comptoir: delete a single pending order line.
    pub fn delete_order(&self, id: i64) {
        let mut guard = self.state.lock().unwrap();
        let before = guard.orders.len();

        guard
            .orders
            .retain(|o| !(o.id == id && o.status == OrderStatus::EnAttente));

        if guard.orders.len() != before {
            self.commit(&mut guard);
        }
    }

    /// Comptoir: delete an entire pending order group (cancels the whole order).
    pub fn delete_order_group(&self, group_id: i64) {
        let mut guard = self.state.lock().unwrap();
        let before = guard.orders.len();

        guard
            .orders
            .retain(|o| !(o.group_id == group_id && o.status == OrderStatus::EnAttente));

        if guard.orders.len() != before {
            self.commit(&mut guard);
        }
    }

    fn commit(&self, guard: &mut OrderState) {
        let _ = OrderApi::persist(&guard.orders, guard.next_id, guard.next_group_id);
    }
}
