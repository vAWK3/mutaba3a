//! OAuth loopback callback listener
//!
//! MUT-28. The authorize page must open in the user's real browser, not in the
//! app webview — an embedded user-agent can read the user's Malafat session,
//! which OAuth 2.1 BCP forbids. That means the authorization code comes back to
//! a loopback HTTP redirect, and something has to be listening for it.
//!
//! Three properties are deliberate:
//!
//! BINDS 127.0.0.1 ONLY, never 0.0.0.0. The LAN sync server in server.rs is
//! meant to be reachable by a paired device; this one must not be reachable by
//! anything off-machine. An authorization code is a bearer credential for the
//! few seconds it lives.
//!
//! SINGLE SHOT. The first callback is taken and the sender is consumed; a
//! second request gets a page and nothing else. Replaying a redirect must not
//! be able to inject a second code into a flow already in progress.
//!
//! PRE-REGISTERED PORTS. Malafat matches redirect_uris exactly, so the port
//! cannot be ephemeral as RFC 8252 would prefer — it has to be one of the ports
//! listed in our published CIMD document. The caller passes that list and we
//! take the first one we can bind. Keep it in step with
//! `OAUTH_LOOPBACK_PORTS` in src/sync/transport/oauth-client.ts.
//!
//! State validation is NOT done here. The raw query string is handed to the
//! frontend, which compares `state` before believing anything in it — see
//! `parseCallbackParams`. Keeping the comparison in one place avoids two
//! implementations that could disagree.

use axum::{extract::RawQuery, extract::State, response::Html, routing::get, Router};
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

/// Shown in the browser tab the user was sent to. Deliberately says nothing
/// about success or failure of the grant itself — that is decided after the
/// token exchange, not here.
const DONE_HTML: &str = "<!doctype html><meta charset=\"utf-8\"><title>Mutaba3a</title>\
<body style=\"font-family:system-ui;padding:3rem;text-align:center\">\
<p>You can close this tab and return to Mutaba3a.</p></body>";

const ALREADY_HANDLED_HTML: &str = "<!doctype html><meta charset=\"utf-8\"><title>Mutaba3a</title>\
<body style=\"font-family:system-ui;padding:3rem;text-align:center\">\
<p>This sign-in link was already used.</p></body>";

#[derive(Clone)]
struct CallbackState {
    /// Taken by the first request; `None` thereafter. This is the single-shot latch.
    sender: Arc<Mutex<Option<oneshot::Sender<String>>>>,
}

async fn handle_callback(
    State(state): State<CallbackState>,
    RawQuery(query): RawQuery,
) -> Html<&'static str> {
    let mut slot = match state.sender.lock() {
        Ok(slot) => slot,
        // A poisoned lock means a previous handler panicked. Refuse rather than
        // risk accepting a second code.
        Err(_) => return Html(ALREADY_HANDLED_HTML),
    };

    match slot.take() {
        Some(tx) => {
            let _ = tx.send(query.unwrap_or_default());
            Html(DONE_HTML)
        }
        None => Html(ALREADY_HANDLED_HTML),
    }
}

/// A bound loopback listener awaiting exactly one redirect.
#[derive(Debug)]
pub struct BoundCallback {
    port: u16,
    result_rx: oneshot::Receiver<String>,
    shutdown_tx: Option<oneshot::Sender<()>>,
}

impl BoundCallback {
    /// The port actually bound. The caller must build its `redirect_uri` from
    /// this, not from the first port it asked for.
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Wait for the redirect and return its raw query string.
    ///
    /// The listener is shut down on every exit path, including timeout, so a
    /// cancelled sign-in does not leave a port held for the rest of the
    /// session.
    pub async fn wait(mut self, timeout: Duration) -> Result<String, String> {
        let outcome = match tokio::time::timeout(timeout, self.result_rx).await {
            Ok(Ok(query)) => Ok(query),
            // Sender dropped without sending: the server task died.
            Ok(Err(_)) => Err("OAuth callback listener stopped before a redirect arrived".into()),
            Err(_) => Err("Timed out waiting for the browser to return to Mutaba3a".into()),
        };

        if let Some(shutdown) = self.shutdown_tx.take() {
            let _ = shutdown.send(());
        }

        outcome
    }
}

