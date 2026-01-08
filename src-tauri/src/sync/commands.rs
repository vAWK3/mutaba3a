//! Tauri Commands for Sync
//!
//! IPC commands exposed to the frontend for sync operations.

use super::crypto::{decrypt, encrypt, EncryptedBundle};
use super::discovery::{discover_peers, DiscoveredPeer, MdnsAdvertiser};
use super::pairing::{PairStartResponse, PairStatusResponse};
use super::persistence::{PairedDevice, PersistenceManager};
use super::server::SyncServer;
use serde::Serialize;
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};
use tokio::sync::Mutex as TokioMutex;

/// Shared queue for pending sync operations (received from mobile)
pub type PendingOpsQueue = Arc<TokioMutex<VecDeque<serde_json::Value>>>;

/// Shared storage for local operations (created on desktop, to be synced to mobile)
pub type LocalOpsStore = Arc<TokioMutex<Vec<serde_json::Value>>>;

/// Managed state for sync operations
pub struct SyncState {
    pub server: Mutex<Option<SyncServer>>,
    pub advertiser: Mutex<Option<MdnsAdvertiser>>,
    pub config_dir: Mutex<Option<PathBuf>>,
    /// Shared queue of pending operations received from mobile
    pub pending_ops: PendingOpsQueue,
    /// Local operations created on desktop (for sync to mobile)
    pub local_ops: LocalOpsStore,
}

impl Default for SyncState {
    fn default() -> Self {
        Self {
            server: Mutex::new(None),
            advertiser: Mutex::new(None),
            config_dir: Mutex::new(None),
            pending_ops: Arc::new(TokioMutex::new(VecDeque::new())),
            local_ops: Arc::new(TokioMutex::new(Vec::new())),
        }
    }
}

#[derive(Serialize)]
pub struct ServerStartResult {
    pub port: u16,
    pub expires_at: Option<String>,
}

/// Start the sync server
#[tauri::command]
pub async fn start_sync_server(
    app: tauri::AppHandle,
    state: State<'_, SyncState>,
    device_id: String,
    device_name: String,
    port: Option<u16>,
    auto_shutdown_minutes: Option<u64>,
) -> Result<ServerStartResult, String> {
    // Get config directory
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|_| "Failed to get config directory".to_string())?;

    // Store config dir for later use
    {
        let mut config_guard = state.config_dir.lock().map_err(|e| e.to_string())?;
        *config_guard = Some(config_dir.clone());
    }

    // Stop existing server if any
    {
        let mut server_guard = state.server.lock().map_err(|e| e.to_string())?;
        if let Some(mut server) = server_guard.take() {
            server.stop();
        }
    }

    // Get the shared queues
    let pending_ops = Arc::clone(&state.pending_ops);
    let local_ops = Arc::clone(&state.local_ops);

    // Start new server
    let (server, actual_port) = SyncServer::start(
        port.unwrap_or(0),
        device_id.clone(),
        device_name.clone(),
        auto_shutdown_minutes.unwrap_or(30),
        config_dir,
        Some(app.clone()),
        pending_ops,
        local_ops,
    )
    .await?;

    // Store server
    {
        let mut server_guard = state.server.lock().map_err(|e| e.to_string())?;
        *server_guard = Some(server);
    }

    // Start mDNS advertising
    {
        let mut adv_guard = state.advertiser.lock().map_err(|e| e.to_string())?;
        if let Some(adv) = adv_guard.take() {
            let _ = adv.stop();
        }

        let advertiser = MdnsAdvertiser::new(&device_id, &device_name, actual_port, "")?;
        *adv_guard = Some(advertiser);
    }

    // Calculate expiry time
    let expires_at = auto_shutdown_minutes.map(|mins| {
        let expiry = chrono::Utc::now() + chrono::Duration::minutes(mins as i64);
        expiry.to_rfc3339()
    });

    Ok(ServerStartResult {
        port: actual_port,
        expires_at,
    })
}

/// Stop the sync server
#[tauri::command]
pub async fn stop_sync_server(state: State<'_, SyncState>) -> Result<(), String> {
    // Stop server
    {
        let mut server_guard = state.server.lock().map_err(|e| e.to_string())?;
        if let Some(mut server) = server_guard.take() {
            server.stop();
        }
    }

    // Stop advertising
    {
        let mut adv_guard = state.advertiser.lock().map_err(|e| e.to_string())?;
        if let Some(adv) = adv_guard.take() {
            let _ = adv.stop();
        }
    }

    Ok(())
}

/// Check if the sync server is running
#[tauri::command]
pub async fn is_sync_server_running(state: State<'_, SyncState>) -> Result<bool, String> {
    let server_guard = state.server.lock().map_err(|e| e.to_string())?;
    Ok(server_guard.is_some())
}

/// Get the sync server port
#[tauri::command]
pub async fn get_sync_server_port(state: State<'_, SyncState>) -> Result<Option<u16>, String> {
    let server_guard = state.server.lock().map_err(|e| e.to_string())?;
    Ok(server_guard.as_ref().map(|s| s.port()))
}

/// Discover peers on the local network
#[tauri::command]
pub async fn discover_lan_peers(timeout_secs: Option<u64>) -> Result<Vec<DiscoveredPeer>, String> {
    discover_peers(timeout_secs.unwrap_or(5)).await
}

/// Encrypt a sync bundle with a passphrase
#[tauri::command]
pub fn encrypt_bundle(data: Vec<u8>, passphrase: String) -> Result<String, String> {
    let encrypted = encrypt(&data, &passphrase).map_err(|e| e.to_string())?;
    serde_json::to_string(&encrypted).map_err(|e| e.to_string())
}

