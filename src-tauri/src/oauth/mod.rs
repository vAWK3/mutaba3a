//! Malafat OAuth: the loopback callback listener and the three commands the
//! frontend drives it with (MUT-28).
//!
//! These lived in the sync module until device sync was retired (MUT-73,
//! ADR-053). The commands, their names and their behaviour are unchanged; only
//! their state moved from `SyncState` to its own `OAuthState`.

pub mod callback;

use callback::{bind_loopback_callback, BoundCallback};
use std::time::Duration;
use tauri::State;
use tokio::sync::Mutex as TokioMutex;

/// How long we wait for the user to finish in their browser before giving the
/// port back. Long enough to read a consent screen and log in; short enough
/// that an abandoned attempt does not hold the port all session.
const OAUTH_CALLBACK_TIMEOUT_SECS: u64 = 300;

/// Managed state for the OAuth sign-in.
#[derive(Default)]
pub struct OAuthState {
    /// A loopback listener awaiting one OAuth redirect, if a sign-in is in flight.
    callback: TokioMutex<Option<BoundCallback>>,
}

// Three commands rather than one, because the frontend must know which port was
// actually bound BEFORE it opens the browser: `redirect_uri` has to name that
// port, and Malafat matches it exactly.
//
//   bind_oauth_callback(ports)   -> port
//   ...frontend builds the authorize URL and opens the system browser...
//   await_oauth_callback()       -> raw query string
//
// The raw query is returned unparsed. `state` is compared in the frontend
// (parseCallbackParams) so there is exactly one implementation of that check.

/// Bind a loopback listener and report the port it got.
///
/// `ports` must come from the frontend's OAUTH_LOOPBACK_PORTS, which is the
/// same list published in our CIMD document. An unregistered port would be
/// refused by the server without a redirect.
#[tauri::command]
pub async fn bind_oauth_callback(
    state: State<'_, OAuthState>,
    ports: Vec<u16>,
) -> Result<u16, String> {
    let bound = bind_loopback_callback(&ports).await?;
    let port = bound.port();

    // Replacing any previous listener drops it, which releases its port. A user
    // who abandoned one sign-in and started another should not be blocked by
    // their own stale attempt.
    let mut slot = state.callback.lock().await;
    *slot = Some(bound);

    Ok(port)
}

/// Wait for the redirect and return its raw query string.
#[tauri::command]
pub async fn await_oauth_callback(
    state: State<'_, OAuthState>,
    timeout_secs: Option<u64>,
) -> Result<String, String> {
    // Take the listener out before awaiting so the state lock is not held for
    // the whole five minutes — otherwise cancel_oauth_callback could not run.
    let bound = {
        let mut slot = state.callback.lock().await;
        slot.take()
    };

    let bound = bound.ok_or_else(|| "No OAuth sign-in is in progress".to_string())?;
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(OAUTH_CALLBACK_TIMEOUT_SECS));
    bound.wait(timeout).await
}

/// Abandon an in-flight sign-in and release the port.
#[tauri::command]
pub async fn cancel_oauth_callback(state: State<'_, OAuthState>) -> Result<(), String> {
    let mut slot = state.callback.lock().await;
    // Dropping BoundCallback drops its shutdown sender, which ends the server
    // task and frees the port.
    *slot = None;
    Ok(())
}
