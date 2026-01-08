//! Persistence for Paired Devices
//!
//! Handles saving and loading paired devices to/from disk.
//! File location: {app_config_dir}/paired_devices.json

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::RwLock;

const PAIRED_DEVICES_FILE: &str = "paired_devices.json";
const CONFIG_VERSION: u32 = 1;

// ============================================================================
// Types
// ============================================================================

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PairedDeviceStatus {
    Active,
    Revoked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairedDevice {
    pub id: String,
    pub name: String,
    pub token: String,
    pub paired_at: String,
    pub last_sync_at: Option<String>,
    pub status: PairedDeviceStatus,
}

#[derive(Debug, Serialize, Deserialize)]
struct PairedDevicesConfig {
    version: u32,
    devices: Vec<PairedDevice>,
}

impl Default for PairedDevicesConfig {
    fn default() -> Self {
        Self {
            version: CONFIG_VERSION,
            devices: Vec::new(),
        }
    }
}

#[derive(Debug)]
pub enum PersistenceError {
    NoConfigDir,
    Io(std::io::Error),
    Json(serde_json::Error),
}

impl std::fmt::Display for PersistenceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PersistenceError::NoConfigDir => write!(f, "Could not find config directory"),
            PersistenceError::Io(e) => write!(f, "IO error: {}", e),
            PersistenceError::Json(e) => write!(f, "JSON error: {}", e),
        }
    }
}

impl From<std::io::Error> for PersistenceError {
    fn from(e: std::io::Error) -> Self {
        PersistenceError::Io(e)
    }
}

impl From<serde_json::Error> for PersistenceError {
    fn from(e: serde_json::Error) -> Self {
        PersistenceError::Json(e)
    }
}

// ============================================================================
// PersistenceManager
// ============================================================================

pub struct PersistenceManager {
    config_dir: PathBuf,
    cache: RwLock<Option<Vec<PairedDevice>>>,
}

impl PersistenceManager {
    /// Create a new persistence manager with the given config directory
    pub fn new(config_dir: PathBuf) -> Result<Arc<Self>, PersistenceError> {
        // Ensure directory exists
        std::fs::create_dir_all(&config_dir)?;

        Ok(Arc::new(Self {
            config_dir,
            cache: RwLock::new(None),
        }))
    }

    /// Create from Tauri app handle
    pub fn from_app_handle(app: &tauri::AppHandle) -> Result<Arc<Self>, PersistenceError> {
        let config_dir = app
            .path()
            .app_config_dir()
            .map_err(|_| PersistenceError::NoConfigDir)?;

        Self::new(config_dir)
    }

    /// Get the file path for paired devices
    fn file_path(&self) -> PathBuf {
        self.config_dir.join(PAIRED_DEVICES_FILE)
    }

    /// Load paired devices from disk
    pub async fn load(&self) -> Result<Vec<PairedDevice>, PersistenceError> {
        // Check cache first
        {
            let cache = self.cache.read().await;
            if let Some(devices) = cache.as_ref() {
                return Ok(devices.clone());
            }
        }

        // Load from disk
        let devices = self.load_from_disk().await?;

        // Update cache
        {
            let mut cache = self.cache.write().await;
            *cache = Some(devices.clone());
        }

        Ok(devices)
    }

    /// Load directly from disk (bypasses cache)
    async fn load_from_disk(&self) -> Result<Vec<PairedDevice>, PersistenceError> {
        let path = self.file_path();

        if !path.exists() {
            return Ok(Vec::new());
        }

        let content = tokio::fs::read_to_string(&path).await?;
        let config: PairedDevicesConfig = serde_json::from_str(&content)?;

        Ok(config.devices)
    }

    /// Save paired devices to disk
    async fn save(&self, devices: &[PairedDevice]) -> Result<(), PersistenceError> {
        let config = PairedDevicesConfig {
            version: CONFIG_VERSION,
            devices: devices.to_vec(),
        };

        let content = serde_json::to_string_pretty(&config)?;
        let path = self.file_path();

        // Atomic write: write to temp file, then rename
        let temp_path = path.with_extension("tmp");
        tokio::fs::write(&temp_path, content).await?;
        tokio::fs::rename(&temp_path, &path).await?;

        // Update cache
        {
            let mut cache = self.cache.write().await;
            *cache = Some(devices.to_vec());
        }

        Ok(())
    }

    /// Add or update a paired device
    pub async fn add_device(&self, device: PairedDevice) -> Result<(), PersistenceError> {
        let mut devices = self.load().await?;

        // Remove existing device with same ID (update scenario)
        devices.retain(|d| d.id != device.id);
        devices.push(device);

        self.save(&devices).await
    }

