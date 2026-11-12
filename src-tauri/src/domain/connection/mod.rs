use crate::config::connection_config::{MAX_HISTORY_ENTRIES, SESSION_MAX_HOURS};
use crate::models::connection::{
    ip_from_addr, BlacklistEntry, BlacklistType, ConnectionEvent, ConnectionHistoryEntry,
};
use uuid::Uuid;
const UNKNOWN_MACHINE: &str = "Appareil inconnu";
const OS_NAMES: [(&str, &str); 10] = [
    ("Windows NT 10.0", "Windows 10/11"),
    ("Windows NT 6.3", "Windows 8.1"),
    ("Windows NT 6.1", "Windows 7"),
    ("Windows", "Windows"),
    ("Android", "Android"),
    ("iPhone", "iPhone"),
    ("iPad", "iPad"),
    ("Macintosh", "macOS"),
    ("CrOS", "ChromeOS"),
    ("Linux", "Linux"),
];
const BROWSER_NAMES: [(&str, &str); 7] = [
    ("Edg/", "Edge"),
    ("OPR/", "Opera"),
    ("Firefox/", "Firefox"),
    ("FxiOS/", "Firefox"),
    ("Chrome/", "Chrome"),
    ("CriOS/", "Chrome"),
    ("Version/", "Safari"),
];
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
fn end_superseded_sessions(entries: &mut [ConnectionHistoryEntry], current: usize, at: &str) {
    let username = entries[current].username.clone();
    let user_type = entries[current].user_type;
    let ip = ip_from_addr(&entries[current].addr).to_string();
    for (index, old) in entries.iter_mut().enumerate() {
        if index != current
            && old.status == ConnectionEvent::Approved
            && !old.online
            && old.username == username
            && old.user_type == user_type
            && ip_from_addr(&old.addr) == ip
        {
            old.status = ConnectionEvent::Disconnected;
            old.disconnected_at = Some(at.to_string());
        }
    }
}
pub fn start_session(entries: &mut Vec<ConnectionHistoryEntry>, entry: ConnectionHistoryEntry) {
    entries.retain(|e| is_today(&e.started_at));
    let approved = entry.status == ConnectionEvent::Approved;
    let at = entry.started_at.clone();
    entries.push(entry);
    if approved {
        let current = entries.len() - 1;
        end_superseded_sessions(entries, current, &at);
    }
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
    let Some(index) = entries
        .iter()
        .rposition(|e| is_open(e) && e.addr == addr)
    else {
        return;
    };
    match event {
        ConnectionEvent::Approved => {
            entries[index].connected_at = Some(at.to_string());
            entries[index].online = true;
            end_superseded_sessions(entries, index, at);
        }
        _ => {
            let entry = &mut entries[index];
            if entry.connected_at.is_some() {
                entry.disconnected_at = Some(at.to_string());
            }
            entry.online = false;
        }
    }
    entries[index].status = event;
}
pub fn mark_offline(entries: &mut [ConnectionHistoryEntry], addr: &str) {
    if let Some(entry) = entries
        .iter_mut()
        .rev()
        .find(|e| e.status == ConnectionEvent::Approved && e.addr == addr)
    {
        entry.online = false;
    }
}
pub fn expire_sessions(entries: &mut [ConnectionHistoryEntry]) {
    let now = chrono::Local::now();
    for entry in entries
        .iter_mut()
        .filter(|e| e.status == ConnectionEvent::Approved && !e.online)
    {
        let Some(expires_at) = entry
            .connected_at
            .as_deref()
            .and_then(|at| chrono::DateTime::parse_from_rfc3339(at).ok())
            .map(|at| at + chrono::Duration::hours(SESSION_MAX_HOURS))
            .filter(|expires_at| *expires_at <= now)
        else {
            continue;
        };
        entry.status = ConnectionEvent::Disconnected;
        entry.disconnected_at = Some(expires_at.to_rfc3339());
        entry.auto_disconnected = true;
    }
}
pub fn close_stale_sessions(entries: &mut Vec<ConnectionHistoryEntry>) {
    entries.retain(|e| is_today(&e.started_at));
    let now = chrono::Local::now().to_rfc3339();
    for entry in entries.iter_mut().filter(|e| is_open(e)) {
        if entry.connected_at.is_some() {
            entry.disconnected_at = Some(now.clone());
        }
        entry.status = ConnectionEvent::Disconnected;
        entry.online = false;
    }
}
fn major_version(user_agent: &str, token: &str) -> String {
    user_agent
        .split_once(token)
        .map(|(_, rest)| rest.chars().take_while(char::is_ascii_digit).collect::<String>())
        .unwrap_or_default()
}
const MAX_IDENTITY_LEN: usize = 120;
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if let Some(byte) = value
                .get(i + 1..i + 3)
                .and_then(|hex| u8::from_str_radix(hex, 16).ok())
            {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
pub fn machine_identity(query: &str) -> (Option<String>, String) {
    let mut name = None;
    let mut device_id = String::new();
    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else {
            continue;
        };
        let decoded = percent_decode(value);
        let value: String = decoded.trim().chars().take(MAX_IDENTITY_LEN).collect();
        match key {
            "machine" if !value.is_empty() => name = Some(value),
            "machine_id" => device_id = value,
            _ => {}
        }
    }
    (name, device_id)
}
pub fn describe_machine(user_agent: &str) -> String {
    let os = OS_NAMES
        .iter()
        .find(|&&(token, _)| user_agent.contains(token))
        .map(|&(_, name)| name);
    let browser = BROWSER_NAMES
        .iter()
        .find(|&&(token, _)| user_agent.contains(token))
        .map(|&(token, name)| match major_version(user_agent, token).as_str() {
            "" => name.to_string(),
            version => format!("{name} {version}"),
        });
    match (os, browser) {
        (Some(os), Some(browser)) => format!("{os} · {browser}"),
        (Some(os), None) => os.to_string(),
        (None, Some(browser)) => browser,
        (None, None) => UNKNOWN_MACHINE.to_string(),
    }
}
pub fn session_uuid(entry: &ConnectionHistoryEntry) -> String {
    let device = if entry.device_id.is_empty() {
        format!("{}|{}", ip_from_addr(&entry.addr), entry.machine)
    } else {
        entry.device_id.clone()
    };
    let key = format!("{device}|{}", entry.username.trim().to_lowercase());
    Uuid::new_v5(&Uuid::NAMESPACE_OID, key.as_bytes()).to_string()
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
