import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { sessionDigest } from '../auth/sessions.js';
import type { AuditActorType, AuditEventInput, LedgerStore, OAuthClientRecord, OAuthGrantRecord, OAuthGrantRevokedReason, OAuthTokenInput, OAuthTokenRecord } from '../repositories/ports.js';
import { canonicalResource, isValidCodeChallenge, mcpResourceUrl, parseScopeParam, redirectMatches, validateDcrRequest, verifyS256 } from './protocol.js';
import { isAccessToken, isOAuthToken, OAUTH_TOKEN_PREFIX } from './tokens.js';
import { cimdCacheUntil, isCimdClientId, type CimdFetchResult } from './trust.js';

/**
 * MUT-434 (ADR-197): the authorization server's state machine over the store port. Hand-rolled (D9), public clients
 * only, PKCE S256, opaque tokens stored as digests under SESSION_TOKEN_PEPPER (rotating it signs agents out too).
 * Every decision that must happen once — a consent, a code exchange, a refresh — is a conditional claim in the store
 * (D6). The clock is passed in, so every rule is testable on the memory store.
 */

const DAY_MS = 86_400_000;

/** D13 + OV7. Code and request are short; refresh slides by 45 days of idleness inside the grant's 180-day cap. */
export const OAUTH_TTL = {
  codeMs: 60_000,
  requestMs: 30 * 60_000,
  accessMs: 3_600_000,
  refreshIdleMs: 45 * DAY_MS,
  grantMs: 180 * DAY_MS,
  /** D19: a refresh token presented again within this window gets the identical successor pair back. */
  reuseGraceMs: 30_000,
} as const;

const PREFIX = OAUTH_TOKEN_PREFIX;
const RANDOM_BYTES = 32;
const MAX_STATE_LENGTH = 500;

function randomToken(prefix: string): string {
  return prefix + randomBytes(RANDOM_BYTES).toString('base64url');
}

export type AuditFor = (input: {
  userId: string;
  action: 'user.agent_connected' | 'user.agent_disconnected';
  metadata: Record<string, string | string[]>;
  actor: { actorType: AuditActorType; actorId: string | null };
  requestId: string | null;
}) => Promise<AuditEventInput[]>;

export interface OAuthServiceDeps {
  /** The raw store: the protocol endpoints run outside /v1, like sign-in. */
  store: LedgerStore;
  /** PORTAL_ORIGIN: the issuer, and `<issuer>/mcp` the one protected resource. */
  issuer: string;
  pepper: string;
  /** OAUTH_DERIVE_KEY (D19): the secret successor tokens are derived under. */
  deriveKey: string;
  fetchMetadata: (url: string) => Promise<CimdFetchResult>;
  captureMessage: (level: 'warning' | 'info', message: string, tags: Record<string, string>) => void;
  auditFor: AuditFor;
}

export type PageError = 'invalid_client' | 'invalid_redirect_uri' | 'invalid_request';

export type StartResult = { kind: 'consent'; requestId: string } | { kind: 'redirect'; redirectTo: string } | { kind: 'page_error'; error: PageError };

export type TokenResult = { status: 200; body: Record<string, string | number> } | { status: 400 | 401; body: { error: string; error_description: string } };

type Params = Record<string, string | undefined>;

export class OAuthService {
  private readonly resource: string;

  constructor(private readonly deps: OAuthServiceDeps) {
    this.resource = canonicalResource(mcpResourceUrl(deps.issuer)) ?? mcpResourceUrl(deps.issuer);
  }

  get issuer(): string {
    return this.deps.issuer.endsWith('/') ? this.deps.issuer.slice(0, -1) : this.deps.issuer;
  }

  private digest(token: string): string {
    return sessionDigest(this.deps.pepper, token);
  }

  /** D19: the successor pair is a function of the parent token and its recorded successor id, so a retry re-derives it. */
  private derive(prefix: string, kind: 'access' | 'refresh', parent: string, successorId: string): string {
    return prefix + createHmac('sha256', this.deps.deriveKey).update(`${kind}:${parent}:${successorId}`).digest('base64url');
  }

  // ---- registration ----------------------------------------------------------

  async register(body: unknown, at: Date): Promise<{ ok: true; client: OAuthClientRecord } | { ok: false; error: string; description: string }> {
    const result = validateDcrRequest(body);
    if (!result.ok) return { ok: false, error: result.error, description: result.description };
    const client = await this.deps.store.oauth.createClient({ id: randomToken(PREFIX.client).slice(0, PREFIX.client.length + 32), clientName: result.value.clientName, redirectUris: result.value.redirectUris, at });
    return { ok: true, client };
  }

