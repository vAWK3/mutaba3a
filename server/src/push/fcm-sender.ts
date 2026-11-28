import { createSign } from 'node:crypto';
import type { PushDelivery, PushOutcome, PushSender } from './ports.js';

/**
 * MUT-780 (ADR-350): Firebase Cloud Messaging HTTP v1, for both platforms (FCM relays to APNs for iOS with the APNs
 * auth key uploaded to the Firebase project). Authenticates with a service account: a short RS256 JWT, signed with
 * node:crypto, is exchanged at Google's token endpoint for an access token that is reused until a minute before it
 * ends. No SDK, no new dependency; `fetch` is injected so tests never touch the network.
 *
 * Without a service-account key (`account` absent) the sender uses the runtime's own identity: on Cloud Run the
 * metadata server hands the service's account an access token (its cloud-platform scope covers FCM), so production
 * needs no key, only `roles/firebasecloudmessaging.admin` granted to that account on the Firebase project. The key is
 * for local runs and as a fallback.
 */
const METADATA_TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const REQUEST_TIMEOUT_MS = 10_000;
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const ASSERTION_LIFETIME_S = 3600;

export interface ServiceAccount {
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
}

/** The JSON Google gives for a service account key (`FCM_SERVICE_ACCOUNT_JSON`). Throws a message that names no secret. */
export function parseServiceAccount(json: string): ServiceAccount {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON is not valid JSON');
  }
  const o = raw as { client_email?: unknown; private_key?: unknown; token_uri?: unknown } | null;
  if (!o || typeof o.client_email !== 'string' || typeof o.private_key !== 'string') {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON needs client_email and private_key');
  }
  return { clientEmail: o.client_email, privateKey: o.private_key, tokenUri: typeof o.token_uri === 'string' ? o.token_uri : DEFAULT_TOKEN_URI };
}

const b64url = (input: string | Buffer): string => Buffer.from(input).toString('base64url');

export function signAssertion(account: ServiceAccount, nowSeconds: number): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: account.clientEmail, scope: FCM_SCOPE, aud: account.tokenUri, iat: nowSeconds, exp: nowSeconds + ASSERTION_LIFETIME_S }));
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(account.privateKey);
  return `${header}.${claims}.${b64url(signature)}`;
}

export interface FcmSenderOptions {
  projectId: string;
  /** Absent = the runtime's own identity (metadata server). */
  account?: ServiceAccount | undefined;
  fetch?: typeof fetch;
  now?: () => Date;
}

export class FcmPushSender implements PushSender {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private cached: { token: string; expiresAt: number } | null = null;

  constructor(private readonly options: FcmSenderOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async send(delivery: PushDelivery): Promise<PushOutcome> {
    const accessToken = await this.accessToken();
    if (!accessToken) return 'failed';
    const response = await this.fetchImpl(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.options.projectId)}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: fcmMessage(delivery) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok) return 'sent';
    if (response.status === 401) this.cached = null;
    return outcomeOfError(response.status, await response.text().catch(() => ''));
  }

  private async accessToken(): Promise<string | null> {
    const nowMs = this.now().getTime();
    if (this.cached && this.cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > nowMs) return this.cached.token;
    const { account } = this.options;
    const response = account
      ? await this.fetchImpl(account.tokenUri, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signAssertion(account, Math.floor(nowMs / 1000)) }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
      : await this.fetchImpl(METADATA_TOKEN_URL, { headers: { 'metadata-flavor': 'Google' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) return null;
    const body = (await response.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
    if (!body || typeof body.access_token !== 'string') return null;
    const lifetimeMs = (typeof body.expires_in === 'number' ? body.expires_in : ASSERTION_LIFETIME_S) * 1000;
    this.cached = { token: body.access_token, expiresAt: nowMs + lifetimeMs };
    return body.access_token;
  }
}

export function fcmMessage(delivery: PushDelivery): Record<string, unknown> {
  return {
    token: delivery.token,
    notification: { title: delivery.title, body: delivery.body },
    data: delivery.data,
    android: { priority: 'HIGH' },
    apns: { headers: { 'apns-priority': '10' }, payload: { aps: { sound: 'default' } } },
  };
}

/** UNREGISTERED (or a 404) means the token is gone for good. Anything else, a bad payload included, keeps the row. */
export function outcomeOfError(status: number, text: string): PushOutcome {
  if (status === 404) return 'invalid_token';
  try {
    const details = (JSON.parse(text) as { error?: { details?: Array<{ errorCode?: unknown }> } }).error?.details ?? [];
    if (details.some((d) => d.errorCode === 'UNREGISTERED')) return 'invalid_token';
  } catch {
    // not JSON: a proxy's page; the row stays
  }
  return 'failed';
}
