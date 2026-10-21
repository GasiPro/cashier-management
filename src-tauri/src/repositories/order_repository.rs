use crate::config::default::{DEFAULT_NEXT_GROUP_ID, DEFAULT_NEXT_ORDER_ID};
use crate::infrastructure::filesystem::{config_file_path, read_json, write_atomic};
use crate::models::order::Order;
use tauri::AppHandle;

pub struct OrderApi;

impl OrderApi {
    const ORDERS_FILE_NAME: &'static str = "gasipro_orders.json";
    const ID_FILE_NAME: &'static str = "gasipro_nextId.txt";
    const GID_FILE_NAME: &'static str = "gasipro_nextGroupId.txt";

    pub fn load_orders(app: &AppHandle) -> Vec<Order> {
        config_file_path(app, Self::ORDERS_FILE_NAME)
            .ok()
            .and_then(|path| read_json(&path))
            .unwrap_or_default()
    }

    pub fn load_next_id(app: &AppHandle) -> i64 {
        Self::load_counter(app, Self::ID_FILE_NAME, DEFAULT_NEXT_ORDER_ID)
    }

    pub fn load_next_group_id(app: &AppHandle) -> i64 {
        Self::load_counter(app, Self::GID_FILE_NAME, DEFAULT_NEXT_GROUP_ID)
    }

    pub fn persist(app: &AppHandle, orders: &[Order], next_id: i64, next_group_id: i64) -> Result<(), String> {
        let orders_json = serde_json::to_string(orders).map_err(|e| e.to_string())?;
        write_atomic(&config_file_path(app, Self::ORDERS_FILE_NAME)?, &orders_json)?;
        write_atomic(&config_file_path(app, Self::ID_FILE_NAME)?, &next_id.to_string())?;
        write_atomic(&config_file_path(app, Self::GID_FILE_NAME)?, &next_group_id.to_string())
    }

    fn load_counter(app: &AppHandle, file_name: &str, default: i64) -> i64 {
        config_file_path(app, file_name)
            .ok()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|raw| raw.trim().parse().ok())
            .unwrap_or(default)
    }
}
