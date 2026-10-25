import { lookup as dnsLookup } from 'node:dns';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { isIPv4, isIPv6 } from 'node:net';
import { isAcceptableRedirectUri, sanitizeClientName } from './protocol.js';

/**
 * MUT-434: who an OAuth client is, for the consent screen, and the guarded fetch of a Client ID Metadata Document
 * (S1/D2). Ported by pattern from Malafat's MAL-176/178/224 modules, not shared code.
 *
 * Trust is keyed on the redirect destination, never on the self-declared name (MAL-224): anyone may register as
 * "Claude", but a code delivered to claude.ai can't be collected by them.
 */

export type ClientTrust = 'VERIFIED' | 'LOOPBACK' | 'UNVERIFIED';

/**
 * Hosts whose operators are established. A code constant on purpose: identical in every environment, so making it
 * configurable would only add a way to weaken a security boundary without review. Exact host equality, no wildcards.
 * Claude's callback is claude.ai today and may move to claude.com (Anthropic's connector docs).
 */
export const KNOWN_CLIENT_REDIRECT_HOSTS: readonly string[] = ['claude.ai', 'claude.com'];

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

/** Computed per request from the redirect actually in play, so no stored verdict can drift. */
export function clientTrust(redirectUri: string): ClientTrust {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return 'UNVERIFIED';
  }
  if (url.protocol === 'https:' && KNOWN_CLIENT_REDIRECT_HOSTS.includes(url.hostname)) return 'VERIFIED';
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return 'LOOPBACK';
  return 'UNVERIFIED';
}

// ---- Client ID Metadata Documents ------------------------------------------------

export type CimdRejectionReason =
  | 'not_https'
  | 'invalid_url'
  | 'private_address'
  | 'redirect_not_allowed'
  | 'too_large'
  | 'timeout'
  | 'bad_content_type'
  | 'malformed_document'
  | 'fetch_failed';

export interface ClientMetadata {
  clientId: string;
  clientName: string;
  redirectUris: string[];
}

/** S1: 10 KB and 5 s, the bounds approved in the eng review (D2). */
export const MAX_CIMD_BYTES = 10 * 1024;
export const CIMD_TIMEOUT_MS = 5_000;
export const MAX_CIMD_URL_LENGTH = 2048;
const MAX_CIMD_REDIRECT_URIS = 10;
/** Cache bounds (OV2): a day at most, an hour without a Cache-Control header. */
const CIMD_CACHE_MAX_MS = 24 * 3_600_000;
const CIMD_CACHE_DEFAULT_MS = 3_600_000;

/** A client_id that is an https URL with a path is a CIMD client id (spec 2026-07-28, client registration). */
export function isCimdClientId(clientId: string): boolean {
  if (!clientId.startsWith('https://') || clientId.length > MAX_CIMD_URL_LENGTH) return false;
  const parsed = parseCimdUrl(clientId);
  return parsed.ok && parsed.url.pathname.length > 1;
}

/**
 * First gate: a bare absolute https URL. Credentials, fragments and non-default ports are refused (a metadata document
 * has no reason to live on another port, and allowing one turns the fetcher into a port scanner).
 */
export function parseCimdUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: CimdRejectionReason } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'not_https' };
  if (url.username !== '' || url.password !== '' || url.hash !== '' || raw.includes('#') || url.port !== '') return { ok: false, reason: 'invalid_url' };
  return { ok: true, url };
}

/**
 * The SSRF guard: true only for plausibly public unicast addresses, failing closed. IPv4-mapped IPv6 is unwrapped and
 * judged as IPv4, or ::ffff:169.254.169.254 would walk past a v4-only list.
 */
export function isPublicUnicastAddress(address: string, family: number): boolean {
  if (family === 6 || isIPv6(address)) {
    const normalised = address.toLowerCase().split('%')[0] ?? '';
    if (!isIPv6(normalised)) return false;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalised);
    if (mapped?.[1]) return isPublicUnicastAddress(mapped[1], 4);
    if (normalised === '::1' || normalised === '::') return false;
    if (/^fe[89ab]/.test(normalised)) return false; // fe80::/10 link-local
    if (/^f[cd]/.test(normalised)) return false; // fc00::/7 unique local
    if (normalised.startsWith('ff')) return false; // multicast
    return true;
  }
  if (!isIPv4(address)) return false;
  const [a = 0, b = 0] = address.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || b === 0)) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  return true;
}

/**
 * The fetched document's `client_id` must equal the URL it came from, or a client could host a document claiming
 * another's id. Only public clients: an auth method other than `none` is refused.
 */
export function validateClientMetadata(doc: unknown, cimdUrl: string): { ok: true; metadata: ClientMetadata } | { ok: false; reason: 'malformed_document' } {
  const reject = { ok: false, reason: 'malformed_document' } as const;
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return reject;
  const d = doc as Record<string, unknown>;
  if (d.client_id !== cimdUrl) return reject;
  if (typeof d.client_name !== 'string' || d.client_name.trim() === '') return reject;
  if (d.token_endpoint_auth_method !== undefined && d.token_endpoint_auth_method !== 'none') return reject;
  const uris = d.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_CIMD_REDIRECT_URIS || !uris.every(isAcceptableRedirectUri)) return reject;
  return { ok: true, metadata: { clientId: cimdUrl, clientName: sanitizeClientName(d.client_name), redirectUris: [...new Set(uris as string[])] } };
}

