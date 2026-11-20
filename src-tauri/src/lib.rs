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
use infrastructure::splash;
use models::setting::AppMode;
use models::stock::StockData;
use services::order_service::OrderService;
use services::setting_service;
pub fn run() {
    let state = AppState {
        order_service: Arc::new(OrderService::new()),
        peers: Arc::new(Mutex::new(HashMap::new())),
        max_connected_devices: Arc::new(SyncMutex::new(DEFAULT_MAX_CONNECTED_DEVICES)),
        accounts: Arc::new(SyncMutex::new(Vec::new())),
        blacklist: Arc::new(SyncMutex::new(Vec::new())),
        connection_history: Arc::new(SyncMutex::new(Vec::new())),
        pricing: Arc::new(SyncMutex::new(Vec::new())),
        reports: Arc::new(SyncMutex::new(Vec::new())),
        stock: Arc::new(SyncMutex::new(StockData::default())),
        sessions: Arc::new(SyncMutex::new(HashMap::new())),
        auth_attempts: rate_limit::new_tracker(),
    };
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let handle = app.handle();
            splash::open(handle)?;
            if setting_service::load_mode(handle) == Some(AppMode::Caisse) {
                app::runtime::start_caisse(handle);
            }
            Ok(())
        })
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::server_command::server,
            commands::pricing_command::pricing,
            commands::order_command::order,
            commands::report_command::report,
            commands::setting_command::settings,
            commands::auth_command::auth,
            commands::account_command::account,
            commands::file_command::file,
            commands::splash_command::splash,
            commands::stock_command::stock,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
