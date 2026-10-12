mod oauth;
mod retired_sync;

use oauth::{await_oauth_callback, bind_oauth_callback, cancel_oauth_callback, OAuthState};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init())
        // Opens the OAuth authorize URL in the user's real browser. OAuth 2.1 BCP
        // forbids an embedded user-agent: our webview could read the session.
        .plugin(tauri_plugin_opener::init())
        .manage(OAuthState::default())
        .invoke_handler(tauri::generate_handler![
            // OAuth loopback callback (MUT-28)
            bind_oauth_callback,
            await_oauth_callback,
            cancel_oauth_callback,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Device sync is retired (MUT-73): remove the paired-devices file it
            // left behind. Best effort; never blocks startup.
            match app.path().app_config_dir() {
                Ok(dir) => {
                    for (path, err) in retired_sync::remove_retired_sync_files(&dir) {
                        log::warn!("Could not remove retired sync file {}: {err}", path.display());
                    }
                }
                Err(err) => log::warn!("Could not resolve the app config directory: {err}"),
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
