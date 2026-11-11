use crate::config::connection_config::MAX_HISTORY_ENTRIES;
use crate::models::connection::{
    ip_from_addr, BlacklistEntry, BlacklistType, ConnectionEvent, ConnectionHistoryEntry,
};

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

fn major_version(user_agent: &str, token: &str) -> String {
    user_agent
        .split_once(token)
        .map(|(_, rest)| rest.chars().take_while(char::is_ascii_digit).collect::<String>())
        .unwrap_or_default()
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
