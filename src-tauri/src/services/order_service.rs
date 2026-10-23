use crate::config::default::{DEFAULT_NEXT_GROUP_ID, DEFAULT_NEXT_ORDER_ID};
use crate::models::order::{CartItem, Order, OrderStatus};
use crate::repositories::order_repository::OrderApi;
use chrono::{Local, Utc};
use std::sync::Mutex;
use tauri::AppHandle;
const ORDER_NOT_FOUND: &str = "Commande introuvable ou déjà traitée.";
const GROUP_NOT_FOUND: &str = "Aucune commande en attente trouvée pour ce groupe.";
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
        let next_id = OrderApi::load_next_id(app)
            .max(orders.iter().map(|o| o.id + 1).max().unwrap_or(0));
        let next_group_id = OrderApi::load_next_group_id(app)
            .max(orders.iter().map(|o| o.group_id + 1).max().unwrap_or(0));
        *self.state.lock().unwrap() = OrderState {
            orders,
            next_id,
            next_group_id,
        };
        *self.app_handle.lock().unwrap() = Some(app.clone());
    }
    pub fn get_orders(&self) -> Vec<Order> {
        self.state.lock().unwrap().orders.clone()
    }
    pub fn get_pending(&self) -> Vec<Order> {
        self.orders_with_status(OrderStatus::EnAttente)
    }
    pub fn get_paid(&self) -> Vec<Order> {
        self.orders_with_status(OrderStatus::Paye)
    }
    pub fn create_order(&self, cart: &[CartItem], counter_username: &str) -> Result<i64, String> {
        if cart.is_empty() {
            return Err("Le panier est vide.".to_string());
        }
        let time = Local::now().format("%H:%M").to_string();
        let created_at = Utc::now().to_rfc3339();
        let mut created_group_id = 0;
        self.modify(|state| {
            let group_id = state.next_group_id;
            created_group_id = group_id;
            state.next_group_id += 1;
            for item in cart {
                state.orders.push(Order {
                    id: state.next_id,
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
                });
                state.next_id += 1;
            }
            Ok(())
        })?;
        Ok(created_group_id)
    }
    pub fn mark_group_as_paid(&self, group_id: i64) -> Result<(), String> {
        let paid_at = Utc::now().to_rfc3339();
        self.update_pending_group(group_id, |order| {
            order.status = OrderStatus::Paye;
            order.paid_at = Some(paid_at.clone());
        })
    }
    pub fn reject_group(&self, group_id: i64, raison: Option<String>) -> Result<(), String> {
        self.update_pending_group(group_id, |order| {
            order.status = OrderStatus::Rejetee;
            order.raison = raison.clone();
        })
    }
    pub fn update_order(
        &self,
        id: i64,
        quantity: u32,
        unit_price: u32,
        owner: Option<&str>,
    ) -> Result<i64, String> {
        let mut group_id = 0;
        self.modify(|state| {
            let order = state
                .orders
                .iter_mut()
                .find(|o| o.id == id && o.status == OrderStatus::EnAttente && is_owned_by(o, owner))
                .ok_or_else(|| ORDER_NOT_FOUND.to_string())?;
            order.quantity = quantity;
            order.unit_price = unit_price;
            group_id = order.group_id;
            Ok(())
        })?;
        Ok(group_id)
    }
    pub fn delete_order(&self, id: i64, owner: Option<&str>) -> Result<i64, String> {
        self.remove_pending(ORDER_NOT_FOUND, |o| o.id == id && is_owned_by(o, owner))
    }
    pub fn delete_order_group(&self, group_id: i64, owner: Option<&str>) -> Result<i64, String> {
        self.remove_pending(GROUP_NOT_FOUND, |o| {
            o.group_id == group_id && is_owned_by(o, owner)
        })
    }
    fn orders_with_status(&self, status: OrderStatus) -> Vec<Order> {
        self.state
            .lock()
            .unwrap()
            .orders
            .iter()
            .filter(|o| o.status == status)
            .cloned()
            .collect()
    }
    fn update_pending_group(
        &self,
        group_id: i64,
        mut apply: impl FnMut(&mut Order),
    ) -> Result<(), String> {
        self.modify(|state| {
            let mut changed = false;
            for order in state
                .orders
                .iter_mut()
                .filter(|o| o.group_id == group_id && o.status == OrderStatus::EnAttente)
            {
                apply(order);
                changed = true;
            }
            if changed {
                Ok(())
            } else {
                Err(GROUP_NOT_FOUND.to_string())
            }
        })
    }
    fn remove_pending(&self, not_found: &str, is_target: impl Fn(&Order) -> bool) -> Result<i64, String> {
        let mut removed_group_id = 0;
        self.modify(|state| {
            let Some(found) = state
                .orders
                .iter()
                .find(|o| o.status == OrderStatus::EnAttente && is_target(o))
            else {
                return Err(not_found.to_string());
            };
            removed_group_id = found.group_id;
            state
                .orders
                .retain(|o| !(o.status == OrderStatus::EnAttente && is_target(o)));
            Ok(())
        })?;
        Ok(removed_group_id)
    }
    fn modify(&self, change: impl FnOnce(&mut OrderState) -> Result<(), String>) -> Result<(), String> {
        let mut guard = self.state.lock().unwrap();
        let snapshot = guard.clone();
        if let Err(err) = change(&mut *guard) {
            *guard = snapshot;
            return Err(err);
        }
        self.commit(&mut guard, snapshot)
    }
    fn commit(&self, state: &mut OrderState, snapshot: OrderState) -> Result<(), String> {
        let app_handle = self.app_handle.lock().unwrap().clone();
        let Some(app_handle) = app_handle else {
            *state = snapshot;
            return Err("Serveur non prêt. Réessayez.".to_string());
        };
        if let Err(err) = OrderApi::persist(&app_handle, &state.orders, state.next_id, state.next_group_id) {
            *state = snapshot;
            return Err(format!(
                "Échec de l'enregistrement des commandes sur le disque : {err}"
            ));
        }
        Ok(())
    }
}
fn is_owned_by(order: &Order, owner: Option<&str>) -> bool {
    owner.map_or(true, |name| order.counter_username == name)
}