/// Decrypt a sync bundle with a passphrase
#[tauri::command]
pub fn decrypt_bundle(encrypted_json: String, passphrase: String) -> Result<Vec<u8>, String> {
    let bundle: EncryptedBundle =
        serde_json::from_str(&encrypted_json).map_err(|e| e.to_string())?;
    decrypt(&bundle, &passphrase).map_err(|e| e.to_string())
}

/// Get the device hostname
#[tauri::command]
pub fn get_hostname() -> Result<String, String> {
    hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

// ============================================================================
// Pairing Commands
// ============================================================================

/// Start a new pairing session
/// Returns the pairing info (code, QR payload, etc.) for display
#[tauri::command]
pub async fn start_pairing_session(
    state: State<'_, SyncState>,
) -> Result<PairStartResponse, String> {
    // Extract what we need from the lock, then drop it before async
    let (pairing_manager, port) = {
        let server_guard = state.server.lock().map_err(|e| e.to_string())?;
        let server = server_guard
            .as_ref()
            .ok_or("Sync server not running. Start the server first.")?;
        (Arc::clone(&server.pairing_manager), server.port())
    };

    // Get local IPs
    let mut host_candidates = Vec::new();
    if let Ok(ip) = local_ip_address::local_ip() {
        host_candidates.push(ip.to_string());
    }
    if let Ok(list) = local_ip_address::list_afinet_netifas() {
        for (_, ip) in list {
            let ip_str = ip.to_string();
            if !ip_str.starts_with("127.") && !ip_str.contains(':') && !host_candidates.contains(&ip_str) {
                host_candidates.push(ip_str);
            }
        }
    }
    if host_candidates.is_empty() {
        host_candidates.push("127.0.0.1".to_string());
    }

    // Create pairing session (lock is dropped, safe to await)
    let response = pairing_manager
        .create_session(host_candidates, port)
        .await;

    Ok(response)
}

/// Get the status of a pairing session
#[tauri::command]
pub async fn get_pairing_status(
    state: State<'_, SyncState>,
    pairing_id: String,
) -> Result<PairStatusResponse, String> {
    // Extract pairing_manager from the lock, then drop it
    let pairing_manager = {
        let server_guard = state.server.lock().map_err(|e| e.to_string())?;
        let server = server_guard
            .as_ref()
            .ok_or("Sync server not running")?;
        Arc::clone(&server.pairing_manager)
    };

    pairing_manager
        .get_status(&pairing_id)
        .await
        .map_err(|e| e.error)
}

/// Cancel a pairing session
#[tauri::command]
pub async fn cancel_pairing_session(
    state: State<'_, SyncState>,
    pairing_id: String,
) -> Result<(), String> {
    // Extract pairing_manager if server exists
    let pairing_manager = {
        let server_guard = state.server.lock().map_err(|e| e.to_string())?;
        server_guard.as_ref().map(|s| Arc::clone(&s.pairing_manager))
    };

    if let Some(pm) = pairing_manager {
        pm.cancel(&pairing_id).await;
    }
    Ok(())
}

/// Get list of paired devices
#[tauri::command]
pub async fn get_paired_devices(
    app: tauri::AppHandle,
) -> Result<Vec<PairedDevice>, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|_| "Failed to get config directory".to_string())?;

    let persistence = PersistenceManager::new(config_dir)
        .map_err(|e| format!("Failed to initialize persistence: {}", e))?;

    persistence
        .get_active_devices()
        .await
        .map_err(|e| format!("Failed to load devices: {}", e))
}

/// Revoke a paired device
#[tauri::command]
pub async fn revoke_paired_device(
    app: tauri::AppHandle,
    device_id: String,
) -> Result<bool, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|_| "Failed to get config directory".to_string())?;

    let persistence = PersistenceManager::new(config_dir)
        .map_err(|e| format!("Failed to initialize persistence: {}", e))?;

    persistence
        .revoke_device(&device_id)
        .await
        .map_err(|e| format!("Failed to revoke device: {}", e))
}

/// Fetch pending operations received from mobile
/// Frontend should call this after receiving sync:ops_received event
#[tauri::command]
pub async fn get_pending_sync_ops(
    state: State<'_, SyncState>,
) -> Result<Vec<serde_json::Value>, String> {
    let pending = state.pending_ops.lock().await;
    let ops: Vec<serde_json::Value> = pending.iter().cloned().collect();
    log::info!("get_pending_sync_ops: returning {} operations", ops.len());
    Ok(ops)
}

/// Clear pending operations (called after frontend applies them)
#[tauri::command]
pub async fn clear_pending_sync_ops(
    state: State<'_, SyncState>,
) -> Result<usize, String> {
    let mut pending = state.pending_ops.lock().await;
    let count = pending.len();
    pending.clear();
    log::info!("clear_pending_sync_ops: cleared {} operations", count);
    Ok(count)
}

/// Store a local operation for sync to mobile
/// Frontend should call this when creating new operations
#[tauri::command]
pub async fn store_local_sync_op(
    state: State<'_, SyncState>,
    op: serde_json::Value,
) -> Result<(), String> {
    let mut local_ops = state.local_ops.lock().await;
    log::info!("store_local_sync_op: storing operation {:?}", op.get("id"));
    local_ops.push(op);
    log::info!("store_local_sync_op: total local ops = {}", local_ops.len());
    Ok(())
}

/// Get count of local operations available for sync
#[tauri::command]
pub async fn get_local_sync_ops_count(
    state: State<'_, SyncState>,
) -> Result<usize, String> {
    let local_ops = state.local_ops.lock().await;
    Ok(local_ops.len())
}

// Add chrono dependency for timestamp handling
mod chrono {
    pub use ::chrono::*;
}
