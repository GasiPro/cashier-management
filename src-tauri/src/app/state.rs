use std::sync::Arc;
use crate::config::rate_limit::AttemptTracker;
use crate::infrastructure::websocket::PeerMap;
use crate::models::account::Sessions;
use crate::services::account_service::Accounts;
use crate::services::connection_service::{Blacklist, ConnectionHistory};
use crate::services::order_service::OrderService;
use crate::services::pricing_service::PricingStore;
use crate::services::setting_service::MaxConnectedDevices;
pub struct AppState {
    pub order_service: Arc<OrderService>,
    pub peers: PeerMap,
    pub max_connected_devices: MaxConnectedDevices,
    pub accounts: Accounts,
    pub blacklist: Blacklist,
    pub connection_history: ConnectionHistory,
    pub pricing: PricingStore,
    pub sessions: Sessions,
    pub(crate) auth_attempts: AttemptTracker,
}
