//! mDNS Discovery
//!
//! Provides mDNS service advertisement and discovery for finding sync peers on the local network.

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

const SERVICE_TYPE: &str = "_mutaba3a._tcp.local.";
const SERVICE_NAME_PREFIX: &str = "mutaba3a";

/// A discovered peer on the local network
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredPeer {
    pub device_id: String,
    pub name: String,
    pub device_type: String,
    pub address: String,
    pub port: u16,
    pub public_key_fingerprint: String,
    pub requires_pairing: bool,
}

/// mDNS service advertiser
pub struct MdnsAdvertiser {
    daemon: ServiceDaemon,
    service_fullname: String,
}

impl MdnsAdvertiser {
    /// Create and start advertising the sync service
    pub fn new(
        device_id: &str,
        device_name: &str,
        port: u16,
        public_key_fingerprint: &str,
    ) -> Result<Self, String> {
        let daemon = ServiceDaemon::new().map_err(|e| e.to_string())?;

        // Create service name from device ID (shortened for mDNS)
        let service_name = format!("{}-{}", SERVICE_NAME_PREFIX, &device_id[..8]);

        // Get hostname
        let hostname = hostname::get()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|_| "localhost".to_string());

        // Create service info with properties
        let mut properties = HashMap::new();
        properties.insert("device_id".to_string(), device_id.to_string());
        properties.insert("name".to_string(), device_name.to_string());
        properties.insert("type".to_string(), "desktop".to_string());
        properties.insert("pk_fp".to_string(), public_key_fingerprint.to_string());
        properties.insert("pairing".to_string(), "false".to_string());

        let service = ServiceInfo::new(
            SERVICE_TYPE,
            &service_name,
            &format!("{}.local.", hostname),
            "",
            port,
            properties,
        )
        .map_err(|e| e.to_string())?;

        daemon.register(service.clone()).map_err(|e| e.to_string())?;

        Ok(Self {
            daemon,
            service_fullname: service.get_fullname().to_string(),
        })
    }

    /// Stop advertising
    pub fn stop(&self) -> Result<(), String> {
        self.daemon
            .unregister(&self.service_fullname)
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

impl Drop for MdnsAdvertiser {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

/// Discover peers on the local network
pub async fn discover_peers(timeout_secs: u64) -> Result<Vec<DiscoveredPeer>, String> {
    let daemon = ServiceDaemon::new().map_err(|e| e.to_string())?;
    let receiver = daemon.browse(SERVICE_TYPE).map_err(|e| e.to_string())?;

    let peers: Arc<RwLock<Vec<DiscoveredPeer>>> = Arc::new(RwLock::new(Vec::new()));
    let peers_clone = peers.clone();

    // Spawn a task to collect discovered services
    let handle = tokio::spawn(async move {
        let timeout = tokio::time::sleep(Duration::from_secs(timeout_secs));
        tokio::pin!(timeout);

        loop {
            tokio::select! {
                _ = &mut timeout => break,
                event = tokio::task::spawn_blocking({
                    let receiver = receiver.clone();
                    move || receiver.recv_timeout(Duration::from_millis(100))
                }) => {
                    if let Ok(Ok(event)) = event {
                        if let ServiceEvent::ServiceResolved(info) = event {
                            if let Some(peer) = parse_service_info(&info) {
                                let mut peers = peers_clone.write().await;
                                // Avoid duplicates
                                if !peers.iter().any(|p| p.device_id == peer.device_id) {
                                    peers.push(peer);
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    handle.await.map_err(|e| e.to_string())?;

    let result = peers.read().await.clone();
    Ok(result)
}

fn parse_service_info(info: &ServiceInfo) -> Option<DiscoveredPeer> {
    let properties = info.get_properties();

    let device_id = properties.get("device_id")?.val_str().to_string();
    let name = properties
        .get("name")
        .map(|v| v.val_str())
        .unwrap_or("Unknown Device")
        .to_string();
    let device_type = properties
        .get("type")
        .map(|v| v.val_str())
        .unwrap_or("unknown")
        .to_string();
    let public_key_fingerprint = properties
        .get("pk_fp")
        .map(|v| v.val_str())
        .unwrap_or("")
        .to_string();
    let requires_pairing = properties
        .get("pairing")
        .map(|v| v.val_str())
        .map(|s| s == "true")
        .unwrap_or(true);

    // Get first address
    let address = info
        .get_addresses()
        .iter()
        .next()
        .map(|a| a.to_string())
        .unwrap_or_default();

    if address.is_empty() {
        return None;
    }

    Some(DiscoveredPeer {
        device_id,
        name,
        device_type,
        address,
        port: info.get_port(),
        public_key_fingerprint,
        requires_pairing,
    })
}