    /// Revoke a paired device (soft delete)
    pub async fn revoke_device(&self, device_id: &str) -> Result<bool, PersistenceError> {
        let mut devices = self.load().await?;

        let mut found = false;
        for device in devices.iter_mut() {
            if device.id == device_id && device.status != PairedDeviceStatus::Revoked {
                device.status = PairedDeviceStatus::Revoked;
                found = true;
                break;
            }
        }

        if found {
            self.save(&devices).await?;
        }

        Ok(found)
    }

    /// Remove a paired device completely
    pub async fn remove_device(&self, device_id: &str) -> Result<bool, PersistenceError> {
        let mut devices = self.load().await?;
        let original_len = devices.len();
        devices.retain(|d| d.id != device_id);

        if devices.len() != original_len {
            self.save(&devices).await?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Get active (non-revoked) devices
    pub async fn get_active_devices(&self) -> Result<Vec<PairedDevice>, PersistenceError> {
        let devices = self.load().await?;
        Ok(devices
            .into_iter()
            .filter(|d| d.status == PairedDeviceStatus::Active)
            .collect())
    }

    /// Get a device by ID
    pub async fn get_device(&self, device_id: &str) -> Result<Option<PairedDevice>, PersistenceError> {
        let devices = self.load().await?;
        Ok(devices.into_iter().find(|d| d.id == device_id))
    }

    /// Validate a token for a device
    pub async fn validate_token(&self, device_id: &str, token: &str) -> Result<bool, PersistenceError> {
        let device = self.get_device(device_id).await?;
        Ok(device
            .map(|d| d.status == PairedDeviceStatus::Active && d.token == token)
            .unwrap_or(false))
    }

    /// Update last sync time for a device
    pub async fn update_last_sync(&self, device_id: &str) -> Result<bool, PersistenceError> {
        let mut devices = self.load().await?;

        let mut found = false;
        for device in devices.iter_mut() {
            if device.id == device_id {
                device.last_sync_at = Some(chrono::Utc::now().to_rfc3339());
                found = true;
                break;
            }
        }

        if found {
            self.save(&devices).await?;
        }

        Ok(found)
    }

    /// Clear cache (useful for testing or forced reload)
    pub async fn clear_cache(&self) {
        let mut cache = self.cache.write().await;
        *cache = None;
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    async fn create_test_manager() -> Arc<PersistenceManager> {
        let dir = tempdir().unwrap();
        PersistenceManager::new(dir.into_path()).unwrap()
    }

    fn create_test_device(id: &str) -> PairedDevice {
        PairedDevice {
            id: id.to_string(),
            name: format!("Device {}", id),
            token: format!("token-{}", id),
            paired_at: chrono::Utc::now().to_rfc3339(),
            last_sync_at: None,
            status: PairedDeviceStatus::Active,
        }
    }

    #[tokio::test]
    async fn test_empty_load() {
        let manager = create_test_manager().await;
        let devices = manager.load().await.unwrap();
        assert!(devices.is_empty());
    }

    #[tokio::test]
    async fn test_add_and_load() {
        let manager = create_test_manager().await;

        let device = create_test_device("test-1");
        manager.add_device(device.clone()).await.unwrap();

        let devices = manager.load().await.unwrap();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].id, "test-1");
        assert_eq!(devices[0].name, "Device test-1");
    }

    #[tokio::test]
    async fn test_update_device() {
        let manager = create_test_manager().await;

        let mut device = create_test_device("test-1");
        manager.add_device(device.clone()).await.unwrap();

        device.name = "Updated Name".to_string();
        manager.add_device(device).await.unwrap();

        let devices = manager.load().await.unwrap();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].name, "Updated Name");
    }

    #[tokio::test]
    async fn test_revoke_device() {
        let manager = create_test_manager().await;

        let device = create_test_device("test-1");
        manager.add_device(device).await.unwrap();

        let revoked = manager.revoke_device("test-1").await.unwrap();
        assert!(revoked);

        let devices = manager.load().await.unwrap();
        assert_eq!(devices[0].status, PairedDeviceStatus::Revoked);

        let active = manager.get_active_devices().await.unwrap();
        assert!(active.is_empty());
    }

    #[tokio::test]
    async fn test_remove_device() {
        let manager = create_test_manager().await;

        let device = create_test_device("test-1");
        manager.add_device(device).await.unwrap();

        let removed = manager.remove_device("test-1").await.unwrap();
        assert!(removed);

        let devices = manager.load().await.unwrap();
        assert!(devices.is_empty());
    }

    #[tokio::test]
    async fn test_validate_token() {
        let manager = create_test_manager().await;

        let device = create_test_device("test-1");
        manager.add_device(device).await.unwrap();

        assert!(manager.validate_token("test-1", "token-test-1").await.unwrap());
        assert!(!manager.validate_token("test-1", "wrong-token").await.unwrap());
        assert!(!manager.validate_token("wrong-id", "token-test-1").await.unwrap());
    }
}
