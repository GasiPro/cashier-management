use crate::models::account::Account;
use crate::models::order::{CartItem, Order, OrderChange};
use crate::models::pricing::ServiceItem;
use serde::{Deserialize, Deserializer, Serialize};
use std::sync::atomic::{AtomicI64, Ordering};
static NEXT_BLACKLIST_ID: AtomicI64 = AtomicI64::new(1);
static NEXT_HISTORY_ID: AtomicI64 = AtomicI64::new(1);
pub fn next_blacklist_id() -> i64 {
    NEXT_BLACKLIST_ID.fetch_add(1, Ordering::Relaxed)
}
fn bump_blacklist_id_floor(id: i64) {
    NEXT_BLACKLIST_ID.fetch_max(id + 1, Ordering::Relaxed);
}
pub fn next_history_id() -> i64 {
    NEXT_HISTORY_ID.fetch_add(1, Ordering::Relaxed)
}
pub fn bump_history_id_floor(id: i64) {
    NEXT_HISTORY_ID.fetch_max(id + 1, Ordering::Relaxed);
}
pub fn ip_from_addr(addr: &str) -> &str {
    addr.rsplit_once(':').map(|(ip, _)| ip).unwrap_or(addr)
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlacklistType {
    Ip,
    Username,
}
#[derive(Debug, Clone, Serialize)]
pub struct BlacklistEntry {
    pub id: i64,
    #[serde(rename = "type")]
    pub entry_type: BlacklistType,
    pub value: String,
    pub reason: Option<String>,
    pub created_at: String,
}
#[derive(Deserialize)]
struct RawBlacklistEntry {
    #[serde(default)]
    id: Option<i64>,
    #[serde(default, rename = "type")]
    entry_type: Option<BlacklistType>,
    #[serde(default)]
    value: Option<String>,
    #[serde(default)]
    addr: Option<String>,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    created_at: Option<String>,
}
impl<'de> Deserialize<'de> for BlacklistEntry {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = RawBlacklistEntry::deserialize(deserializer)?;
        let entry_type = raw.entry_type.unwrap_or(BlacklistType::Ip);
        let raw_value = raw.value.or(raw.addr).unwrap_or_default();
        let value = match entry_type {
            BlacklistType::Ip => ip_from_addr(&raw_value).to_string(),
            BlacklistType::Username => raw_value.trim().to_string(),
        };
        let id = match raw.id {
            Some(id) if id > 0 => id,
            _ => next_blacklist_id(),
        };
        bump_blacklist_id_floor(id);
        Ok(BlacklistEntry {
            id,
            entry_type,
            value,
            reason: raw.reason,
            created_at: raw
                .created_at
                .unwrap_or_else(|| chrono::Local::now().to_rfc3339()),
        })
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionEvent {
    Requested,
    Approved,
    Rejected,
    Disconnected,
    Blocked,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionHistoryEntry {
    #[serde(default)]
    pub id: i64,
    pub addr: String,
    pub username: String,
    pub event: ConnectionEvent,
    pub timestamp: String,
}
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    #[serde(rename = "register_cashier")]
    CashierRegister { username: String, token: String },
    #[serde(rename = "register_admin")]
    AdminRegister {
        #[serde(default)]
        username: Option<String>,
        token: String,
    },
    #[serde(rename = "register_counter")]
    CounterRegister {
        #[serde(default)]
        username: Option<String>,
        token: String,
    },
    #[serde(rename = "request_connection")]
    RequestConnection { username: String, password: String },
    #[serde(rename = "order_create")]
    CreateOrder {
        cart: Vec<CartItem>,
        #[serde(default)]
        group_id: Option<i64>,
    },
    #[serde(rename = "order_update")]
    UpdateOrder {
        id: i64,
        quantity: u32,
        unit_price: u32,
    },
    #[serde(rename = "order_delete")]
    DeleteOrder { id: i64 },
    #[serde(rename = "order_delete_group")]
    DeleteOrderGroup { group_id: i64 },
    #[serde(rename = "request_orders")]
    RequestOrders,
    #[serde(rename = "request_pricing")]
    RequestPricing,
    #[serde(rename = "account_get")]
    GetAccount,
    #[serde(rename = "account_update")]
    UpdateAccount {
        display_name: String,
        password: Option<String>,
    },
}
#[derive(Debug, Serialize, Clone)]
pub struct PendingConnection {
    pub id: i64,
    pub label: String,
    pub username: Option<String>,
    pub ip_address: String,
    pub port: u16,
    pub requested_at: String,
}
pub type ConnectionRequest = PendingConnection;
#[derive(Debug, Serialize, Clone)]
pub struct ConnectedDevice {
    pub id: i64,
    pub label: String,
    pub username: Option<String>,
    pub ip_address: String,
    pub port: u16,
    pub connected_at: String,
}
#[derive(Debug, Clone, Serialize)]
pub struct ConnectionHistoryView {
    pub id: i64,
    pub label: String,
    pub username: Option<String>,
    pub ip_address: String,
    pub event: &'static str,
    pub at: String,
}
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type")]
pub enum ServerMessage {
    #[serde(rename = "orders")]
    Orders { data: Vec<Order> },
    #[serde(rename = "time")]
    Time { data: String },
    #[serde(rename = "connection_requests")]
    ConnectionRequests { data: Vec<ConnectionRequest> },
    #[serde(rename = "connection_devices")]
    ConnectedDevices { data: Vec<ConnectedDevice> },
    #[serde(rename = "connection_pending")]
    ConnectionPending,
    #[serde(rename = "connection_approved")]
    ConnectionApproved,
    #[serde(rename = "connection_rejected")]
    ConnectionRejected,
    #[serde(rename = "connection_blocked")]
    ConnectionBlocked,
    #[serde(rename = "account_data")]
    Account { data: Account },
    #[serde(rename = "account_updated")]
    AccountUpdated { data: Account },
    #[serde(rename = "account_update_error")]
    AccountUpdateError { data: String },
    #[serde(rename = "error_order")]
    OrderError { data: String },
    #[serde(rename = "order_notification")]
    OrderNotification { data: OrderChange },
    #[serde(rename = "pricing")]
    Pricing { data: Vec<ServiceItem> },
    #[serde(rename = "error_protocol")]
    ProtocolError { data: String },
}
