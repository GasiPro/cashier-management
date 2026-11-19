use crate::infrastructure::websocket::PeerMap;
use crate::models::connection::ServerMessage;
const MAX_NOTICE_LINES: usize = 20;
const MAX_NOTICE_LINE_LEN: usize = 160;
fn clean(lines: Vec<String>) -> Vec<String> {
    lines
        .into_iter()
        .map(|line| line.trim().chars().take(MAX_NOTICE_LINE_LEN).collect::<String>())
        .filter(|line| !line.is_empty())
        .take(MAX_NOTICE_LINES)
        .collect()
}
pub async fn publish(peers: &PeerMap, counter: Vec<String>, cashier: Vec<String>) {
    let counter = clean(counter);
    let cashier = clean(cashier);
    if counter.is_empty() && cashier.is_empty() {
        return;
    }
    let guard = peers.lock().await;
    for peer in guard.values() {
        let lines = if peer.is_cashier {
            &cashier
        } else if peer.approved && !peer.is_admin {
            &counter
        } else {
            continue;
        };
        if !lines.is_empty() {
            peer.send(&ServerMessage::Notice {
                data: lines.clone(),
            });
        }
    }
}
