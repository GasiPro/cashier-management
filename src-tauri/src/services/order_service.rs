use crate::config::default::{DEFAULT_NEXT_GROUP_ID, DEFAULT_NEXT_ORDER_ID};
use crate::app::AppState;
use crate::domain::pricing::{
    check_price_change, find_item_by_service_type, price_kind, push_history_entry,
};
use crate::infrastructure::websocket::broadcast_to_approved;
use crate::models::connection::ServerMessage;
use crate::models::order::{CartItem, Order, OrderStatus};
use crate::models::pricing::{PriceAdjustment, PriceAdjustmentKind, ServiceItem};
use crate::repositories::order_repository::OrderApi;
use crate::repositories::{account_repository, pricing_repository};
use crate::services::{pricing_service, stock_service};
use chrono::{Local, Utc};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
const ORDER_NOT_FOUND: &str = "Commande introuvable ou déjà traitée.";
const GROUP_NOT_FOUND: &str = "Aucune commande en attente trouvée pour ce groupe.";
const MAX_CART_LINES: usize = 200;
const MAX_QUANTITY: u32 = 100_000;
const MAX_UNIT_PRICE: u32 = 1_000_000_000;
const MAX_LABEL_LEN: usize = 200;
const MAX_OBSERVATION_LEN: usize = 1_000;
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
        let next_id =
            OrderApi::load_next_id(app).max(orders.iter().map(|o| o.id + 1).max().unwrap_or(0));
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
    pub fn create_order(
        &self,
        cart: &[CartItem],
        counter_username: &str,
        target_group_id: Option<i64>,
    ) -> Result<i64, String> {
        validate_cart(cart)?;
        let catalog = self.catalog();
        let time = Local::now().format("%H:%M").to_string();
        let created_at = Utc::now().to_rfc3339();
        let now = Utc::now().timestamp();
        let mut created_group_id = 0;
        let mut adjustments: Vec<PriceAdjustment> = Vec::new();
        self.modify(|state| {
            let group_id = match target_group_id {
                Some(id) => {
                    let is_pending_own_group = state.orders.iter().any(|o| {
                        o.group_id == id
                            && o.status == OrderStatus::EnAttente
                            && o.counter_username == counter_username
                    });
                    if !is_pending_own_group {
                        return Err(GROUP_NOT_FOUND.to_string());
                    }
                    id
                }
                None => {
                    let id = state.next_group_id;
                    state.next_group_id += 1;
                    id
                }
            };
            created_group_id = group_id;
            for item in cart {
                let service_type = format!("{} — {}", item.service.category, item.label);
                let listed = catalog.iter().find(|s| s.id == item.service.id);
                let normal_price = listed.map_or(item.service.price, |s| s.price);
                let pending_uses = price_kind(normal_price, item.unit_price).map_or(0, |kind| {
                    let same = |a: &&PriceAdjustment| a.item_id == item.service.id && a.kind == kind;
                    adjustments.iter().filter(same).count() as u32
                });
                let adjustment =
                    check_price_change(listed, normal_price, item.unit_price, pending_uses, now)?;
                if target_group_id.is_some() {
                    let same_line = state.orders.iter_mut().find(|o| {
                        o.group_id == group_id
                            && o.status == OrderStatus::EnAttente
                            && o.service_type == service_type
                            && o.unit_price == item.unit_price
                            && o.observation == item.observation
                    });
                    if let Some(line) = same_line {
                        line.quantity += item.qty;
                        validate_amounts(line.quantity, line.unit_price)?;
                        continue;
                    }
                }
                adjustments.extend(adjustment.map(|kind| PriceAdjustment {
                    order_id: state.next_id,
                    item_id: item.service.id.clone(),
                    service_type: service_type.clone(),
                    kind,
                    normal_price,
                    applied_price: item.unit_price,
                    new_use: true,
                }));
                state.orders.push(Order {
                    id: state.next_id,
                    group_id,
                    service_type,
                    unit_price: item.unit_price,
                    original_unit_price: normal_price,
                    quantity: item.qty,
                    status: OrderStatus::EnAttente,
                    time: time.clone(),
                    counter_username: counter_username.to_string(),
                    created_at: created_at.clone(),
                    paid_at: None,
                    observation: item.observation.clone(),
                    raison: None,
                    handled_by: None,
                });
                state.next_id += 1;
            }
            Ok(())
        })?;
        self.record_adjustments(counter_username, adjustments);
        Ok(created_group_id)
    }
    pub fn mark_group_as_paid(
        &self,
        group_id: i64,
        handled_by: Option<String>,
    ) -> Result<(), String> {
        let paid_at = Utc::now().to_rfc3339();
        let handled_by = clean_handler(handled_by);
        self.update_pending_group(group_id, |order| {
            order.status = OrderStatus::Paye;
            order.paid_at = Some(paid_at.clone());
            order.handled_by = handled_by.clone();
        })?;
        self.consume_stock(group_id, handled_by.as_deref());
        Ok(())
    }
    pub fn reject_group(
        &self,
        group_id: i64,
        raison: Option<String>,
        handled_by: Option<String>,
    ) -> Result<(), String> {
        let handled_by = clean_handler(handled_by);
        self.update_pending_group(group_id, |order| {
            order.status = OrderStatus::Rejetee;
            order.raison = raison.clone();
            order.handled_by = handled_by.clone();
        })
    }
    pub fn update_order(
        &self,
        id: i64,
        quantity: u32,
        unit_price: u32,
        owner: Option<&str>,
    ) -> Result<i64, String> {
        validate_amounts(quantity, unit_price)?;
        let catalog = self.catalog();
        let now = Utc::now().timestamp();
        let mut group_id = 0;
        let mut adjustment = None;
        let mut counter_username = String::new();
        self.modify(|state| {
            let order = state
                .orders
                .iter_mut()
                .find(|o| o.id == id && o.status == OrderStatus::EnAttente && is_owned_by(o, owner))
                .ok_or_else(|| ORDER_NOT_FOUND.to_string())?;
            if unit_price != order.unit_price {
                let listed = find_item_by_service_type(&catalog, &order.service_type);
                let normal_price = if order.original_unit_price > 0 {
                    order.original_unit_price
                } else {
                    listed.map_or(order.unit_price, |s| s.price)
                };
                let previous_kind = price_kind(normal_price, order.unit_price);
                let checked = check_price_change(listed, normal_price, unit_price, 0, now)?;
                adjustment = checked.map(|kind| PriceAdjustment {
                    order_id: order.id,
                    item_id: listed.map(|s| s.id.clone()).unwrap_or_default(),
                    service_type: order.service_type.clone(),
                    kind,
                    normal_price,
                    applied_price: unit_price,
                    new_use: previous_kind != Some(kind),
                });
            }
            order.quantity = quantity;
            order.unit_price = unit_price;
            group_id = order.group_id;
            counter_username = order.counter_username.clone();
            Ok(())
        })?;
        self.record_adjustments(&counter_username, adjustment.into_iter().collect());
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
    fn catalog(&self) -> Vec<ServiceItem> {
        let app_handle = self.app_handle.lock().unwrap().clone();
        app_handle
            .and_then(|app| pricing_repository::load(&app))
            .unwrap_or_default()
    }
    fn consume_stock(&self, group_id: i64, handled_by: Option<&str>) {
        let Some(app_handle) = self.app_handle.lock().unwrap().clone() else {
            return;
        };
        let Some(state) = app_handle.try_state::<AppState>() else {
            return;
        };
        let lines: Vec<(String, u32)> = self
            .state
            .lock()
            .unwrap()
            .orders
            .iter()
            .filter(|o| o.group_id == group_id && o.status == OrderStatus::Paye)
            .map(|o| (o.service_type.clone(), o.quantity))
            .collect();
        stock_service::consume_order(
            &app_handle,
            &state.accounts,
            &state.pricing,
            &state.stock,
            group_id,
            &lines,
            handled_by,
        );
    }
    fn record_adjustments(&self, counter_username: &str, adjustments: Vec<PriceAdjustment>) {
        if adjustments.is_empty() {
            return;
        }
        let Some(app_handle) = self.app_handle.lock().unwrap().clone() else {
            return;
        };
        let counter_id = account_repository::load(&app_handle)
            .into_iter()
            .find(|a| a.username.eq_ignore_ascii_case(counter_username))
            .map(|a| a.id)
            .unwrap_or_default();
        let at = Utc::now().to_rfc3339();
        let uses: Vec<(String, PriceAdjustmentKind)> = adjustments
            .iter()
            .filter(|a| a.new_use)
            .map(|a| (a.item_id.clone(), a.kind))
            .collect();
        let recorded = pricing_repository::update_history(&app_handle, |history| {
            for adjustment in adjustments {
                push_history_entry(history, adjustment, counter_username, &counter_id, &at);
            }
        });
        if let Err(err) = recorded {
            log::warn!("Historique des prix non enregistré : {err}");
        }
        Self::consume_uses(&app_handle, &uses);
    }
    fn consume_uses(app: &AppHandle, uses: &[(String, PriceAdjustmentKind)]) {
        let Some(state) = app.try_state::<AppState>() else {
            return;
        };
        let Some(snapshot) = pricing_service::consume_uses(app, &state.pricing, uses) else {
            return;
        };
        let peers = state.peers.clone();
        tauri::async_runtime::spawn(async move {
            broadcast_to_approved(&peers, &ServerMessage::Pricing { data: snapshot }).await;
        });
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
    fn remove_pending(
        &self,
        not_found: &str,
        is_target: impl Fn(&Order) -> bool,
    ) -> Result<i64, String> {
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
    fn modify(
        &self,
        change: impl FnOnce(&mut OrderState) -> Result<(), String>,
    ) -> Result<(), String> {
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
        if let Err(err) = OrderApi::persist(
            &app_handle,
            &state.orders,
            state.next_id,
            state.next_group_id,
        ) {
            *state = snapshot;
            return Err(format!(
                "Échec de l'enregistrement des commandes sur le disque : {err}"
            ));
        }
        Ok(())
    }
}
fn clean_handler(handled_by: Option<String>) -> Option<String> {
    handled_by
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
}
fn is_owned_by(order: &Order, owner: Option<&str>) -> bool {
    owner.map_or(true, |name| order.counter_username == name)
}
fn validate_amounts(quantity: u32, unit_price: u32) -> Result<(), String> {
    if quantity == 0 || quantity > MAX_QUANTITY {
        return Err("Quantité invalide.".to_string());
    }
    if unit_price > MAX_UNIT_PRICE {
        return Err("Prix unitaire invalide.".to_string());
    }
    Ok(())
}
fn validate_cart(cart: &[CartItem]) -> Result<(), String> {
    if cart.is_empty() {
        return Err("Le panier est vide.".to_string());
    }
    if cart.len() > MAX_CART_LINES {
        return Err("Le panier contient trop d'articles.".to_string());
    }
    for item in cart {
        validate_amounts(item.qty, item.unit_price)?;
        if item.label.chars().count() > MAX_LABEL_LEN
            || item.service.category.chars().count() > MAX_LABEL_LEN
        {
            return Err("Libellé d'article trop long.".to_string());
        }
        if item.observation.chars().count() > MAX_OBSERVATION_LEN {
            return Err("Observation trop longue.".to_string());
        }
    }
    Ok(())
}
