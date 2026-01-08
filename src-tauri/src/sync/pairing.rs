//! Device Pairing
//!
//! Handles device pairing with QR code and 6-digit code methods.
//! Security features:
//! - CSPRNG for code generation with uniform distribution
//! - SHA-256 hashing (code never stored in plaintext)
//! - Rate limiting (max 5 attempts, 30s cooldown after 3 failures)
//! - Time-limited sessions (2 minutes)
//! - Single-use codes

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{DateTime, Duration, Utc};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

// ============================================================================
// Constants
// ============================================================================

const CODE_EXPIRY_SECONDS: i64 = 120; // 2 minutes
const MAX_ATTEMPTS: u8 = 5;
const COOLDOWN_THRESHOLD: u8 = 3; // Cooldown kicks in after this many attempts
const COOLDOWN_SECONDS: i64 = 30;
const CLEANUP_INTERVAL_SECONDS: u64 = 30;

// ============================================================================
// Types
// ============================================================================

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PairingStatus {
    Pending,
    Verified,
    Expired,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PairingMethod {
    #[serde(rename = "qr")]
    QR,
    Code,
}

/// Internal pairing session (stored in memory)
#[derive(Debug, Clone)]
pub struct PairingSession {
    pub id: String,
    pub code_hash: [u8; 32],
    pub nonce: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub attempts: u8,
    pub last_attempt_at: Option<DateTime<Utc>>,
    pub status: PairingStatus,
    pub paired_device_id: Option<String>,
    pub paired_device_name: Option<String>,
}

/// Response for POST /pair/start
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairStartResponse {
    pub pairing_id: String,
    pub code: String,
    pub expires_at: String,
    pub host_candidates: Vec<String>,
    pub port: u16,
    pub qr_payload: String,
}

/// Request for POST /pair/confirm
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairConfirmRequest {
    pub pairing_id: Option<String>,  // Optional for code-based pairing
    pub method: PairingMethod,
    pub code: Option<String>,
    pub nonce: Option<String>,
    pub device_name: String,
    pub device_id: String,
}

/// Response for POST /pair/confirm
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairConfirmResponse {
    pub desktop_device_id: String,
    pub session_token: String,
    pub shared_secret: Option<String>,
}

/// Legacy response format (used internally and for Tauri commands)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairConfirmResponseInternal {
    pub paired_device_id: String,
    pub desktop_device_id: String,
    pub token: String,
    pub desktop_name: String,
}

/// Response for GET /pair/status
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairStatusResponse {
    pub pairing_id: String,
    pub status: PairingStatus,
    pub remaining_seconds: u64,
    pub attempts_remaining: u8,
}

/// Simple error response for HTTP API (matches contract)
#[derive(Debug, Clone, Serialize)]
pub struct PairingErrorSimple {
    pub error: String,  // "expired", "wrong_code", "invalid_pairing_id", "rate_limited"
}

/// Error types for pairing operations (internal use)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingError {
    pub error: String,
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after: Option<u64>,
}

impl PairingError {
    pub fn not_found() -> Self {
        Self {
            error: "Pairing session not found".to_string(),
            code: "NOT_FOUND".to_string(),
            retry_after: None,
        }
    }

    pub fn expired() -> Self {
        Self {
            error: "Pairing session has expired".to_string(),
            code: "EXPIRED".to_string(),
            retry_after: None,
        }
    }

    pub fn invalid_code() -> Self {
        Self {
            error: "Invalid pairing code".to_string(),
            code: "INVALID_CODE".to_string(),
            retry_after: None,
        }
    }

    pub fn invalid_nonce() -> Self {
        Self {
            error: "Invalid QR nonce".to_string(),
            code: "INVALID_NONCE".to_string(),
            retry_after: None,
        }
    }

    pub fn too_many_attempts() -> Self {
        Self {
            error: "Too many failed attempts".to_string(),
            code: "TOO_MANY_ATTEMPTS".to_string(),
            retry_after: None,
        }
    }

    pub fn rate_limited(retry_after: u64) -> Self {
        Self {
            error: format!("Rate limited. Try again in {} seconds", retry_after),
            code: "RATE_LIMITED".to_string(),
            retry_after: Some(retry_after),
        }
    }

    pub fn already_paired() -> Self {
        Self {
            error: "Session already paired".to_string(),
            code: "ALREADY_PAIRED".to_string(),
            retry_after: None,
        }
    }

    pub fn missing_code() -> Self {
        Self {
            error: "Code is required for code-based pairing".to_string(),
            code: "MISSING_CODE".to_string(),
            retry_after: None,
        }
    }

