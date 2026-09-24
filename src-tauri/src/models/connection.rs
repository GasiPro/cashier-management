use std::sync::atomic::{AtomicI64, Ordering};
use serde::{Deserialize, Deserializer, Serialize};
use crate::models::account::Account;
use crate::models::order::{CartItem, Order};
use crate::models::pricing::ServiceItem;
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
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    CashierRegister { username: String, token: String },
    AdminRegister { #[serde(default)] username: Option<String>, token: String },
    CounterRegister { #[serde(default)] username: Option<String>, token: String },
    RequestConnection { username: String, password: String },
    CreateOrder { cart: Vec<CartItem> },
    UpdateOrder { id: i64, quantity: u32, unit_price: u32 },
    DeleteOrder { id: i64 },
    DeleteOrderGroup { group_id: i64 },
    RequestOrders,
    RequestPricing,
    GetAccount,
    UpdateAccount { display_name: String, password: Option<String> },
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
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    Orders { data: Vec<Order> },
    Time { data: String },
    ConnectionRequests { data: Vec<ConnectionRequest> },
    ConnectedDevices { data: Vec<ConnectedDevice> },
    ConnectionApproved,
    ConnectionRejected,
    ConnectionBlocked,
    Account { data: Account },
    AccountUpdated { data: Account },
    AccountUpdateError { data: String },
    OrderError { data: String },
    Pricing { data: Vec<ServiceItem> },
    ProtocolError { data: String },
}
