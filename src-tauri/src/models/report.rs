use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Report {
    pub id: i64,
    pub cashier_username: String,
    pub created_at: String,
    pub payload: serde_json::Value,
}
