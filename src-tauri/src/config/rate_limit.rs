use std::collections::HashMap;
use std::sync::{Arc, Mutex as SyncMutex};
const MAX_ATTEMPTS: u32 = 5;
const BASE_LOCKOUT_SECS: i64 = 5;
const MAX_LOCKOUT_SECS: i64 = 300;
#[derive(Debug, Clone, Default)]
pub(crate) struct AttemptRecord {
    failures: u32,
    locked_until: Option<i64>,
}
pub(crate) type AttemptTracker = Arc<SyncMutex<HashMap<String, AttemptRecord>>>;
pub(crate) fn new_tracker() -> AttemptTracker {
    Arc::new(SyncMutex::new(HashMap::new()))
}
pub(crate) fn seconds_until_unlocked(tracker: &AttemptTracker, key: &str) -> Option<i64> {
    let now = chrono::Local::now().timestamp();
    let guard = tracker.lock().unwrap();
    guard.get(key).and_then(|record| {
        record
            .locked_until
            .filter(|&until| until > now)
            .map(|until| until - now)
    })
}
pub(crate) fn record_failure(tracker: &AttemptTracker, key: &str) {
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
pub(crate) fn record_success(tracker: &AttemptTracker, key: &str) {
    let mut guard = tracker.lock().unwrap();
    guard.remove(key);
}
