pub mod config;
pub mod domain;
pub mod service;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::State;
use tokio::net::TcpListener;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

use config::pricing_matrix::PRICING_MATRIX;
use domain::order::price_calculator::{CartItem, ServiceItem, ServiceItemType as PriceCalculatorItemType};
use service::order_api_service::Order;
use service::order_service::OrderService;

type Tx = mpsc::UnboundedSender<Message>;
type PeerMap = Arc<Mutex<HashMap<std::net::SocketAddr, Tx>>>;

pub struct AppState {
    pub order_service: Arc<OrderService>,
    pub peers: PeerMap,
}

/// Messages a WS client can send to the server. Today only the Counter view
/// sends these — it has no local order state of its own, so creating an
/// order means asking the Cashier (the WS host) to create it and broadcast
/// the result back out to everyone, including the Counter that asked.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMessage {
    CreateOrder { cart: Vec<CartItem> },
}

/// Messages the WS server pushes to every connected peer (Counter and
/// Cashier views alike). `Orders` is always the full current snapshot
/// rather than a diff — simplest thing that can't drift out of sync.
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ServerMessage {
    Orders { data: Vec<Order> },
    Time { data: String },
}

async fn broadcast(peers: &PeerMap, msg: &ServerMessage) {
    let json = match serde_json::to_string(msg) {
        Ok(j) => j,
        Err(_) => return,
    };
    let guard = peers.lock().await;
    for (_, tx) in guard.iter() {
        let _ = tx.send(Message::Text(json.clone().into()));
    }
}

#[tauri::command]
fn get_pricing_matrix() -> Vec<ServiceItem> {
    PRICING_MATRIX
        .iter()
        .map(|item| ServiceItem {
            id: item.id.to_string(),
            item_type: match item.item_type {
                config::pricing_matrix::ServiceItemType::Service => PriceCalculatorItemType::Service,
                config::pricing_matrix::ServiceItemType::Product => PriceCalculatorItemType::Product,
            },
            category: item.category.to_string(),
            label: item.label.to_string(),
            price: item.price,
        })
        .collect()
}

// NOTE: get_orders / get_pending_orders / get_paid_orders are kept as plain
// Tauri commands purely as a convenience for local debugging/tests. The
// Cashier and Counter views themselves no longer poll these — they derive
// their state entirely from the "orders" WS broadcast (see counter.ts /
// cashier.ts), which is pushed immediately on connect and after every
// mutation, so there's a single source of truth instead of two.
#[tauri::command]
fn get_orders(state: State<'_, AppState>) -> Vec<Order> {
    state.order_service.get_orders()
}

#[tauri::command]
fn get_pending_orders(state: State<'_, AppState>) -> Vec<Order> {
    state.order_service.get_pending()
}

#[tauri::command]
fn get_paid_orders(state: State<'_, AppState>) -> Vec<Order> {
    state.order_service.get_paid()
}

/// Still invoked locally by the Cashier UI when it's on the same machine as
/// the WS host (or by anyone testing without a second device). After
/// mutating state it broadcasts the fresh snapshot to every connected peer,
/// including whichever Angular instance just called this command.
#[tauri::command]
async fn create_order(state: State<'_, AppState>, cart: Vec<CartItem>) -> Result<(), String> {
    state.order_service.create_order(&cart);
    broadcast(
        &state.peers,
        &ServerMessage::Orders { data: state.order_service.get_orders() },
    )
    .await;
    Ok(())
}

/// Cashier-only action: mark a group as paid, then broadcast the updated
/// snapshot so every connected Counter sees the status flip in real time.
#[tauri::command]
async fn mark_group_as_paid(state: State<'_, AppState>, group_id: i64) -> Result<(), String> {
    state.order_service.mark_group_as_paid(group_id);
    broadcast(
        &state.peers,
        &ServerMessage::Orders { data: state.order_service.get_orders() },
    )
    .await;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let order_service = Arc::new(OrderService::new());
    let peers: PeerMap = Arc::new(Mutex::new(HashMap::new()));

    // ── WebSocket server ─────────────────────────────────────────────────
    // Binding 0.0.0.0 (rather than 127.0.0.1) is what makes this reachable
    // from other machines on the LAN — this is the "Cashier" side of the
    // connection. A Counter running on another PC points its WebsocketService
    // at ws://<cashier-lan-ip>:8080. If Cashier and Counter run on the same
    // machine, ws://127.0.0.1:8080 works too.
    let ws_order_service = order_service.clone();
    let ws_peers = peers.clone();
    tauri::async_runtime::spawn(async move {
        let listener = TcpListener::bind("0.0.0.0:8080")
            .await
            .expect("failed to bind WebSocket server to 0.0.0.0:8080");
        println!("WebSocket server running on ws://0.0.0.0:8080");

        while let Ok((stream, addr)) = listener.accept().await {
            let peers_inner = ws_peers.clone();
            let order_service_inner = ws_order_service.clone();

            tauri::async_runtime::spawn(async move {
                let ws_stream = match accept_async(stream).await {
                    Ok(s) => s,
                    Err(_) => return,
                };
                let (mut ws_sender, mut ws_receiver) = ws_stream.split();

                let (tx, mut rx) = mpsc::unbounded_channel();
                peers_inner.lock().await.insert(addr, tx);

                // Give the newly connected peer an immediate snapshot so its
                // view isn't blank while it waits for the next mutation.
                if let Ok(json) = serde_json::to_string(&ServerMessage::Orders {
                    data: order_service_inner.get_orders(),
                }) {
                    let _ = ws_sender.send(Message::Text(json.into())).await;
                }

                let ws_writer = tauri::async_runtime::spawn(async move {
                    while let Some(message) = rx.recv().await {
                        if ws_sender.send(message).await.is_err() {
                            break;
                        }
                    }
                });

                while let Some(Ok(message)) = ws_receiver.next().await {
                    if let Message::Text(text) = message {
                        if let Ok(ClientMessage::CreateOrder { cart }) =
                            serde_json::from_str::<ClientMessage>(&text)
                        {
                            order_service_inner.create_order(&cart);
                            broadcast(
                                &peers_inner,
                                &ServerMessage::Orders { data: order_service_inner.get_orders() },
                            )
                            .await;
                        }
                    }
                }

                peers_inner.lock().await.remove(&addr);
                ws_writer.abort();
            });
        }
    });

    // ── 1Hz shared clock tick ────────────────────────────────────────────
    // Broadcasting time from the Cashier means every connected Counter
    // shows the exact same clock as the till, instead of each device's own
    // (possibly drifted) local time.
    let time_peers = peers.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            let current_time = chrono::Local::now().format("%H:%M:%S").to_string();
            broadcast(&time_peers, &ServerMessage::Time { data: current_time }).await;
        }
    });

    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .manage(AppState { order_service, peers })
        .invoke_handler(tauri::generate_handler![
            get_pricing_matrix,
            get_orders,
            get_pending_orders,
            get_paid_orders,
            create_order,
            mark_group_as_paid
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}