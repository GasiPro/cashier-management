use std::sync::atomic::{AtomicI64, Ordering};

use serde::{Deserialize, Deserializer, Serialize};

pub const MAX_HISTORY_ENTRIES: usize = 200;

static NEXT_BLACKLIST_ID: AtomicI64 = AtomicI64::new(1);

pub fn next_blacklist_id() -> i64 {
    NEXT_BLACKLIST_ID.fetch_add(1, Ordering::Relaxed)
}

fn bump_blacklist_id_floor(id: i64) {
    NEXT_BLACKLIST_ID.fetch_max(id + 1, Ordering::Relaxed);
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