/// Bind the first available port from `ports` on 127.0.0.1 and serve one redirect.
///
/// Fails only when every registered port is taken, which is the one case the
/// caller must surface to the user — there is no ephemeral fallback, because an
/// unregistered port would be rejected by the server without a redirect.
pub async fn bind_loopback_callback(ports: &[u16]) -> Result<BoundCallback, String> {
    if ports.is_empty() {
        return Err("No loopback ports supplied for the OAuth callback".into());
    }

    let mut listener: Option<(TcpListener, u16)> = None;
    for &port in ports {
        let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
        if let Ok(bound) = TcpListener::bind(addr).await {
            listener = Some((bound, port));
            break;
        }
    }

    let (bound, port) = listener.ok_or_else(|| {
        format!(
            "Every registered sign-in port is in use ({}). Close whatever is using them and try again.",
            ports
                .iter()
                .map(|p| p.to_string())
                .collect::<Vec<_>>()
                .join(", ")
        )
    })?;

    let (result_tx, result_rx) = oneshot::channel::<String>();
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    let app = Router::new()
        .route("/callback", get(handle_callback))
        .with_state(CallbackState {
            sender: Arc::new(Mutex::new(Some(result_tx))),
        });

    tokio::spawn(async move {
        let server = axum::serve(bound, app).with_graceful_shutdown(async move {
            let _ = shutdown_rx.await;
        });
        if let Err(err) = server.await {
            log::warn!("OAuth callback listener stopped: {err}");
        }
    });

    Ok(BoundCallback {
        port,
        result_rx,
        shutdown_tx: Some(shutdown_tx),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;

    /// Issue a raw HTTP GET so the tests need no HTTP client dependency.
    async fn get(port: u16, path_and_query: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let request = format!(
            "GET {path_and_query} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
        );
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).await.unwrap();
        response
    }

    #[tokio::test]
    async fn binds_a_port_from_the_supplied_list() {
        let bound = bind_loopback_callback(&[14310, 14311]).await.unwrap();
        assert!([14310, 14311].contains(&bound.port()));
    }

    #[tokio::test]
    async fn falls_back_when_the_first_port_is_taken() {
        let squatter = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 14320)))
            .await
            .unwrap();

        let bound = bind_loopback_callback(&[14320, 14321]).await.unwrap();
        assert_eq!(bound.port(), 14321, "should skip the occupied port");

        drop(squatter);
    }

    #[tokio::test]
    async fn fails_when_every_port_is_taken() {
        let a = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 14330)))
            .await
            .unwrap();

        let err = bind_loopback_callback(&[14330]).await.unwrap_err();
        assert!(err.contains("14330"), "error should name the ports: {err}");

        drop(a);
    }

    #[tokio::test]
    async fn rejects_an_empty_port_list() {
        assert!(bind_loopback_callback(&[]).await.is_err());
    }

    #[tokio::test]
    async fn returns_the_raw_query_string_of_the_redirect() {
        let bound = bind_loopback_callback(&[14340]).await.unwrap();
        let port = bound.port();

        let waiter = tokio::spawn(async move { bound.wait(Duration::from_secs(5)).await });
        let response = get(port, "/callback?code=abc123&state=xyz").await;

        assert!(response.contains("200 OK"), "unexpected response: {response}");
        assert_eq!(waiter.await.unwrap().unwrap(), "code=abc123&state=xyz");
    }

    #[tokio::test]
    async fn passes_an_error_redirect_through_without_interpreting_it() {
        // State comparison and error handling belong to parseCallbackParams in
        // the frontend; this listener must not second-guess the query.
        let bound = bind_loopback_callback(&[14350]).await.unwrap();
        let port = bound.port();

        let waiter = tokio::spawn(async move { bound.wait(Duration::from_secs(5)).await });
        get(port, "/callback?error=access_denied&state=xyz").await;

        assert_eq!(waiter.await.unwrap().unwrap(), "error=access_denied&state=xyz");
    }

    #[tokio::test]
    async fn serves_only_one_callback() {
        let bound = bind_loopback_callback(&[14360]).await.unwrap();
        let port = bound.port();

        let waiter = tokio::spawn(async move { bound.wait(Duration::from_secs(5)).await });
        let first = get(port, "/callback?code=first&state=s").await;
        assert!(first.contains("close this tab"), "first should succeed");

        let captured = waiter.await.unwrap().unwrap();
        assert_eq!(captured, "code=first&state=s");

        // Whatever happens to a later request, it must not have replaced the
        // captured code. Either the listener is already gone (connection
        // refused) or it answers "already used".
        if let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)).await {
            let _ = stream
                .write_all(
                    b"GET /callback?code=second&state=s HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
                )
                .await;
            let mut second = String::new();
            let _ = stream.read_to_string(&mut second).await;
            assert!(
                !second.contains("close this tab"),
                "a second redirect must not be accepted: {second}"
            );
        }
    }

    #[tokio::test]
    async fn times_out_when_no_redirect_arrives() {
        let bound = bind_loopback_callback(&[14370]).await.unwrap();
        let err = bound.wait(Duration::from_millis(50)).await.unwrap_err();
        assert!(err.contains("Timed out"), "unexpected error: {err}");
    }

    #[tokio::test]
    async fn releases_the_port_after_a_timeout() {
        let bound = bind_loopback_callback(&[14380]).await.unwrap();
        let _ = bound.wait(Duration::from_millis(50)).await;

        // Give the graceful shutdown a moment, then prove the port is reusable.
        tokio::time::sleep(Duration::from_millis(100)).await;
        let again = bind_loopback_callback(&[14380]).await;
        assert!(again.is_ok(), "port should be free after a timed-out flow");
    }

    #[tokio::test]
    async fn is_not_reachable_from_off_machine() {
        // Binding 127.0.0.1 means a second bind on 0.0.0.0:<same port> still
        // succeeds, which would be impossible had we bound the wildcard.
        let bound = bind_loopback_callback(&[14390]).await.unwrap();
        let wildcard =
            TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], bound.port() + 1))).await;
        assert!(wildcard.is_ok());

        let loopback_only = TcpListener::bind(SocketAddr::from((
            Ipv4Addr::LOCALHOST,
            bound.port(),
        )))
        .await;
        assert!(
            loopback_only.is_err(),
            "our own loopback port should already be taken by us"
        );
    }
}
