use crate::app::AppState;
use crate::config::rate_limit;
use crate::infrastructure::websocket::{self, WsContext};
use crate::services::{
    account_service, connection_service, pricing_service, report_service, setting_service,
    stock_service,
};
use std::sync::{Arc, Mutex as SyncMutex};
use tauri::{AppHandle, Manager};

pub fn start_caisse(app: &AppHandle) {
    let state = app.state::<AppState>();
    *state.max_connected_devices.lock().unwrap() =
        setting_service::load_settings(app).max_connected_devices;
    *state.accounts.lock().unwrap() = account_service::load_or_bootstrap(app);
    *state.blacklist.lock().unwrap() = connection_service::load_blacklist(app);
    *state.connection_history.lock().unwrap() = connection_service::load_history(app);
    *state.pricing.lock().unwrap() = pricing_service::load_or_bootstrap(app);
    *state.reports.lock().unwrap() = report_service::load(app);
    stock_service::migrate_item_ids(app, &state.pricing);
    *state.stock.lock().unwrap() = stock_service::load(app);
    state.order_service.load(app);
    let ctx = WsContext {
        order_service: state.order_service.clone(),
        peers: state.peers.clone(),
        max_connected_devices: state.max_connected_devices.clone(),
        accounts: state.accounts.clone(),
        app_handle: Arc::new(SyncMutex::new(Some(app.clone()))),
        blacklist: state.blacklist.clone(),
        connection_history: state.connection_history.clone(),
        pricing: state.pricing.clone(),
        sessions: state.sessions.clone(),
        connection_attempts: rate_limit::new_tracker(),
    };
    websocket::start_clock(ctx.peers.clone());
    websocket::start_server(ctx);
}
