//! Sync Server
//!
//! HTTP server for LAN sync operations.

use super::pairing::{
    PairConfirmRequest, PairConfirmResponse, PairStartResponse, PairStatusResponse, PairingError,
    PairingErrorSimple, PairingManager,
};
use super::persistence::{PairedDevice, PairedDeviceStatus, PersistenceManager};
use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Mutex, RwLock};

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_PORT: u16 = 4242;
const MAX_PORT_ATTEMPTS: u16 = 10;

/// Shared queue for pending sync operations (shared with Tauri state)
pub type PendingOpsQueue = Arc<Mutex<VecDeque<serde_json::Value>>>;

/// Shared storage for local operations (created on desktop, to be synced to mobile)
pub type LocalOpsStore = Arc<Mutex<Vec<serde_json::Value>>>;

/// Server state shared between handlers
pub struct ServerState {
    pub device_id: String,
    pub device_name: String,
    pub port: u16,
    pub last_activity: RwLock<Instant>,
    pub pairing_manager: Arc<PairingManager>,
    pub persistence: Arc<PersistenceManager>,
    /// Shared queue of pending operations received from mobile
    pub pending_ops: PendingOpsQueue,
    /// Tauri app handle for emitting events
    pub app_handle: Option<AppHandle>,
    /// Local operations created on desktop (for pull by mobile)
    pub local_ops: LocalOpsStore,
}

impl ServerState {
    pub fn new(
        device_id: String,
        device_name: String,
        port: u16,
        persistence: Arc<PersistenceManager>,
        app_handle: Option<AppHandle>,
        pending_ops: PendingOpsQueue,
        local_ops: LocalOpsStore,
    ) -> Self {
        let pairing_manager = PairingManager::new(device_id.clone(), device_name.clone());
        Self {
            device_id,
            device_name,
            port,
            last_activity: RwLock::new(Instant::now()),
            pairing_manager,
            persistence,
            pending_ops,
            app_handle,
            local_ops,
        }
    }

    pub async fn touch(&self) {
        let mut last = self.last_activity.write().await;
        *last = Instant::now();
    }

    pub async fn elapsed(&self) -> Duration {
        let last = self.last_activity.read().await;
        last.elapsed()
    }
}

/// Sync server handle
pub struct SyncServer {
    port: u16,
    shutdown_tx: Option<oneshot::Sender<()>>,
    pub pairing_manager: Arc<PairingManager>,
    pub persistence: Arc<PersistenceManager>,
}

impl SyncServer {
    /// Start the sync server on the specified port (default 4242 with fallback)
    pub async fn start(
        port: u16,
        device_id: String,
        device_name: String,
        auto_shutdown_minutes: u64,
        config_dir: PathBuf,
        app_handle: Option<AppHandle>,
        pending_ops: PendingOpsQueue,
        local_ops: LocalOpsStore,
    ) -> Result<(Self, u16), String> {
        // Initialize persistence
        let persistence =
            PersistenceManager::new(config_dir).map_err(|e| format!("Persistence error: {}", e))?;

        // Determine starting port (use default 4242 if 0 is passed)
        let start_port = if port == 0 { DEFAULT_PORT } else { port };

        // Try to bind with fallback to next ports
        let listener = bind_with_fallback(start_port).await?;
        let actual_port = listener.local_addr().map_err(|e| e.to_string())?.port();

        // Now create state with the actual port
        let state = Arc::new(ServerState::new(
            device_id,
            device_name,
            actual_port,
            Arc::clone(&persistence),
            app_handle,
            pending_ops,
            local_ops,
        ));
        let state_clone = state.clone();
        let pairing_manager = Arc::clone(&state.pairing_manager);

        let app = Router::new()
            // Health check (both legacy and v1)
            .route("/health", get(handle_health))
            .route("/v1/sync/hello", get(handle_hello))
            // Sync routes (v1)
            .route("/v1/sync/status", get(handle_status))
            .route("/v1/sync/pull", post(handle_pull))
            .route("/v1/sync/push", post(handle_push))
            // Pairing routes (v1)
            .route("/v1/pair/start", post(handle_pair_start))
            .route("/v1/pair/confirm", post(handle_pair_confirm))
            .route("/v1/pair/status", get(handle_pair_status))
            // Legacy routes (deprecated, keeping for backwards compatibility)
            .route("/sync/status", get(handle_status))
            .route("/sync/pull", post(handle_pull))
            .route("/sync/push", post(handle_push))
            .route("/pair/start", post(handle_pair_start))
            .route("/pair/confirm", post(handle_pair_confirm))
            .route("/pair/status", get(handle_pair_status))
            .with_state(state);

        // Create shutdown channel
        let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();

        // Spawn plain HTTP server
        tokio::spawn(async move {
            let server = axum::serve(listener, app);

            tokio::select! {
                result = server => {
                    if let Err(e) = result {
                        log::error!("Sync server error: {}", e);
                    }
                }
                _ = &mut shutdown_rx => {
                    log::info!("Sync server shutting down");
                }
            }
        });

        // Spawn auto-shutdown task
        if auto_shutdown_minutes > 0 {
            tokio::spawn(async move {
                let timeout = Duration::from_secs(auto_shutdown_minutes * 60);
                loop {
                    tokio::time::sleep(Duration::from_secs(60)).await;
                    if state_clone.elapsed().await > timeout {
                        log::info!("Sync server auto-shutdown due to inactivity");
                        break;
                    }
                }
            });
        }

        Ok((
            Self {
                port: actual_port,
                shutdown_tx: Some(shutdown_tx),
                pairing_manager,
                persistence,
            },
            actual_port,
        ))
    }

