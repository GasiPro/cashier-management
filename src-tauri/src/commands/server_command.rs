use crate::app::AppState;
use crate::infrastructure::websocket::{
    get_connected_devices_list, get_pending_requests_list, get_server_address,
};
use crate::services::{connection_service, setting_service};
use serde::Deserialize;
use tauri::State;
#[derive(Debug, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case")]
pub enum ServerCommand {
    GetAddress,
    ConnectionApprove {
        id: Option<i64>,
        addr: Option<String>,
    },
    ConnectionReject {
        id: Option<i64>,
        addr: Option<String>,
    },
    ConnectionRefuse {
        id: Option<i64>,
        addr: Option<String>,
    },
    ConnectionListPending,
    ConnectionListConnected,
    ConnectionDisconnect {
        id: Option<i64>,
        addr: Option<String>,
    },
    ConnectionBlock {
        id: Option<i64>,
        addr: Option<String>,
        reason: Option<String>,
    },
    ConnectionHistory,
    ConnectionBlacklistList,
    ConnectionBlacklistAdd {
        entry_type: Option<String>,
        value: Option<String>,
        addr: Option<String>,
        reason: Option<String>,
    },
    ConnectionBlacklistRemove {
        id: Option<i64>,
        addr: Option<String>,
    },
    DevicesMaxGet,
    DevicesMaxSet {
        value: u32,
    },
    DevicesCount,
    DevicesGetHistory,
}
#[tauri::command]
pub async fn server(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    command: ServerCommand,
) -> Result<serde_json::Value, String> {
    match command {
        ServerCommand::GetAddress => Ok(serde_json::json!(get_server_address())),
        ServerCommand::ConnectionApprove { id, addr } => {
            connection_service::approve_connection(
                &app,
                &state.peers,
                &state.max_connected_devices,
                &state.connection_history,
                state.order_service.get_orders(),
                id,
                addr,
            )
            .await?;
            Ok(serde_json::Value::Null)
        }
        ServerCommand::ConnectionReject { id, addr } | ServerCommand::ConnectionRefuse { id, addr } => {
            connection_service::reject_connection(&app, &state.peers, &state.connection_history, id, addr).await?;
            Ok(serde_json::Value::Null)
        }
        ServerCommand::ConnectionListPending => Ok(serde_json::json!(get_pending_requests_list(&state.peers).await)),
        ServerCommand::ConnectionListConnected => {
            Ok(serde_json::json!(get_connected_devices_list(&state.peers).await))
        }
        ServerCommand::ConnectionDisconnect { id, addr } => {
            connection_service::disconnect_device(&app, &state.peers, &state.connection_history, id, addr).await?;
            Ok(serde_json::Value::Null)
        }
        ServerCommand::ConnectionBlock { id, addr, reason } => Ok(serde_json::json!(
            connection_service::block_device(
                &app,
                &state.peers,
                &state.blacklist,
                &state.connection_history,
                id,
                addr,
                reason,
            )
            .await?
        )),
        ServerCommand::ConnectionHistory | ServerCommand::DevicesGetHistory => Ok(serde_json::json!(
            connection_service::list_connection_history(&state.connection_history)
        )),
        ServerCommand::ConnectionBlacklistList => Ok(serde_json::json!(
            connection_service::list_blacklist_entries(&state.blacklist)
        )),
        ServerCommand::ConnectionBlacklistAdd {
            entry_type,
            value,
            addr,
            reason,
        } => Ok(serde_json::json!(
            connection_service::add_blacklist_entry(&app, &state.blacklist, entry_type, value, addr, reason).await?
        )),
        ServerCommand::ConnectionBlacklistRemove { id, addr } => {
            connection_service::remove_blacklist_entry(&app, &state.blacklist, id, addr).await?;
            Ok(serde_json::Value::Null)
        }
        ServerCommand::DevicesMaxGet => Ok(serde_json::json!(setting_service::get_max_connected_devices(
            &state.max_connected_devices
        ))),
        ServerCommand::DevicesMaxSet { value } => Ok(serde_json::json!(
            setting_service::set_max_connected_devices(&app, &state.max_connected_devices, value).await?
        )),
        ServerCommand::DevicesCount => Ok(serde_json::json!(get_connected_devices_list(&state.peers).await.len())),
    }
}
