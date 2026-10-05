/**
 * Connecting Mutaba3a to a Malafat workspace, end to end.
 *
 * MUT-28. Orders the pieces that oauth-pkce / oauth-client / tokenStore provide
 * and owns the one guarantee the ticket cares most about:
 *
 *   REVOKED CONSENT NEVER DESTROYS LOCAL DATA.
 *
 * When a lawyer revokes the grant in Malafat's Settings, this module forgets a
 * token and nothing else. Mutaba3a goes back to being the local app it already
 * is. Nothing here can reach Dexie, and it must stay that way — the recovery
 * path for a revoked grant is "sign in again", never "resync from the server".
 *
 * Platform calls are injected (bindCallback / awaitCallback / openUrl) so the
 * whole flow runs under test without Tauri. In the app those map to the
 * bind_oauth_callback / await_oauth_callback commands and the opener plugin.
 */

import { createPkcePair, generateState } from './oauth-pkce';
import {
  discoverAuthorizationServer,
  buildAuthorizeUrl,
  parseCallbackParams,
  exchangeCodeForTokens,
  refreshTokens,
  redirectUriForPort,
  OAuthTokenError,
  OAUTH_LOOPBACK_PORTS,
  CIMD_CLIENT_ID,
  type TokenSet,
  type OAuthClientConfig,
} from './oauth-client';
import { needsRefresh, type TokenStore } from '../../services/tokenStore';

export interface OAuthFlowDeps {
  /** Bind a loopback listener; resolves with the port actually bound. */
  bindCallback: (ports: readonly number[]) => Promise<number>;
  /** Resolve with the raw query string of the redirect. */
  awaitCallback: () => Promise<string>;
  /** Open a URL in the user's real browser, never the webview. */
  openUrl: (url: string) => Promise<void>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * There is no usable grant for this workspace: never connected, or consent was
 * revoked. Distinct from a transient failure, because the only cure is the user
 * signing in again — and because the caller must NOT treat it as data loss.
 */
export class WorkspaceDisconnectedError extends Error {
  constructor(workspaceOrigin: string, cause?: string) {
    super(
      `Not connected to ${workspaceOrigin}${cause ? ` (${cause})` : ''}. Local data is unaffected.`
    );
    this.name = 'WorkspaceDisconnectedError';
  }
}

export interface WorkspaceConnection {
  workspaceOrigin: string;
  tokens: TokenSet;
}

function configFor(port: number, scopes: string[]): OAuthClientConfig {
  return {
    clientId: CIMD_CLIENT_ID,
    redirectUri: redirectUriForPort(port),
    scopes,
  };
}

/**
 * Run the full authorization-code flow and store the resulting tokens.
 *
 * Order matters: the listener is bound BEFORE the authorize URL is built,
 * because `redirect_uri` must name the port that is actually listening and
 * Malafat matches it exactly.
 */
export async function connectWorkspace(
  workspaceOrigin: string,
  scopes: string[],
  store: TokenStore,
  deps: OAuthFlowDeps
): Promise<WorkspaceConnection> {
  const { bindCallback, awaitCallback, openUrl, fetchImpl = fetch, now = Date.now } = deps;

  // Rejects a non-https origin before anything else happens.
  const meta = await discoverAuthorizationServer(workspaceOrigin, fetchImpl);

  const port = await bindCallback(OAUTH_LOOPBACK_PORTS);
  const config = configFor(port, scopes);

  const pkce = await createPkcePair();
  const state = generateState();

  await openUrl(buildAuthorizeUrl(meta, config, pkce, state));

  // parseCallbackParams compares `state` before trusting anything in the query.
  const rawQuery = await awaitCallback();
  const { code } = parseCallbackParams(`${config.redirectUri}?${rawQuery}`, state);

  const tokens = await exchangeCodeForTokens(meta, config, code, pkce.verifier, fetchImpl, now);

  // Stored only after a successful exchange — a half-finished flow must not
  // leave a partial credential behind.
  await store.save(workspaceOrigin, tokens);

  return { workspaceOrigin, tokens };
}

/**
 * Return a usable access token, refreshing first if it is close to expiring.
 *
 * Deliberately does NOT start an interactive sign-in. Opening a browser from
 * what the caller thinks is a background sync would be a surprise; the caller
 * catches WorkspaceDisconnectedError and decides whether to prompt.
 */
export async function getValidAccessToken(
  workspaceOrigin: string,
  store: TokenStore,
  deps: OAuthFlowDeps
): Promise<string> {
  const { fetchImpl = fetch, now = Date.now } = deps;

  const current = await store.load(workspaceOrigin);
  if (!current) {
    throw new WorkspaceDisconnectedError(workspaceOrigin, 'no stored grant');
  }

  if (!needsRefresh(current, now())) {
    return current.accessToken;
  }

  if (!current.refreshToken) {
    throw new WorkspaceDisconnectedError(workspaceOrigin, 'no refresh token');
  }

  const meta = await discoverAuthorizationServer(workspaceOrigin, fetchImpl);
  // The port is irrelevant to a refresh, but client_id is required; any
  // registered port yields the same config shape.
  const config = configFor(OAUTH_LOOPBACK_PORTS[0], current.scopes);

  try {
    const refreshed = await refreshTokens(meta, config, current.refreshToken, fetchImpl, now);
    // Persist before returning: a rotated refresh token that is not stored
    // gets replayed next time, and Malafat revokes the whole grant for that.
    await store.save(workspaceOrigin, refreshed);
    return refreshed.accessToken;
  } catch (error) {
    if (error instanceof OAuthTokenError && error.grantInvalid) {
      // Consent is gone. Forget the credential — and ONLY the credential.
      await store.clear(workspaceOrigin);
      throw new WorkspaceDisconnectedError(workspaceOrigin, error.code);
    }
    // Transient: keep the tokens so a server blip does not force a re-auth.
    throw error;
  }
}

/** Disconnect this workspace. Forgets tokens; touches no application data. */
export async function disconnectWorkspace(
  workspaceOrigin: string,
  store: TokenStore
): Promise<void> {
  await store.clear(workspaceOrigin);
}
