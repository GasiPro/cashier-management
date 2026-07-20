use futures_util::{SinkExt, StreamExt};
use tauri::State;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

type Tx = mpsc::UnboundedSender<Message>;
type PeerMap = Arc<Mutex<HashMap<std::net::SocketAddr, Tx>>>;

struct AppState {
    peers: PeerMap,
}

#[tauri::command]
async fn broadcast_message(state: State<'_, AppState>, msg: String) -> Result<(), String> {
    let peers = state.peers.lock().await;
    for (_, tx) in peers.iter() {
        let _ = tx.send(Message::Text(msg.clone().into()));
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let peers: PeerMap = Arc::new(Mutex::new(HashMap::new()));
    let peers_clone = peers.clone();

    // FIX: Using Tauri's native async runtime manager instead of direct tokio::spawn
    tauri::async_runtime::spawn(async move {
        let listener = TcpListener::bind("127.0.0.1:8080").await.unwrap();
        println!("WebSocket server running on ws://127.0.0.1:8080");

        while let Ok((stream, addr)) = listener.accept().await {
            let peers_inner = peers_clone.clone();
            tauri::async_runtime::spawn(async move {
                let ws_stream = accept_async(stream)
                    .await
                    .expect("Failed to accept WS connection");
                let (mut ws_sender, mut ws_receiver) = ws_stream.split();

                let (tx, mut rx) = mpsc::unbounded_channel();
                peers_inner.lock().await.insert(addr, tx);

                let ws_writer = tauri::async_runtime::spawn(async move {
                    while let Some(message) = rx.recv().await {
                        if ws_sender.send(message).await.is_err() {
                            break;
                        }
                    }
                });

                while let Some(Ok(_)) = ws_receiver.next().await {}

                peers_inner.lock().await.remove(&addr);
                ws_writer.abort();
            });
        }
    });

    // FIX: Using Tauri's native async runtime manager here as well
    let peers_time_clone = peers.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            let current_time = chrono::Local::now().format("%H:%M:%S").to_string();
            let payload = serde_json::json!({ "type": "time", "data": current_time }).to_string();

            let peers = peers_time_clone.lock().await;
            for (_, tx) in peers.iter() {
                let _ = tx.send(Message::Text(payload.clone().into()));
            }
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
        .manage(AppState { peers })
        .invoke_handler(tauri::generate_handler![broadcast_message])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