  /** A DCR client by id, or a CIMD client fetched (or re-fetched once stale) and stored as a row (OV2). */
  private async resolveClient(clientId: string, at: Date): Promise<OAuthClientRecord | null> {
    const existing = await this.deps.store.oauth.findClient(clientId);
    if (!isCimdClientId(clientId)) return existing?.kind === 'DCR' ? existing : null;
    if (existing?.kind === 'CIMD' && existing.metadataExpiresAt && existing.metadataExpiresAt.getTime() > at.getTime()) return existing;
    const fetched = await this.deps.fetchMetadata(clientId);
    if (!fetched.ok) return null;
    return this.deps.store.oauth.upsertCimdClient({
      id: clientId,
      clientName: fetched.metadata.clientName,
      redirectUris: fetched.metadata.redirectUris,
      at,
      metadataExpiresAt: cimdCacheUntil(fetched.cacheControl, at),
    });
  }

  // ---- authorization ------------------------------------------------------------

  private redirectWith(redirectUri: string, params: Record<string, string | null>): string {
    const url = new URL(redirectUri);
    for (const [key, value] of Object.entries(params)) if (value !== null) url.searchParams.set(key, value);
    // S2b (D4): every authorization response carries the issuer, errors included (RFC 9207).
    url.searchParams.set('iss', this.issuer);
    return url.toString();
  }

  /**
   * RFC 6749 §4.1.2.1: until the client and its redirect are known good, an error is shown on our own page and never
   * sent to the presented redirect. After that, errors go back to the client with its state.
   */
  async startAuthorization(params: Params, at: Date): Promise<StartResult> {
    const clientId = params.client_id;
    if (!clientId) return { kind: 'page_error', error: 'invalid_request' };
    const client = await this.resolveClient(clientId, at);
    if (!client) return { kind: 'page_error', error: 'invalid_client' };
    const redirectUri = params.redirect_uri;
    if (!redirectUri || !redirectMatches(client.redirectUris, redirectUri)) return { kind: 'page_error', error: 'invalid_redirect_uri' };

    const state = params.state ?? null;
    const fail = (error: string): StartResult => ({ kind: 'redirect', redirectTo: this.redirectWith(redirectUri, { error, state }) });
    if (state !== null && state.length > MAX_STATE_LENGTH) return fail('invalid_request');
    if (params.response_type !== 'code') return fail('unsupported_response_type');
    if (params.code_challenge_method !== 'S256' || !params.code_challenge || !isValidCodeChallenge(params.code_challenge)) return fail('invalid_request');
    const scopes = parseScopeParam(params.scope);
    if (!scopes.ok) return fail('invalid_scope');
    const resource = params.resource === undefined ? this.resource : canonicalResource(params.resource);
    if (resource !== this.resource) return fail('invalid_target');

    const request = await this.deps.store.oauth.createAuthorizationRequest({
      clientId: client.id,
      redirectUri,
      codeChallenge: params.code_challenge,
      scopes: scopes.scopes,
      state,
      resource,
      createdAt: at,
      expiresAt: new Date(at.getTime() + OAUTH_TTL.requestMs),
    });
    return { kind: 'consent', requestId: request.id };
  }

  /** What the consent page shows; null once the request is decided, expired or unknown. */
  async describeRequest(requestId: string, at: Date) {
    const request = await this.deps.store.oauth.findAuthorizationRequest(requestId);
    if (!request || request.decidedAt !== null || request.expiresAt.getTime() <= at.getTime()) return null;
    const client = await this.deps.store.oauth.findClient(request.clientId);
    if (!client) return null;
    return { request, client };
  }

  async decide(input: { requestId: string; userId: string; approve: boolean; at: Date; actor: { actorType: AuditActorType; actorId: string | null }; requestIdForAudit: string | null }): Promise<{ kind: 'redirect'; redirectTo: string } | { kind: 'gone' }> {
    const { at } = input;
    const described = await this.describeRequest(input.requestId, at);
    if (!described) return { kind: 'gone' };
    const { request, client } = described;
    const code = randomToken(PREFIX.code);
    const audit = input.approve
      ? await this.deps.auditFor({ userId: input.userId, action: 'user.agent_connected', metadata: { clientName: client.clientName, clientKind: client.kind, scopes: request.scopes }, actor: input.actor, requestId: input.requestIdForAudit })
      : [];
    const result = await this.deps.store.oauth.decide({
      requestId: request.id,
      userId: input.userId,
      at,
      approve: input.approve ? { grantExpiresAt: new Date(at.getTime() + OAUTH_TTL.grantMs), code: { digest: this.digest(code), expiresAt: new Date(at.getTime() + OAUTH_TTL.codeMs) } } : null,
      audit,
    });
    if (!result.decided) return { kind: 'gone' };
    const params = input.approve ? { code, state: request.state } : { error: 'access_denied', state: request.state };
    return { kind: 'redirect', redirectTo: this.redirectWith(request.redirectUri, params) };
  }

