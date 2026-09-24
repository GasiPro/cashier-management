use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::Mutex as SyncMutex;
use tokio::sync::Mutex;
use crate::config::accounts;
use crate::config::connection_config;
use crate::config::rate_limit;
use crate::domain::order::price_calculator::ServiceItem;
use crate::services::order_service::OrderService;
use crate::PeerState;
pub(crate) type PeerMap = Arc<Mutex<HashMap<SocketAddr, PeerState>>>;
pub(crate) type MaxConnectedDevices = Arc<SyncMutex<u32>>;
pub(crate) type Accounts = Arc<SyncMutex<Vec<accounts::StoredAccount>>>;
pub(crate) type Blacklist = Arc<SyncMutex<Vec<connection_config::BlacklistEntry>>>;
pub(crate) type ConnectionHistory = Arc<SyncMutex<Vec<connection_config::ConnectionHistoryEntry>>>;
pub(crate) type PricingStore = Arc<SyncMutex<Vec<ServiceItem>>>;
pub struct AppState {
    pub order_service: Arc<OrderService>,
    pub peers: PeerMap,
    pub max_connected_devices: MaxConnectedDevices,
    pub accounts: Accounts,
    pub blacklist: Blacklist,
    pub connection_history: ConnectionHistory,
    pub pricing: PricingStore,
    pub sessions: accounts::Sessions,
    pub(crate) auth_attempts: rate_limit::AttemptTracker,
    pub(crate) connection_attempts: rate_limit::AttemptTracker,
}
