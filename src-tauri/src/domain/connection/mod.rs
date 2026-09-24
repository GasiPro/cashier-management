use crate::config::connection_config::MAX_HISTORY_ENTRIES;
use crate::models::connection::{ip_from_addr, BlacklistEntry, BlacklistType, ConnectionHistoryEntry};

pub fn port_from_addr(addr: &str) -> u16 {
    addr.rsplit_once(':')
        .and_then(|(_, port)| port.parse().ok())
        .unwrap_or(0)
}

pub fn is_blacklisted(entries: &[BlacklistEntry], addr: &str) -> bool {
    let ip = ip_from_addr(addr);
    entries
        .iter()
        .any(|e| e.entry_type == BlacklistType::Ip && e.value == ip)
}

pub fn is_username_blacklisted(entries: &[BlacklistEntry], username: &str) -> bool {
    let username = username.trim();
    entries.iter().any(|e| {
        e.entry_type == BlacklistType::Username && e.value.eq_ignore_ascii_case(username)
    })
}

pub fn value_exists(entries: &[BlacklistEntry], entry_type: BlacklistType, value: &str) -> bool {
    match entry_type {
        BlacklistType::Ip => is_blacklisted(entries, value),
        BlacklistType::Username => is_username_blacklisted(entries, value),
    }
}

pub fn remove_blacklist_entry(entries: &mut Vec<BlacklistEntry>, addr: &str) -> bool {
    let ip = ip_from_addr(addr);
    let len_before = entries.len();
    entries.retain(|e| !(e.entry_type == BlacklistType::Ip && e.value == ip));
    entries.len() != len_before
}

pub fn remove_blacklist_entry_by_id(entries: &mut Vec<BlacklistEntry>, id: i64) -> bool {
    let len_before = entries.len();
    entries.retain(|e| e.id != id);
    entries.len() != len_before
}

pub fn push_history_entry(entries: &mut Vec<ConnectionHistoryEntry>, entry: ConnectionHistoryEntry) {
    entries.push(entry);
    if entries.len() > MAX_HISTORY_ENTRIES {
        let overflow = entries.len() - MAX_HISTORY_ENTRIES;
        entries.drain(0..overflow);
    }
}

pub fn optional_username(username: &str) -> Option<String> {
    let trimmed = username.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub fn peer_label(username: &str, addr: &str) -> String {
    optional_username(username).unwrap_or_else(|| addr.to_string())
}
