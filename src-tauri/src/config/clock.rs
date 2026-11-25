use chrono::{DateTime, Duration, FixedOffset, Local, Utc};
use std::sync::RwLock;
struct ClockConfig {
    offset_secs: i64,
    utc_offset_secs: Option<i32>,
}
static CLOCK: RwLock<ClockConfig> = RwLock::new(ClockConfig {
    offset_secs: 0,
    utc_offset_secs: None,
});
pub fn configure(auto: bool, offset_secs: i64, utc_offset_secs: i32) {
    let mut guard = CLOCK.write().unwrap_or_else(|e| e.into_inner());
    guard.offset_secs = if auto { 0 } else { offset_secs };
    guard.utc_offset_secs = if auto { None } else { Some(utc_offset_secs) };
}
pub fn now_utc() -> DateTime<Utc> {
    let guard = CLOCK.read().unwrap_or_else(|e| e.into_inner());
    Utc::now() + Duration::seconds(guard.offset_secs)
}
pub fn now_local() -> DateTime<FixedOffset> {
    let zone = CLOCK
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .utc_offset_secs
        .and_then(FixedOffset::east_opt);
    let utc = now_utc();
    match zone {
        Some(zone) => utc.with_timezone(&zone),
        None => {
            let local = utc.with_timezone(&Local);
            local.with_timezone(local.offset())
        }
    }
}
