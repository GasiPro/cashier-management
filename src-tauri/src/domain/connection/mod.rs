use crate::config::connection_config::MAX_HISTORY_ENTRIES;
use crate::models::connection::{
    ip_from_addr, BlacklistEntry, BlacklistType, ConnectionEvent, ConnectionHistoryEntry,
    MachineInfo,
};
use std::net::IpAddr;
use uuid::Uuid;
const UNKNOWN_MACHINE: &str = "Appareil inconnu";
const MAX_MACHINE_NAME_CHARS: usize = 100;
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
    entries
        .iter()
        .any(|e| e.entry_type == BlacklistType::Username && e.value.eq_ignore_ascii_case(username))
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
pub fn is_today(timestamp: &str) -> bool {
    timestamp.starts_with(&chrono::Local::now().format("%Y-%m-%d").to_string())
}
fn is_open(entry: &ConnectionHistoryEntry) -> bool {
    matches!(
        entry.status,
        ConnectionEvent::Requested | ConnectionEvent::Approved
    )
}
pub fn start_session(entries: &mut Vec<ConnectionHistoryEntry>, entry: ConnectionHistoryEntry) {
    entries.retain(|e| is_today(&e.started_at));
    entries.push(entry);
    if entries.len() > MAX_HISTORY_ENTRIES {
        let overflow = entries.len() - MAX_HISTORY_ENTRIES;
        entries.drain(0..overflow);
    }
}
pub fn update_session(
    entries: &mut [ConnectionHistoryEntry],
    addr: &str,
    event: ConnectionEvent,
    at: &str,
) {
    let Some(entry) = entries
        .iter_mut()
        .rev()
        .find(|e| is_open(e) && e.addr == addr)
    else {
        return;
    };
    match event {
        ConnectionEvent::Approved => entry.connected_at = Some(at.to_string()),
        _ => {
            if entry.connected_at.is_some() {
                entry.disconnected_at = Some(at.to_string());
            }
        }
    }
    entry.status = event;
}
pub fn close_stale_sessions(entries: &mut Vec<ConnectionHistoryEntry>) {
    entries.retain(|e| is_today(&e.started_at));
    for entry in entries.iter_mut().filter(|e| is_open(e)) {
        entry.status = ConnectionEvent::Disconnected;
    }
}
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let escaped = if bytes[i] == b'%' {
            value
                .get(i + 1..i + 3)
                .and_then(|hex| u8::from_str_radix(hex, 16).ok())
        } else {
            None
        };
        match escaped {
            Some(byte) => {
                decoded.push(byte);
                i += 3;
            }
            None => {
                decoded.push(bytes[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&decoded).into_owned()
}
fn query_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let (name, value) = pair.split_once('=')?;
        (name == key).then(|| percent_decode(value))
    })
}
pub fn parse_machine(query: &str, ip: IpAddr) -> MachineInfo {
    let name = query_param(query, "machine")
        .map(|value| {
            value
                .trim()
                .chars()
                .take(MAX_MACHINE_NAME_CHARS)
                .collect::<String>()
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| UNKNOWN_MACHINE.to_string());
    let id = query_param(query, "machine_id")
        .and_then(|value| Uuid::parse_str(value.trim()).ok())
        .unwrap_or_else(|| Uuid::new_v5(&Uuid::NAMESPACE_OID, ip.to_string().as_bytes()));
    MachineInfo { name, id }
}
pub fn device_id(machine: &MachineInfo, username: &str) -> Uuid {
    Uuid::new_v5(&machine.id, username.trim().to_lowercase().as_bytes())
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