  // ---- the token endpoint ---------------------------------------------------------

  private error(error: string, description: string, status: 400 | 401 = 400): TokenResult {
    return { status, body: { error, error_description: description } };
  }

  private tokenBody(access: string, refresh: string, accessExpiresAt: Date, scopes: string[], at: Date): TokenResult {
    return {
      status: 200,
      body: { access_token: access, token_type: 'Bearer', expires_in: Math.max(0, Math.floor((accessExpiresAt.getTime() - at.getTime()) / 1000)), refresh_token: refresh, scope: scopes.join(' ') },
    };
  }

  private expiries(grant: OAuthGrantRecord, at: Date) {
    const cap = grant.expiresAt.getTime();
    return { access: new Date(Math.min(at.getTime() + OAUTH_TTL.accessMs, cap)), refresh: new Date(Math.min(at.getTime() + OAUTH_TTL.refreshIdleMs, cap)) };
  }

  async token(params: Params, at: Date): Promise<TokenResult> {
    if (!params.client_id) return this.error('invalid_request', 'client_id is required for public clients');
    if (params.grant_type === 'authorization_code') return this.exchangeCode(params, params.client_id, at);
    if (params.grant_type === 'refresh_token') return this.refresh(params, params.client_id, at);
    return this.error('unsupported_grant_type', 'Only authorization_code and refresh_token are supported');
  }

  private resourceMismatch(presented: string | undefined, bound: string): boolean {
    return presented !== undefined && canonicalResource(presented) !== bound;
  }

  private async exchangeCode(params: Params, clientId: string, at: Date): Promise<TokenResult> {
    const { code, code_verifier: verifier, redirect_uri: redirectUri } = params;
    if (!code || !verifier || !redirectUri) return this.error('invalid_request', 'code, code_verifier and redirect_uri are required');
    const digest = this.digest(code);
    const stored = await this.deps.store.oauth.findCode(digest);
    const grant = stored ? await this.deps.store.oauth.findGrant(stored.grantId) : null;
    if (!stored || !grant) return this.error('invalid_grant', 'The code is invalid or expired');
    if (grant.clientId !== clientId) return this.error('invalid_grant', 'The code was issued to another client');
    // Checked before the claim, so a wrong verifier or redirect leaves the code usable by its rightful holder.
    if (stored.consumedAt === null) {
      if (!verifyS256(verifier, stored.codeChallenge) || stored.redirectUri !== redirectUri) return this.error('invalid_grant', 'The code, verifier or redirect does not match');
      if (this.resourceMismatch(params.resource, stored.resource)) return this.error('invalid_target', 'The resource does not match the authorization');
    }

    const access = randomToken(PREFIX.access);
    const refresh = randomToken(PREFIX.refresh);
    const expiries = this.expiries(grant, at);
    const tokens: OAuthTokenInput[] = [
      { id: randomUUID(), digest: this.digest(access), kind: 'ACCESS', expiresAt: expiries.access },
      { id: randomUUID(), digest: this.digest(refresh), kind: 'REFRESH', expiresAt: expiries.refresh },
    ];
    const result = await this.deps.store.oauth.exchangeCode({ digest, at, tokens });
    if (result.status === 'reused') {
      await this.revokeForCompromise(grant, 'code_reuse', at);
      return this.error('invalid_grant', 'The code was already used');
    }
    if (result.status === 'invalid') return this.error('invalid_grant', 'The code is invalid or expired');
    return this.tokenBody(access, refresh, expiries.access, result.grant.scopes, at);
  }

