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
use infrastructure::websocket::{self, WsContext};
use services::order_service::OrderService;
use services::{account_service, connection_service, pricing_service, setting_service};

pub fn run() {
    let ctx = WsContext {
        order_service: Arc::new(OrderService::new()),
        peers: Arc::new(Mutex::new(HashMap::new())),
        max_connected_devices: Arc::new(SyncMutex::new(DEFAULT_MAX_CONNECTED_DEVICES)),
        accounts: Arc::new(SyncMutex::new(Vec::new())),
        app_handle: Arc::new(SyncMutex::new(None)),
        blacklist: Arc::new(SyncMutex::new(Vec::new())),
        connection_history: Arc::new(SyncMutex::new(Vec::new())),
        pricing: Arc::new(SyncMutex::new(Vec::new())),
        sessions: Arc::new(SyncMutex::new(HashMap::new())),
        connection_attempts: rate_limit::new_tracker(),
    };
    let state = AppState {
        order_service: ctx.order_service.clone(),
        peers: ctx.peers.clone(),
        max_connected_devices: ctx.max_connected_devices.clone(),
        accounts: ctx.accounts.clone(),
        blacklist: ctx.blacklist.clone(),
        connection_history: ctx.connection_history.clone(),
        pricing: ctx.pricing.clone(),
        sessions: ctx.sessions.clone(),
        auth_attempts: rate_limit::new_tracker(),
    };

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
            *ctx.max_connected_devices.lock().unwrap() = loaded_settings.max_connected_devices;
            *ctx.accounts.lock().unwrap() = account_service::load_or_bootstrap(handle);
            *ctx.blacklist.lock().unwrap() = connection_service::load_blacklist(handle);
            *ctx.connection_history.lock().unwrap() = connection_service::load_history(handle);
            *ctx.pricing.lock().unwrap() = pricing_service::load_or_bootstrap(handle);
            ctx.order_service.load(handle);
            *ctx.app_handle.lock().unwrap() = Some(handle.clone());

            // Start serving only once every store is loaded.
            websocket::start_clock(ctx.peers.clone());
            websocket::start_server(ctx);
            Ok(())
        })
        .manage(state)
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