/** When a fetched document goes stale (OV2): its max-age capped at a day, now on no-store/no-cache, an hour by default. */
export function cimdCacheUntil(cacheControl: string | undefined, at: Date): Date {
  const header = (cacheControl ?? '').toLowerCase();
  if (/\bno-(store|cache)\b/.test(header)) return new Date(at.getTime());
  const maxAge = /\bmax-age=(\d+)/.exec(header)?.[1];
  const ms = maxAge === undefined ? CIMD_CACHE_DEFAULT_MS : Math.min(Number(maxAge) * 1000, CIMD_CACHE_MAX_MS);
  return new Date(at.getTime() + ms);
}

export type CimdFetchResult = { ok: true; metadata: ClientMetadata; cacheControl: string | undefined } | { ok: false; reason: CimdRejectionReason };

export interface CimdFetchOptions {
  /** Injected only by tests; production uses node's dns.lookup and https.request. */
  lookupFn?: typeof dnsLookup;
  requestFn?: typeof httpsRequest;
  timeoutMs?: number;
}

const BLOCKED_ADDRESS_CODE = 'CIMD_BLOCKED_ADDRESS';
type LookupCallback = (err: NodeJS.ErrnoException | null, address?: string | Array<{ address: string; family: number }>, family?: number) => void;

/**
 * Wraps DNS so the addresses the socket actually connects to are the ones checked: resolving first and fetching after
 * would leave a rebinding window between the two.
 */
function guardedLookup(lookupFn: typeof dnsLookup) {
  return (hostname: string, options: unknown, callback?: LookupCallback): void => {
    const cb = (typeof options === 'function' ? options : callback) as LookupCallback;
    const opts = (typeof options === 'function' ? {} : (options ?? {})) as Record<string, unknown>;
    (lookupFn as unknown as (h: string, o: unknown, c: LookupCallback) => void)(hostname, { ...opts, all: true }, (err, addresses) => {
      if (err) return cb(err);
      const allowed = ((addresses ?? []) as Array<{ address: string; family: number }>).filter((a) => isPublicUnicastAddress(a.address, a.family));
      const first = allowed[0];
      if (!first) {
        const blocked: NodeJS.ErrnoException = new Error('CIMD target resolved to a non-public address');
        blocked.code = BLOCKED_ADDRESS_CODE;
        return cb(blocked);
      }
      if (opts.all === true) return cb(null, allowed);
      cb(null, first.address, first.family);
    });
  };
}

/**
 * Fetches a metadata document handed to us by an unauthenticated caller — an SSRF primitive by construction, so every
 * layer is a guard: the URL rule, the address check at connect time, no redirects, a byte cap, a wall-clock timeout,
 * a JSON content type, and the document rule.
 */
export function fetchClientMetadata(rawUrl: string, options: CimdFetchOptions = {}): Promise<CimdFetchResult> {
  const parsed = parseCimdUrl(rawUrl);
  if (!parsed.ok) return Promise.resolve({ ok: false, reason: parsed.reason });
  const { lookupFn = dnsLookup, requestFn = httpsRequest, timeoutMs = CIMD_TIMEOUT_MS } = options;
  const url = parsed.url;

  return new Promise((resolve) => {
    let settled = false;
    let req: ClientRequest | undefined;
    const finish = (result: CimdFetchResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      req?.destroy();
      finish({ ok: false, reason: 'timeout' });
    }, timeoutMs);
    try {
      req = requestFn(
        {
          protocol: 'https:',
          hostname: url.hostname,
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          headers: { accept: 'application/json', 'user-agent': 'MTB3A-MCP/1.0' },
          lookup: guardedLookup(lookupFn),
          timeout: timeoutMs,
        } as RequestOptions,
        (res: IncomingMessage) => readDocument(res, rawUrl, finish),
      );
    } catch {
      return finish({ ok: false, reason: 'fetch_failed' });
    }
    req.on('error', (err: NodeJS.ErrnoException) => finish({ ok: false, reason: err.code === BLOCKED_ADDRESS_CODE ? 'private_address' : 'fetch_failed' }));
    req.on('timeout', () => {
      req?.destroy();
      finish({ ok: false, reason: 'timeout' });
    });
    req.end();
  });
}

function readDocument(res: IncomingMessage, cimdUrl: string, finish: (r: CimdFetchResult) => void): void {
  const status = res.statusCode ?? 0;
  const refuse = (reason: CimdRejectionReason) => {
    res.destroy();
    finish({ ok: false, reason });
  };
  // Refused, not followed: a redirect is the standard way to walk a check into a private range.
  if (status >= 300 && status < 400) return refuse('redirect_not_allowed');
  if (status !== 200) return refuse('fetch_failed');
  if (!String(res.headers['content-type'] ?? '').toLowerCase().includes('application/json')) return refuse('bad_content_type');
  const declared = Number(res.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_CIMD_BYTES) return refuse('too_large');

  const chunks: Buffer[] = [];
  let total = 0;
  let aborted = false;
  res.on('data', (chunk: Buffer) => {
    if (aborted) return;
    total += chunk.length;
    if (total > MAX_CIMD_BYTES) {
      aborted = true;
      return refuse('too_large');
    }
    chunks.push(chunk);
  });
  res.on('error', () => finish({ ok: false, reason: 'fetch_failed' }));
  res.on('end', () => {
    if (aborted) return;
    let doc: unknown;
    try {
      doc = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return finish({ ok: false, reason: 'malformed_document' });
    }
    const validated = validateClientMetadata(doc, cimdUrl);
    const cacheControl = res.headers['cache-control'];
    finish(validated.ok ? { ok: true, metadata: validated.metadata, cacheControl: typeof cacheControl === 'string' ? cacheControl : undefined } : validated);
  });
}