  private async refresh(params: Params, clientId: string, at: Date): Promise<TokenResult> {
    const presented = params.refresh_token;
    if (!presented?.startsWith(PREFIX.refresh)) return this.error('invalid_grant', 'The refresh token is invalid');
    const found = await this.deps.store.oauth.findToken(this.digest(presented));
    if (!found || found.token.kind !== 'REFRESH') return this.error('invalid_grant', 'The refresh token is invalid');
    const { token, grant } = found;
    if (grant.clientId !== clientId) return this.error('invalid_grant', 'The refresh token was issued to another client');
    if (!isLive(grant, at)) return this.error('invalid_grant', 'The authorization was revoked or has expired');
    if (this.resourceMismatch(params.resource, grant.resource)) return this.error('invalid_target', 'The resource does not match the authorization');

    if (token.rotatedAt === null) {
      if (token.expiresAt.getTime() <= at.getTime()) return this.error('invalid_grant', 'The refresh token has expired');
      const successorId = randomUUID();
      const pair = this.successorPair(presented, successorId, grant, at);
      if (await this.deps.store.oauth.rotateRefresh({ tokenId: token.id, successorId, at, tokens: pair.tokens })) return this.tokenBody(pair.access, pair.refresh, pair.accessExpiresAt, grant.scopes, at);
      // Lost the claim to a concurrent refresh: read the winner's successor and answer like a retry.
      const winner = await this.deps.store.oauth.findTokenById(token.id);
      if (!winner) return this.error('invalid_grant', 'The refresh token is invalid');
      return this.retryOrRevoke(presented, winner, grant, at);
    }
    return this.retryOrRevoke(presented, token, grant, at);
  }

  private successorPair(parent: string, successorId: string, grant: OAuthGrantRecord, rotatedAt: Date) {
    const access = this.derive(PREFIX.access, 'access', parent, successorId);
    const refresh = this.derive(PREFIX.refresh, 'refresh', parent, successorId);
    const expiries = this.expiries(grant, rotatedAt);
    const tokens: OAuthTokenInput[] = [
      { id: randomUUID(), digest: this.digest(access), kind: 'ACCESS', expiresAt: expiries.access },
      { id: successorId, digest: this.digest(refresh), kind: 'REFRESH', expiresAt: expiries.refresh },
    ];
    return { access, refresh, accessExpiresAt: expiries.access, tokens };
  }

  /** D19: inside 30 s of the rotation, the same pair again; after it, the presentation is a theft signal. */
  private async retryOrRevoke(presented: string, token: OAuthTokenRecord, grant: OAuthGrantRecord, at: Date): Promise<TokenResult> {
    if (token.rotatedAt && token.successorId && at.getTime() - token.rotatedAt.getTime() < OAUTH_TTL.reuseGraceMs) {
      const pair = this.successorPair(presented, token.successorId, grant, token.rotatedAt);
      return this.tokenBody(pair.access, pair.refresh, pair.accessExpiresAt, grant.scopes, at);
    }
    await this.revokeForCompromise(grant, 'refresh_reuse', at);
    return this.error('invalid_grant', 'The refresh token was already used');
  }

  /** D14: a reused code or refresh token ends the grant and is the one routine Sentry warning (a theft signal). */
  private async revokeForCompromise(grant: OAuthGrantRecord, reason: Extract<OAuthGrantRevokedReason, 'refresh_reuse' | 'code_reuse'>, at: Date): Promise<void> {
    const audit = await this.deps.auditFor({ userId: grant.userId, action: 'user.agent_disconnected', metadata: { reason }, actor: { actorType: 'SYSTEM', actorId: null }, requestId: null });
    const revoked = await this.deps.store.oauth.revokeGrant({ grantId: grant.id, reason, at, audit });
    if (revoked) this.deps.captureMessage('warning', reason === 'refresh_reuse' ? 'OAuth refresh token reused; grant revoked' : 'OAuth authorization code reused; grant revoked', { reason, grantId: grant.id });
  }

  // ---- resource side ---------------------------------------------------------------

  /** An access token's live grant, bound to this server's resource (D3); null for anything else. */
  async authenticateAccess(token: string, at: Date): Promise<{ grant: OAuthGrantRecord; token: OAuthTokenRecord } | null> {
    if (!isAccessToken(token)) return null;
    const found = await this.deps.store.oauth.findToken(this.digest(token));
    if (!found || found.token.kind !== 'ACCESS' || found.token.expiresAt.getTime() <= at.getTime()) return null;
    if (!isLive(found.grant, at) || found.grant.resource !== this.resource) return null;
    return found;
  }

  /** RFC 7009: either token ends its whole grant; an unknown token is not an error. */
  async revokeToken(token: string, at: Date): Promise<void> {
    if (!isOAuthToken(token)) return;
    const found = await this.deps.store.oauth.findToken(this.digest(token));
    if (!found) return;
    const audit = await this.deps.auditFor({ userId: found.grant.userId, action: 'user.agent_disconnected', metadata: { reason: 'user' }, actor: { actorType: 'USER', actorId: found.grant.userId }, requestId: null });
    await this.deps.store.oauth.revokeGrant({ grantId: found.grant.id, reason: 'user', at, audit });
  }
}

export function isLive(grant: OAuthGrantRecord, at: Date): boolean {
  return grant.revokedAt === null && grant.expiresAt.getTime() > at.getTime();
}
