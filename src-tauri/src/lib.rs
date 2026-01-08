mod sync;

use sync::commands::{
    cancel_pairing_session, clear_pending_sync_ops, decrypt_bundle, discover_lan_peers,
    encrypt_bundle, get_hostname, get_local_sync_ops_count, get_paired_devices, get_pairing_status,
    get_pending_sync_ops, get_sync_server_port, is_sync_server_running, revoke_paired_device,
    start_pairing_session, start_sync_server, stop_sync_server, store_local_sync_op, SyncState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(SyncState::default())
        .invoke_handler(tauri::generate_handler![
            // Sync server
            start_sync_server,
            stop_sync_server,
            is_sync_server_running,
            get_sync_server_port,
            discover_lan_peers,
            // Encryption
            encrypt_bundle,
            decrypt_bundle,
            // Device
            get_hostname,
            // Pairing
            start_pairing_session,
            get_pairing_status,
            cancel_pairing_session,
            get_paired_devices,
            revoke_paired_device,
            // Sync ops (incoming from mobile)
            get_pending_sync_ops,
            clear_pending_sync_ops,
            // Local ops (outgoing to mobile)
            store_local_sync_op,
            get_local_sync_ops_count,
        ])
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
