use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OrderStatus {
    EnAttente,
    Paye,
    Rejetee,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Order {
    pub id: i64,
    pub group_id: i64,
    pub service_type: String,
    pub unit_price: u32,
    #[serde(default)]
    pub original_unit_price: u32,
    pub quantity: u32,
    pub status: OrderStatus,
    pub time: String,
    #[serde(default)]
    pub counter_username: String,
   pub created_at: String,
    pub paid_at: Option<String>,
    #[serde(default)]
    pub observation: String,
    #[serde(default)]
    pub raison: Option<String>,
}
pub struct OrderApi;
impl OrderApi {
    const ORDERS_FILE_NAME: &'static str = "gasipro_orders.json";
    const ID_FILE_NAME: &'static str = "gasipro_nextId.txt";
    const GID_FILE_NAME: &'static str = "gasipro_nextGroupId.txt";
    fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
        let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(dir)
    }
    fn orders_file_path(app: &AppHandle) -> Result<PathBuf, String> {
        Ok(Self::config_dir(app)?.join(Self::ORDERS_FILE_NAME))
    }
    fn id_file_path(app: &AppHandle) -> Result<PathBuf, String> {
        Ok(Self::config_dir(app)?.join(Self::ID_FILE_NAME))
    }
    fn gid_file_path(app: &AppHandle) -> Result<PathBuf, String> {
        Ok(Self::config_dir(app)?.join(Self::GID_FILE_NAME))
    }
    pub fn load_orders(app: &AppHandle) -> Vec<Order> {
        let Ok(path) = Self::orders_file_path(app) else {
            return Vec::new();
        };
        if !path.exists() {
            return Vec::new();
        }
        fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_else(Vec::new)
    }
    pub fn load_next_id(app: &AppHandle) -> i64 {
        let Ok(path) = Self::id_file_path(app) else {
            return 1000;
        };
        fs::read_to_string(&path)
            .ok()
            .and_then(|raw| raw.trim().parse::<i64>().ok())
            .unwrap_or(1000)
    }
    pub fn load_next_group_id(app: &AppHandle) -> i64 {
        let Ok(path) = Self::gid_file_path(app) else {
            return 1;
        };
        fs::read_to_string(&path)
            .ok()
            .and_then(|raw| raw.trim().parse::<i64>().ok())
            .unwrap_or(1)
    }
    pub fn persist(app: &AppHandle, orders: &[Order], next_id: i64, next_group_id: i64) -> Result<(), String> {
        let orders_path = Self::orders_file_path(app)?;
        let id_path = Self::id_file_path(app)?;
        let gid_path = Self::gid_file_path(app)?;
        let orders_json = serde_json::to_string(orders).map_err(|e| e.to_string())?;
        fs::write(&orders_path, orders_json).map_err(|e| e.to_string())?;
        fs::write(&id_path, next_id.to_string()).map_err(|e| e.to_string())?;
        fs::write(&gid_path, next_group_id.to_string()).map_err(|e| e.to_string())?;
        Ok(())
    }
}
