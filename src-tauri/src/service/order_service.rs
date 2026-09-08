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
    pub fn create_order(&self, cart: &[CartItem], counter_username: &str) -> Result<(), String> {
        if cart.is_empty() {
            return Err("Le panier est vide.".to_string());
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
        self.commit(&mut guard);
        Ok(())
    }
    pub fn mark_group_as_paid(&self, group_id: i64) -> Result<(), String> {
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
            Ok(())
        } else {
            Err("Aucune commande en attente trouvée pour ce groupe.".to_string())
        }
    }
    pub fn reject_group(&self, group_id: i64, raison: Option<String>) -> Result<(), String> {
        let mut guard = self.state.lock().unwrap();
        let mut changed = false;
        for order in &mut guard.orders {
            if order.group_id == group_id && order.status == OrderStatus::EnAttente {
                order.status = OrderStatus::Rejetee;
                order.raison = raison.clone();
                changed = true;
            }
        }
        if changed {
            self.commit(&mut guard);
            Ok(())
        } else {
            Err("Aucune commande en attente trouvée pour ce groupe.".to_string())
        }
    }
    pub fn update_order(&self, id: i64, quantity: u32, unit_price: u32) -> Result<(), String> {
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
            Ok(())
        } else {
            Err("Commande introuvable ou déjà traitée.".to_string())
        }
    }
    pub fn delete_order(&self, id: i64) -> Result<(), String> {
        let mut guard = self.state.lock().unwrap();
        let before = guard.orders.len();
        guard
            .orders
            .retain(|o| !(o.id == id && o.status == OrderStatus::EnAttente));
        if guard.orders.len() != before {
            self.commit(&mut guard);
            Ok(())
        } else {
            Err("Commande introuvable ou déjà traitée.".to_string())
        }
    }
    pub fn delete_order_group(&self, group_id: i64) -> Result<(), String> {
        let mut guard = self.state.lock().unwrap();
        let before = guard.orders.len();
        guard
            .orders
            .retain(|o| !(o.group_id == group_id && o.status == OrderStatus::EnAttente));
        if guard.orders.len() != before {
            self.commit(&mut guard);
            Ok(())
        } else {
            Err("Aucune commande en attente trouvée pour ce groupe.".to_string())
        }
    }
    fn commit(&self, guard: &mut OrderState) {
        let _ = OrderApi::persist(&guard.orders, guard.next_id, guard.next_group_id);
    }
}
