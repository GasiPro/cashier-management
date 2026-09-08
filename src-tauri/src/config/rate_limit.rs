use std::collections::HashMap;
use std::sync::{Arc, Mutex as SyncMutex};

/// Number of consecutive failures allowed before a key starts being locked out.
const MAX_ATTEMPTS: u32 = 5;
/// Lockout duration applied on the first lockout, in seconds.
const BASE_LOCKOUT_SECS: i64 = 5;
/// Upper bound on the lockout duration, no matter how many failures pile up.
const MAX_LOCKOUT_SECS: i64 = 300;

#[derive(Debug, Clone, Default)]
struct AttemptRecord {
    failures: u32,
    locked_until: Option<i64>,
}

/// Shared, in-memory (never persisted to disk) tracker of consecutive
/// authentication failures, keyed by whatever the caller considers the
/// identity of an attempt (a username, a socket address, etc.).
pub type AttemptTracker = Arc<SyncMutex<HashMap<String, AttemptRecord>>>;

pub fn new_tracker() -> AttemptTracker {
    Arc::new(SyncMutex::new(HashMap::new()))
}

/// If `key` is currently locked out, returns how many seconds remain before
/// another attempt should be allowed. Returns `None` if it isn't locked out.
pub fn seconds_until_unlocked(tracker: &AttemptTracker, key: &str) -> Option<i64> {
    let now = chrono::Local::now().timestamp();
    let guard = tracker.lock().unwrap();
    guard.get(key).and_then(|record| {
        record
            .locked_until
            .filter(|&until| until > now)
            .map(|until| until - now)
    })
}

/// Records a failed attempt for `key`. Once `MAX_ATTEMPTS` consecutive
/// failures have accumulated, `key` is locked out for an increasing backoff
/// period (doubling each additional failure, capped at `MAX_LOCKOUT_SECS`).
pub fn record_failure(tracker: &AttemptTracker, key: &str) {
    let now = chrono::Local::now().timestamp();
    let mut guard = tracker.lock().unwrap();
    let record = guard.entry(key.to_string()).or_default();
    record.failures += 1;
    if record.failures >= MAX_ATTEMPTS {
        let extra = (record.failures - MAX_ATTEMPTS).min(6);
        let lockout = (BASE_LOCKOUT_SECS * (1i64 << extra)).min(MAX_LOCKOUT_SECS);
        record.locked_until = Some(now + lockout);
    }
}

/// Clears any recorded failures for `key`, e.g. after a successful attempt.
pub fn record_success(tracker: &AttemptTracker, key: &str) {
    let mut guard = tracker.lock().unwrap();
    guard.remove(key);
}
