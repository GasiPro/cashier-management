use crate::config::default::{DEFAULT_NEXT_GROUP_ID, DEFAULT_NEXT_ORDER_ID};
use crate::models::order::{CartItem, Order, OrderStatus};
use crate::repositories::order_repository::OrderApi;
use chrono::{Local, Utc};
use std::sync::Mutex;
use tauri::AppHandle;

pub struct OrderService {
    state: Mutex<OrderState>,
    app_handle: Mutex<Option<AppHandle>>,
}

#[derive(Clone)]
struct OrderState {
    orders: Vec<Order>,
    next_id: i64,
    next_group_id: i64,
}

impl Default for OrderService {
    fn default() -> Self {
        Self::new()
    }
}

impl OrderService {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(OrderState {
                orders: Vec::new(),
                next_id: DEFAULT_NEXT_ORDER_ID,
                next_group_id: DEFAULT_NEXT_GROUP_ID,
            }),
            app_handle: Mutex::new(None),
        }
    }

    pub fn load(&self, app: &AppHandle) {
        let orders = OrderApi::load_orders(app);
        let next_id = OrderApi::load_next_id(app);
        let next_group_id = OrderApi::load_next_group_id(app);
        {
            let mut guard = self.state.lock().unwrap();
            guard.orders = orders;
            guard.next_id = next_id;
            guard.next_group_id = next_group_id;
        }
        *self.app_handle.lock().unwrap() = Some(app.clone());
    }

    pub fn get_orders(&self) -> Vec<Order> {
        let guard = self.state.lock().unwrap();
        guard.orders.clone()
    }

    pub fn get_pending(&self) -> Vec<Order> {
        let guard = self.state.lock().unwrap();
        guard
            .orders
            .iter()
            .filter(|o| o.status == OrderStatus::EnAttente)
            .cloned()
            .collect()
    }

    pub fn get_paid(&self) -> Vec<Order> {
        let guard = self.state.lock().unwrap();
        guard
            .orders
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
                service_type: format!("{} — {}", item.service.category, item.label),
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
            return Err("Aucune commande en attente trouvée pour ce groupe.".to_string());
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
            return Err("Aucune commande en attente trouvée pour ce groupe.".to_string());
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
            return Err("Commande introuvable ou déjà traitée.".to_string());
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
            return Err("Commande introuvable ou déjà traitée.".to_string());
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
            return Err("Aucune commande en attente trouvée pour ce groupe.".to_string());
        }
        self.commit(&mut guard, snapshot)
    }

    fn commit(&self, guard: &mut OrderState, snapshot: OrderState) -> Result<(), String> {
        let app_handle = self.app_handle.lock().unwrap().clone();
        let Some(app_handle) = app_handle else {
            *guard = snapshot;
            return Err("Serveur non prêt. Réessayez.".to_string());
        };
        if let Err(err) = OrderApi::persist(&app_handle, &guard.orders, guard.next_id, guard.next_group_id) {
            *guard = snapshot;
            return Err(format!(
                "Échec de l'enregistrement des commandes sur le disque : {err}"
            ));
        }
        Ok(())
    }
}