    pub fn missing_nonce() -> Self {
        Self {
            error: "Nonce is required for QR-based pairing".to_string(),
            code: "MISSING_NONCE".to_string(),
            retry_after: None,
        }
    }
}

// ============================================================================
// PairingManager
// ============================================================================

pub struct PairingManager {
    sessions: RwLock<HashMap<String, PairingSession>>,
    device_id: String,
    device_name: String,
}

impl PairingManager {
    pub fn new(device_id: String, device_name: String) -> Arc<Self> {
        let manager = Arc::new(Self {
            sessions: RwLock::new(HashMap::new()),
            device_id,
            device_name,
        });

        // Spawn cleanup task
        let manager_clone = Arc::clone(&manager);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(CLEANUP_INTERVAL_SECONDS))
                    .await;
                manager_clone.cleanup_expired().await;
            }
        });

        manager
    }

    /// Create a new pairing session
    pub async fn create_session(
        &self,
        host_candidates: Vec<String>,
        port: u16,
    ) -> PairStartResponse {
        let mut sessions = self.sessions.write().await;

        // Cancel any existing pending sessions (only one active at a time)
        sessions.retain(|_, s| s.status != PairingStatus::Pending);

        // Generate session data
        let pairing_id = uuid::Uuid::new_v4().to_string();
        let code = Self::generate_code();
        let code_hash = Self::hash_code(&code);
        let nonce = Self::generate_nonce();
        let now = Utc::now();
        let expires_at = now + Duration::seconds(CODE_EXPIRY_SECONDS);

        // Build QR payload
        let qr_payload = Self::build_qr_payload(
            &pairing_id,
            &host_candidates,
            port,
            &nonce,
            expires_at.timestamp(),
        );

        // Store session
        let session = PairingSession {
            id: pairing_id.clone(),
            code_hash,
            nonce: nonce.clone(),
            created_at: now,
            expires_at,
            attempts: 0,
            last_attempt_at: None,
            status: PairingStatus::Pending,
            paired_device_id: None,
            paired_device_name: None,
        };
        sessions.insert(pairing_id.clone(), session);

        PairStartResponse {
            pairing_id,
            code,
            expires_at: expires_at.to_rfc3339(),
            host_candidates,
            port,
            qr_payload,
        }
    }

    /// Find a session by its code (for code-only pairing)
    pub async fn find_session_by_code(&self, code: &str) -> Option<String> {
        let sessions = self.sessions.read().await;
        let code_hash = Self::hash_code(code);
        for (id, session) in sessions.iter() {
            if session.status == PairingStatus::Pending
                && Self::constant_time_eq(&session.code_hash, &code_hash)
            {
                return Some(id.clone());
            }
        }
        None
    }

    /// Verify a pairing attempt
    pub async fn verify(
        &self,
        request: &PairConfirmRequest,
    ) -> Result<PairConfirmResponseInternal, PairingError> {
        // Determine pairing_id based on method
        let pairing_id = match &request.method {
            PairingMethod::Code => {
                if let Some(id) = &request.pairing_id {
                    id.clone()
                } else {
                    // Look up session by code
                    let code = request.code.as_ref().ok_or_else(PairingError::missing_code)?;
                    self.find_session_by_code(code)
                        .await
                        .ok_or_else(PairingError::invalid_code)?
                }
            }
            PairingMethod::QR => {
                request
                    .pairing_id
                    .clone()
                    .ok_or_else(PairingError::not_found)?
            }
        };

        let mut sessions = self.sessions.write().await;

        let session = sessions
            .get_mut(&pairing_id)
            .ok_or_else(PairingError::not_found)?;

        // Check if already paired
        if session.status == PairingStatus::Verified {
            return Err(PairingError::already_paired());
        }

        // Check expiry
        if Utc::now() > session.expires_at {
            session.status = PairingStatus::Expired;
            return Err(PairingError::expired());
        }

        // Check rate limit
        self.check_rate_limit(session)?;

        // Record attempt
        session.attempts += 1;
        session.last_attempt_at = Some(Utc::now());

        // Verify based on method
        let verified = match request.method {
            PairingMethod::Code => {
                let code = request.code.as_ref().ok_or_else(PairingError::missing_code)?;
                Self::verify_code(&session.code_hash, code)
            }
            PairingMethod::QR => {
                let nonce = request
                    .nonce
                    .as_ref()
                    .ok_or_else(PairingError::missing_nonce)?;
                Self::verify_nonce(&session.nonce, nonce)
            }
        };

        if !verified {
            if session.attempts >= MAX_ATTEMPTS {
                session.status = PairingStatus::Failed;
                return Err(PairingError::too_many_attempts());
            }
            return Err(match request.method {
                PairingMethod::Code => PairingError::invalid_code(),
                PairingMethod::QR => PairingError::invalid_nonce(),
            });
        }

        // Success! Mark as verified
        session.status = PairingStatus::Verified;
        session.paired_device_id = Some(request.device_id.clone());
        session.paired_device_name = Some(request.device_name.clone());

        // Generate token for future sync
        let token = Self::generate_token();

        Ok(PairConfirmResponseInternal {
            paired_device_id: request.device_id.clone(),
            desktop_device_id: self.device_id.clone(),
            token,
            desktop_name: self.device_name.clone(),
        })
    }

    /// Verify and return HTTP API response format
    pub async fn verify_http(
        &self,
        request: &PairConfirmRequest,
    ) -> Result<PairConfirmResponse, PairingErrorSimple> {
        match self.verify(request).await {
            Ok(internal) => Ok(PairConfirmResponse {
                desktop_device_id: internal.desktop_device_id,
                session_token: internal.token,
                shared_secret: None,
            }),
            Err(e) => {
                // Map internal error codes to simple error strings
                let error = match e.code.as_str() {
                    "EXPIRED" => "expired",
                    "INVALID_CODE" => "wrong_code",
                    "NOT_FOUND" => "invalid_pairing_id",
                    "INVALID_NONCE" => "wrong_code",
                    "RATE_LIMITED" => "rate_limited",
                    "TOO_MANY_ATTEMPTS" => "rate_limited",
                    _ => "invalid_pairing_id",
                };
                Err(PairingErrorSimple {
                    error: error.to_string(),
                })
            }
        }
    }

    /// Get session status
    pub async fn get_status(&self, pairing_id: &str) -> Result<PairStatusResponse, PairingError> {
        let sessions = self.sessions.read().await;

        let session = sessions
            .get(pairing_id)
            .ok_or_else(PairingError::not_found)?;

        let now = Utc::now();
        let remaining = if now > session.expires_at {
            0
        } else {
            (session.expires_at - now).num_seconds().max(0) as u64
        };

        let status = if remaining == 0 && session.status == PairingStatus::Pending {
            PairingStatus::Expired
        } else {
            session.status.clone()
        };

        Ok(PairStatusResponse {
            pairing_id: session.id.clone(),
            status,
            remaining_seconds: remaining,
            attempts_remaining: MAX_ATTEMPTS.saturating_sub(session.attempts),
        })
    }

    /// Cancel a pairing session
    pub async fn cancel(&self, pairing_id: &str) {
        let mut sessions = self.sessions.write().await;
        sessions.remove(pairing_id);
    }

    /// Get paired device info from a successful session
    pub async fn get_paired_device(
        &self,
        pairing_id: &str,
    ) -> Option<(String, String)> {
        let sessions = self.sessions.read().await;
        sessions.get(pairing_id).and_then(|s| {
            if s.status == PairingStatus::Verified {
                Some((
                    s.paired_device_id.clone().unwrap_or_default(),
                    s.paired_device_name.clone().unwrap_or_default(),
                ))
            } else {
                None
            }
        })
    }

    /// Cleanup expired sessions
    async fn cleanup_expired(&self) {
        let mut sessions = self.sessions.write().await;
        let now = Utc::now();
        sessions.retain(|_, s| {
            // Keep verified sessions for 5 minutes after pairing (for status checks)
            // Remove expired/failed sessions immediately
            match s.status {
                PairingStatus::Verified => {
                    now < s.expires_at + Duration::minutes(5)
                }
                PairingStatus::Pending => now < s.expires_at,
                _ => false, // Remove expired/failed
            }
        });
    }

    // ========================================================================
    // Private helpers
    // ========================================================================

    /// Generate a cryptographically secure 6-digit code (000000-999999)
    fn generate_code() -> String {
        let mut rng = rand::thread_rng();
        let code: u32 = rng.gen_range(0..1_000_000);
        format!("{:06}", code)
    }

    /// Generate a random nonce for QR payload
    fn generate_nonce() -> String {
        let mut rng = rand::thread_rng();
        let bytes: [u8; 16] = rng.gen();
        URL_SAFE_NO_PAD.encode(bytes)
    }

    /// Generate a session token
    fn generate_token() -> String {
        let mut rng = rand::thread_rng();
        let bytes: [u8; 32] = rng.gen();
        URL_SAFE_NO_PAD.encode(bytes)
    }

    /// Hash a code using SHA-256
    fn hash_code(code: &str) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(code.as_bytes());
        hasher.finalize().into()
    }

    /// Verify code with constant-time comparison
    fn verify_code(stored_hash: &[u8; 32], provided_code: &str) -> bool {
        let provided_hash = Self::hash_code(provided_code);
        Self::constant_time_eq(stored_hash, &provided_hash)
    }

    /// Verify nonce with constant-time comparison
    fn verify_nonce(stored_nonce: &str, provided_nonce: &str) -> bool {
        let a = stored_nonce.as_bytes();
        let b = provided_nonce.as_bytes();
        if a.len() != b.len() {
            return false;
        }
        Self::constant_time_eq(a, b)
    }

    /// Constant-time byte comparison to prevent timing attacks
    fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
        if a.len() != b.len() {
            return false;
        }
        let mut diff = 0u8;
        for (x, y) in a.iter().zip(b.iter()) {
            diff |= x ^ y;
        }
        diff == 0
    }

    /// Build QR payload URL
    fn build_qr_payload(
        pairing_id: &str,
        hosts: &[String],
        port: u16,
        nonce: &str,
        exp: i64,
    ) -> String {
        let hosts_param = hosts.join(",");
        format!(
            "mini-crm://pair?v=1&hosts={}&port={}&pairingId={}&nonce={}&exp={}",
            urlencoding::encode(&hosts_param),
            port,
            urlencoding::encode(pairing_id),
            urlencoding::encode(nonce),
            exp
        )
    }

    /// Check rate limiting
    fn check_rate_limit(&self, session: &PairingSession) -> Result<(), PairingError> {
        // Check max attempts
        if session.attempts >= MAX_ATTEMPTS {
            return Err(PairingError::too_many_attempts());
        }

        // Check cooldown after threshold
        if session.attempts >= COOLDOWN_THRESHOLD {
            if let Some(last_attempt) = session.last_attempt_at {
                let elapsed = Utc::now().signed_duration_since(last_attempt);
                if elapsed.num_seconds() < COOLDOWN_SECONDS {
                    let retry_after = (COOLDOWN_SECONDS - elapsed.num_seconds()).max(1) as u64;
                    return Err(PairingError::rate_limited(retry_after));
                }
            }
        }

        Ok(())
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_code_generation_format() {
        for _ in 0..100 {
            let code = PairingManager::generate_code();
            assert_eq!(code.len(), 6, "Code should be 6 digits");
            assert!(
                code.chars().all(|c| c.is_ascii_digit()),
                "Code should only contain digits"
            );
        }
    }

    #[test]
    fn test_code_generation_allows_leading_zeros() {
        // Run many iterations to increase chance of getting leading zeros
        let mut has_leading_zero = false;
        for _ in 0..10000 {
            let code = PairingManager::generate_code();
            if code.starts_with('0') {
                has_leading_zero = true;
                break;
            }
        }
        assert!(has_leading_zero, "Should allow leading zeros");
    }

    #[test]
    fn test_code_hashing_and_verification() {
        let code = "123456";
        let hash = PairingManager::hash_code(code);

        assert!(PairingManager::verify_code(&hash, "123456"));
        assert!(!PairingManager::verify_code(&hash, "654321"));
        assert!(!PairingManager::verify_code(&hash, "12345"));
        assert!(!PairingManager::verify_code(&hash, "1234567"));
    }

    #[test]
    fn test_nonce_generation() {
        let nonce1 = PairingManager::generate_nonce();
        let nonce2 = PairingManager::generate_nonce();

        assert!(!nonce1.is_empty());
        assert_ne!(nonce1, nonce2, "Nonces should be unique");
    }

    #[test]
    fn test_token_generation() {
        let token1 = PairingManager::generate_token();
        let token2 = PairingManager::generate_token();

        assert!(!token1.is_empty());
        assert_ne!(token1, token2, "Tokens should be unique");
        // Token should be 43 chars (32 bytes base64 URL-safe no padding)
        assert_eq!(token1.len(), 43);
    }

    #[test]
    fn test_qr_payload_format() {
        let payload = PairingManager::build_qr_payload(
            "test-id",
            &["192.168.1.100".to_string(), "10.0.0.5".to_string()],
            8443,
            "test-nonce",
            1704628920,
        );

        assert!(payload.starts_with("mini-crm://pair?v=1"));
        assert!(payload.contains("hosts=192.168.1.100%2C10.0.0.5"));
        assert!(payload.contains("port=8443"));
        assert!(payload.contains("pairingId=test-id"));
        assert!(payload.contains("nonce=test-nonce"));
        assert!(payload.contains("exp=1704628920"));
    }
}
