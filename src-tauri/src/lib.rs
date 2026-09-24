pub mod app;
pub mod commands;
pub mod config;
pub mod domain;
pub mod infrastructure;
pub mod models;
pub mod repositories;
pub mod services;
use std::collections::HashMap;
use std::sync::{Arc, Mutex as SyncMutex};
use tokio::sync::Mutex;
use app::AppState;
use config::rate_limit;
use config::setting_config::DEFAULT_MAX_CONNECTED_DEVICES;
use infrastructure::websocket::{self, AppHandleSlot, PeerMap, WsContext};
use models::account::Sessions;
use services::account_service::{self, Accounts};
use services::connection_service::{self, Blacklist, ConnectionHistory};
use services::order_service::OrderService;
use services::pricing_service::{self, PricingStore};
use services::setting_service::{self, MaxConnectedDevices};
pub fn run() {
    let order_service = Arc::new(OrderService::new());
    let peers: PeerMap = Arc::new(Mutex::new(HashMap::new()));
    let max_connected_devices: MaxConnectedDevices = Arc::new(SyncMutex::new(DEFAULT_MAX_CONNECTED_DEVICES));
    let accounts_store: Accounts = Arc::new(SyncMutex::new(Vec::new()));
    let app_handle_slot: AppHandleSlot = Arc::new(SyncMutex::new(None));
    let blacklist: Blacklist = Arc::new(SyncMutex::new(Vec::new()));
    let connection_history: ConnectionHistory = Arc::new(SyncMutex::new(Vec::new()));
    let pricing_store: PricingStore = Arc::new(SyncMutex::new(Vec::new()));
    let sessions: Sessions = Arc::new(SyncMutex::new(HashMap::new()));
    let auth_attempts: rate_limit::AttemptTracker = rate_limit::new_tracker();
    let connection_attempts: rate_limit::AttemptTracker = rate_limit::new_tracker();
    websocket::start_server(WsContext {
        order_service: order_service.clone(),
        peers: peers.clone(),
        max_connected_devices: max_connected_devices.clone(),
        accounts: accounts_store.clone(),
        app_handle: app_handle_slot.clone(),
        blacklist: blacklist.clone(),
        connection_history: connection_history.clone(),
        pricing: pricing_store.clone(),
        sessions: sessions.clone(),
        connection_attempts,
    });
    websocket::start_clock(peers.clone());
    let setup_max_connected_devices = max_connected_devices.clone();
    let setup_accounts = accounts_store.clone();
    let setup_app_handle_slot = app_handle_slot.clone();
    let setup_blacklist = blacklist.clone();
    let setup_connection_history = connection_history.clone();
    let setup_pricing = pricing_store.clone();
    let setup_order_service = order_service.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let handle = app.handle();
            let loaded_settings = setting_service::load_settings(handle);
            *setup_max_connected_devices.lock().unwrap() = loaded_settings.max_connected_devices;
            *setup_accounts.lock().unwrap() = account_service::load_or_bootstrap(handle);
            *setup_blacklist.lock().unwrap() = connection_service::load_blacklist(handle);
            *setup_connection_history.lock().unwrap() = connection_service::load_history(handle);
            *setup_pricing.lock().unwrap() = pricing_service::load_or_bootstrap(handle);
            setup_order_service.load(handle);
            *setup_app_handle_slot.lock().unwrap() = Some(handle.clone());
            Ok(())
        })
        .manage(AppState {
            order_service,
            peers,
            max_connected_devices,
            accounts: accounts_store,
            blacklist,
            connection_history,
            pricing: pricing_store,
            sessions,
            auth_attempts,
        })
        .invoke_handler(tauri::generate_handler![
            commands::server_command::server,
            commands::pricing_command::pricing,
            commands::order_command::order,
            commands::setting_command::settings,
            commands::auth_command::auth,
            commands::account_command::account,
            commands::file_command::file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