    /// Get the port the server is running on
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Stop the server
    pub fn stop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}

impl Drop for SyncServer {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Try to bind to a port, falling back to subsequent ports if occupied
async fn bind_with_fallback(start_port: u16) -> Result<TcpListener, String> {
    for offset in 0..MAX_PORT_ATTEMPTS {
        let port = start_port.saturating_add(offset);
        let addr = SocketAddr::from(([0, 0, 0, 0], port));
        match TcpListener::bind(addr).await {
            Ok(listener) => {
                if offset > 0 {
                    log::info!(
                        "Port {} was in use, bound to port {} instead",
                        start_port,
                        port
                    );
                }
                return Ok(listener);
            }
            Err(e) if offset < MAX_PORT_ATTEMPTS - 1 => {
                log::debug!("Port {} in use, trying next: {}", port, e);
                continue;
            }
            Err(e) => {
                return Err(format!(
                    "Failed to bind to any port ({}-{}): {}",
                    start_port,
                    start_port.saturating_add(MAX_PORT_ATTEMPTS - 1),
                    e
                ));
            }
        }
    }
    unreachable!()
}

// ============================================================================
// Request/Response Types
// ============================================================================

#[derive(Serialize)]
struct StatusResponse {
    device_id: String,
    device_name: String,
    server_version: &'static str,
    capabilities: Vec<&'static str>,
}

#[derive(Debug, Deserialize)]
struct PullRequest {
    device_id: String,
    since_hlc: String,
    since_seq: Option<i64>,
    max_ops: Option<usize>,
}

#[derive(Serialize)]
struct PullResponse {
    operations: Vec<serde_json::Value>,
    has_more: bool,
    next_hlc: Option<String>,
    next_seq: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct PushRequest {
    device_id: String,
    ops: Vec<serde_json::Value>,
}

#[derive(Serialize)]
struct PushResponse {
    accepted: usize,
    rejected: Vec<RejectedOp>,
    server_hlc: String,
}

#[derive(Serialize)]
struct RejectedOp {
    op_id: String,
    reason: String,
}

#[derive(Deserialize)]
struct PairInitiateRequest {
    device_id: String,
    device_name: String,
    public_key: String,
}

#[derive(Serialize)]
struct PairInitiateResponse {
    challenge: String,
    server_public_key: String,
    verification_code: String,
}

#[derive(Deserialize)]
struct PairVerifyRequest {
    device_id: String,
    challenge_response: String,
}

#[derive(Serialize)]
struct PairVerifyResponse {
    success: bool,
    message: String,
}

// ============================================================================
// Handlers
// ============================================================================

/// GET /health - Simple health check
async fn handle_health() -> &'static str {
    "OK"
}

/// GET /v1/sync/hello - Connection check for mobile
async fn handle_hello(State(state): State<Arc<ServerState>>) -> Json<HelloResponse> {
    state.touch().await;
    Json(HelloResponse {
        status: "ok".to_string(),
        device_id: state.device_id.clone(),
        device_name: state.device_name.clone(),
        version: "1.0.0".to_string(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HelloResponse {
    status: String,
    device_id: String,
    device_name: String,
    version: String,
}

async fn handle_status(State(state): State<Arc<ServerState>>) -> Json<StatusResponse> {
    state.touch().await;

    Json(StatusResponse {
        device_id: state.device_id.clone(),
        device_name: state.device_name.clone(),
        server_version: "1.0.0",
        capabilities: vec!["pull", "push", "pairing"],
    })
}

async fn handle_pull(
    State(state): State<Arc<ServerState>>,
    Json(request): Json<PullRequest>,
) -> Json<PullResponse> {
    state.touch().await;

    log::info!("=== PULL REQUEST ===");
    log::info!("From device: {}", request.device_id);
    log::info!("Since HLC: {}", request.since_hlc);
    log::info!("Since seq: {:?}", request.since_seq);
    log::info!("Max ops: {:?}", request.max_ops);

    // Get local operations that should be synced to mobile
    let ops = {
        let local_ops = state.local_ops.lock().await;
        let max_ops = request.max_ops.unwrap_or(100);

        // Filter ops with HLC > since_hlc
        local_ops
            .iter()
            .filter(|op| {
                // Extract hlc from operation and compare
                if let Some(hlc) = op.get("hlc").and_then(|v| v.as_str()) {
                    hlc > request.since_hlc.as_str()
                } else {
                    true // Include ops without HLC
                }
            })
            .take(max_ops)
            .cloned()
            .collect::<Vec<_>>()
    };

    let has_more = {
        let local_ops = state.local_ops.lock().await;
        ops.len() < local_ops.len()
    };

    let next_hlc = ops.last().and_then(|op| {
        op.get("hlc").and_then(|v| v.as_str()).map(|s| s.to_string())
    });

    log::info!("Returning {} operations (has_more: {})", ops.len(), has_more);
    if !ops.is_empty() {
        log::info!("First op HLC: {:?}", ops.first().and_then(|op| op.get("hlc")));
        log::info!("Last op HLC: {:?}", ops.last().and_then(|op| op.get("hlc")));
    }
    log::info!("=== END PULL ===");

    Json(PullResponse {
        operations: ops,
        has_more,
        next_hlc,
        next_seq: None,
    })
}

async fn handle_push(
    State(state): State<Arc<ServerState>>,
    Json(request): Json<PushRequest>,
) -> Json<PushResponse> {
    state.touch().await;

    log::info!("=== PUSH REQUEST ===");
    log::info!("From device: {}", request.device_id);
    log::info!("Operations count: {}", request.ops.len());

    // Log each operation in detail
    for (i, op) in request.ops.iter().enumerate() {
        log::info!("--- Operation {} ---", i + 1);
        log::info!("{}", serde_json::to_string_pretty(op).unwrap_or_else(|_| format!("{:?}", op)));
    }

    // Store operations in the pending queue
    let ops_count = request.ops.len();
    {
        let mut pending = state.pending_ops.lock().await;
        for op in request.ops.iter() {
            pending.push_back(op.clone());
        }
        log::info!("Stored {} ops in pending queue (total now: {})", ops_count, pending.len());
    }

    // Emit event to frontend to notify about new ops
    if let Some(ref app) = state.app_handle {
        log::info!("Emitting sync:ops_received event to frontend");
        if let Err(e) = app.emit("sync:ops_received", ops_count) {
            log::error!("Failed to emit event: {}", e);
        }
    } else {
        log::warn!("No app handle available to emit event");
    }

    let response = PushResponse {
        accepted: ops_count,
        rejected: vec![],
        server_hlc: chrono::Utc::now().timestamp_millis().to_string(),
    };

    log::info!("Response: accepted={}, rejected={}", response.accepted, response.rejected.len());
    log::info!("=== END PUSH ===");

    Json(response)
}

async fn handle_pair_initiate(
    State(state): State<Arc<ServerState>>,
    Json(_request): Json<PairInitiateRequest>,
) -> Result<Json<PairInitiateResponse>, StatusCode> {
    state.touch().await;

    // TODO: Implement actual pairing logic
    // For now, return placeholder
    Ok(Json(PairInitiateResponse {
        challenge: uuid::Uuid::new_v4().to_string(),
        server_public_key: String::new(),
        verification_code: format!("{:06}", rand::random::<u32>() % 1000000),
    }))
}

async fn handle_pair_verify(
    State(state): State<Arc<ServerState>>,
    Json(_request): Json<PairVerifyRequest>,
) -> Json<PairVerifyResponse> {
    state.touch().await;

    // TODO: Implement actual verification
    Json(PairVerifyResponse {
        success: false,
        message: "Pairing not yet implemented".to_string(),
    })
}

// ============================================================================
// New Pairing Handlers
// ============================================================================

/// Query params for GET /pair/status
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairStatusQuery {
    pairing_id: String,
}

/// Get local IP addresses for LAN pairing
fn get_local_ips() -> Vec<String> {
    let mut ips = Vec::new();

    // Try to get local IP using the crate
    if let Ok(ip) = local_ip_address::local_ip() {
        ips.push(ip.to_string());
    }

    // Also try to get all local IPs
    if let Ok(list) = local_ip_address::list_afinet_netifas() {
        for (_, ip) in list {
            let ip_str = ip.to_string();
            // Filter for IPv4 addresses, skip loopback
            if !ip_str.starts_with("127.") && !ip_str.contains(':') && !ips.contains(&ip_str) {
                ips.push(ip_str);
            }
        }
    }

    // Fallback if no IPs found
    if ips.is_empty() {
        ips.push("127.0.0.1".to_string());
    }

    ips
}

/// POST /pair/start - Start a new pairing session
async fn handle_pair_start(
    State(state): State<Arc<ServerState>>,
) -> Json<PairStartResponse> {
    state.touch().await;

    let host_candidates = get_local_ips();
    let response = state
        .pairing_manager
        .create_session(host_candidates, state.port)
        .await;

    Json(response)
}

/// POST /pair/confirm - Confirm pairing (from mobile)
async fn handle_pair_confirm(
    State(state): State<Arc<ServerState>>,
    Json(request): Json<PairConfirmRequest>,
) -> Result<Json<PairConfirmResponse>, (StatusCode, Json<PairingErrorSimple>)> {
    state.touch().await;

    // First verify using internal method (to get token for persistence)
    let internal_response = state
        .pairing_manager
        .verify(&request)
        .await
        .map_err(|e| {
            let status = match e.code.as_str() {
                "NOT_FOUND" | "INVALID_CODE" => StatusCode::BAD_REQUEST,
                "EXPIRED" => StatusCode::BAD_REQUEST,
                "RATE_LIMITED" | "TOO_MANY_ATTEMPTS" => StatusCode::TOO_MANY_REQUESTS,
                _ => StatusCode::BAD_REQUEST,
            };
            let error = match e.code.as_str() {
                "EXPIRED" => "expired",
                "INVALID_CODE" | "INVALID_NONCE" => "wrong_code",
                "RATE_LIMITED" | "TOO_MANY_ATTEMPTS" => "rate_limited",
                _ => "invalid_pairing_id",
            };
            (status, Json(PairingErrorSimple { error: error.to_string() }))
        })?;

    // Persist the paired device
    let device = PairedDevice {
        id: request.device_id.clone(),
        name: request.device_name.clone(),
        token: internal_response.token.clone(),
        paired_at: chrono::Utc::now().to_rfc3339(),
        last_sync_at: None,
        status: PairedDeviceStatus::Active,
    };

    if let Err(e) = state.persistence.add_device(device).await {
        log::error!("Failed to persist paired device: {}", e);
        // Don't fail the pairing, just log the error
    }

    // Return HTTP API response format
    Ok(Json(PairConfirmResponse {
        desktop_device_id: internal_response.desktop_device_id,
        session_token: internal_response.token,
        shared_secret: None,
    }))
}

/// GET /pair/status - Get pairing session status
async fn handle_pair_status(
    State(state): State<Arc<ServerState>>,
    Query(params): Query<PairStatusQuery>,
) -> Result<Json<PairStatusResponse>, (StatusCode, Json<PairingError>)> {
    state.touch().await;

    let response = state
        .pairing_manager
        .get_status(&params.pairing_id)
        .await
        .map_err(|e| (StatusCode::NOT_FOUND, Json(e)))?;

    Ok(Json(response))
}
