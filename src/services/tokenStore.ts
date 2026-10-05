/**
 * OAuth token storage port.
 *
 * MUT-28 spike. Exists so the spike can complete an authorization flow without
 * deciding where a refresh token lives in production — that decision needs a
 * Tauri keychain plugin the spike does not add, and baking in a wrong answer is
 * worse than having none.
 *
 * TWO RULES THIS PORT ENCODES:
 *
 * 1. Tokens are keyed per workspace origin. A lawyer can act for more than one
 *    firm, and each firm is a separate tenant with its own grant. A single
 *    "current token" slot would silently cross firms.
 *
 * 2. Clearing tokens is NOT clearing data. Nothing in this module can reach the
 *    Dexie database. Revoked consent means Mutaba3a returns to being the local
 *    app it already is — a lawyer who revokes a grant must not lose a single
 *    transaction. Keep this module free of any `db` import.
 *
 * PRODUCTION GAP (finding for MUT-28's write-up): a refresh token is a
 * long-lived credential and belongs in the OS keychain (Keychain / Credential
 * Manager / libsecret), which in Tauri 2 means adding a plugin and a narrow
 * capability. Until then InMemoryTokenStore loses tokens on restart, which
 * forces re-auth — the safe failure, and deliberately not papered over by
 * writing them to IndexedDB or a plain file.
 */

import type { TokenSet } from '../sync/transport/oauth-client';

/**
 * Refresh this long before the access token actually expires.
 *
 * Malafat issues access tokens with a one-hour lifetime. Two minutes is enough
 * to cover an in-flight sync plus clock skew between the desktop and the
 * server, without refreshing so eagerly that every session burns a rotation.
 */
export const REFRESH_SKEW_MS = 2 * 60 * 1000;

export interface TokenStore {
  load(workspaceOrigin: string): Promise<TokenSet | null>;
  save(workspaceOrigin: string, tokens: TokenSet): Promise<void>;
  /** Forget this workspace's tokens. Must never touch application data. */
  clear(workspaceOrigin: string): Promise<void>;
  clearAll(): Promise<void>;
}

/**
 * Trailing slashes and case differences would otherwise key the same firm twice
 * and leave one copy of a superseded refresh token behind.
 */
function workspaceKey(workspaceOrigin: string): string {
  try {
    return new URL(workspaceOrigin).origin;
  } catch {
    return workspaceOrigin.replace(/\/+$/, '');
  }
}

export class InMemoryTokenStore implements TokenStore {
  private readonly tokens = new Map<string, TokenSet>();

  async load(workspaceOrigin: string): Promise<TokenSet | null> {
    return this.tokens.get(workspaceKey(workspaceOrigin)) ?? null;
  }

  async save(workspaceOrigin: string, tokens: TokenSet): Promise<void> {
    // set() replaces, so a superseded refresh token cannot linger. Replaying
    // one would revoke the whole grant (REFRESH_REUSE).
    this.tokens.set(workspaceKey(workspaceOrigin), tokens);
  }

  async clear(workspaceOrigin: string): Promise<void> {
    this.tokens.delete(workspaceKey(workspaceOrigin));
  }

  async clearAll(): Promise<void> {
    this.tokens.clear();
  }
}

export function isAccessTokenExpired(tokens: TokenSet, now: number): boolean {
  return now >= tokens.expiresAt;
}

/** True once the token is inside the skew window, or already expired. */
export function needsRefresh(tokens: TokenSet, now: number): boolean {
  return now >= tokens.expiresAt - REFRESH_SKEW_MS;
}
