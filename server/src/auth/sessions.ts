import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Browser sessions on the hosted service (MUT-38, ADR-037 decisions 3–4,
 * hosted-portal.md §4). A session is a server-side record; the browser holds
 * only an opaque random token in an httpOnly cookie on the API's own origin,
 * and the store holds only its HMAC digest.
 */

/** 32 random bytes → 43 base64url characters. */
const SESSION_TOKEN_BYTES = 32;

export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

/** cookie: the browser portal session (MUT-38); device: a native app's bearer token (MUT-64). */
export type SessionKind = 'cookie' | 'device';

/**
 * A device session's bearer token (MUT-64). `mds_` is visually and
 * structurally distinct from an API key's `mut_` prefix, so authenticate()
 * routes a bearer token by its prefix instead of guessing — trying it as one
 * kind of credential, then the other.
 */
const DEVICE_SESSION_PREFIX = 'mds_';

export function generateDeviceSessionToken(): string {
  return DEVICE_SESSION_PREFIX + randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

export function isDeviceSessionToken(token: string): boolean {
  return token.startsWith(DEVICE_SESSION_PREFIX) && token.length === DEVICE_SESSION_PREFIX.length + 43;
}

/** Longer than a browser session (SIGN_IN_POLICY's cookie lifetime lives in SessionSettings): capture happens days apart. */
export const DEFAULT_DEVICE_IDLE_DAYS = 30;
export const DEFAULT_DEVICE_ABSOLUTE_DAYS = 180;

/**
 * HMAC-SHA256 under SESSION_TOKEN_PEPPER, hex. Random 256-bit tokens need no
 * pepper for secrecy; it exists so that rotating it signs everyone out at once.
 */
export function sessionDigest(pepper: string, token: string): string {
  return createHmac('sha256', pepper).update(token).digest('hex');
}

const COOKIE_BASENAME = 'mut_session';

/** `__Host-` binds the cookie to this exact origin; browsers accept it only with Secure, Path=/ and no Domain. */
export function sessionCookieName(secure: boolean): string {
  return secure ? `__Host-${COOKIE_BASENAME}` : COOKIE_BASENAME;
}

/** Sign-in throttling and lockout (hosted-portal.md §4.3). Keys are normalised emails, whether or not an account exists. */
export const SIGN_IN_POLICY = {
  maxFailures: 5,
  windowMs: 15 * 60_000,
  lockMs: 15 * 60_000,
  ipPerMinute: 20,
} as const;

/** Header reader shape shared by Hono's `c.req.header` and plain test doubles. */
export type HeaderReader = (name: string) => string | undefined;

/**
 * The client IP is the entry the trusted front proxy appended to
 * X-Forwarded-For, counting `trustedHops` from the right; anything to its left
 * is client-supplied and can be forged.
 */
export function clientIp(header: HeaderReader, trustedHops: number): string {
  if (trustedHops < 1) return 'unknown';
  const entries = (header('x-forwarded-for') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return entries[entries.length - trustedHops] ?? 'unknown';
}

/**
 * CSRF rule for cookie-authenticated writes and for sign-in: the browser's own
 * Sec-Fetch-Site wins when present; otherwise Origin must equal the portal
 * origin (or, unconfigured, this request's origin). No signal → refused.
 */
export function isSameOriginRequest(req: { url: string; header: HeaderReader }, portalOrigin: string | undefined): boolean {
  const site = req.header('sec-fetch-site');
  if (site) return site === 'same-origin';
  const origin = req.header('origin');
  if (!origin) return false;
  return origin === (portalOrigin ?? new URL(req.url).origin);
}

/**
 * MUT-326 (ADR-155 D3): the custom domain's front door (a Cloudflare Worker,
 * server/infrastructure/frontdoor/worker) proves itself with this header and hands
 * over the client address it read at its edge. While run.app stays reachable
 * directly, one TRUSTED_PROXY_HOPS can't fit both paths: the front door adds a hop,
 * and counting it on the direct path would trust a forged X-Forwarded-For entry.
 */
export const FRONT_DOOR_HEADER = 'x-mutaba3a-front-door';
export const FRONT_DOOR_CLIENT_IP_HEADER = 'x-mutaba3a-client-ip';

/**
 * MUT-326 stage "redirect": where an old-host portal visit lands first. The page (built
 * with the carry-over, MUT-112/MUT-291, design §7) checks this origin's local records,
 * offers to carry them over, then sends the browser on to PORTAL_ORIGIN + `next`.
 */
export const LEGACY_CARRY_OVER_PATH = '/carry-over';

/** The settings that decide where a request came from (a subset of SessionSettings). */
export interface RequestPathSettings {
  trustedProxyHops: number;
  /** The front door's shared secret (FRONT_DOOR_TOKEN); unset until the custom domain exists. */
  frontDoorToken?: string;
}

const digest = (value: string) => createHash('sha256').update(value).digest();
/** One IPv4 or IPv6 address, nothing else (the front door sends CF-Connecting-IP). */
const IP_ADDRESS = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]*:[0-9a-f:.]*)$/i;

/** True only when the front door's token matches; compared as fixed-length digests, in constant time. */
export function isViaFrontDoor(header: HeaderReader, token: string | undefined): boolean {
  const presented = header(FRONT_DOOR_HEADER);
  if (!token || !presented) return false;
  return timingSafeEqual(digest(presented), digest(token));
}

/** The caller's address: the front door's word for it when the token matches, else X-Forwarded-For as before. */
export function requestClientIp(header: HeaderReader, settings: RequestPathSettings): string {
  if (!isViaFrontDoor(header, settings.frontDoorToken)) return clientIp(header, settings.trustedProxyHops);
  const ip = header(FRONT_DOOR_CLIENT_IP_HEADER)?.trim() ?? '';
  return ip.length <= 45 && IP_ADDRESS.test(ip) ? ip : 'unknown';
}

/**
 * isSameOriginRequest for the portal's own routes. With a front door the expected
 * origin depends on the path: PORTAL_ORIGIN through it (the Worker rewrites Host to
 * run.app), the request's own origin on direct run.app traffic. Without one,
 * unchanged: PORTAL_ORIGIN when set, else the request's own origin.
 */
export function isSamePortalOrigin(
  req: { url: string; header: HeaderReader },
  settings: { portalOrigin?: string; frontDoorToken?: string },
): boolean {
  if (!settings.frontDoorToken) return isSameOriginRequest(req, settings.portalOrigin);
  return isSameOriginRequest(req, isViaFrontDoor(req.header, settings.frontDoorToken) ? settings.portalOrigin : undefined);
}

/**
 * In-process failure counter and lock per key (one instance until TD-017).
 * A real account's lock is also persisted on the user row by the caller.
 */
export class SignInThrottle {
  private readonly failures = new Map<string, number[]>();
  private readonly locks = new Map<string, number>();

  constructor(private readonly policy: { maxFailures: number; windowMs: number; lockMs: number } = SIGN_IN_POLICY) {}

  isLocked(key: string, now: Date): boolean {
    const until = this.locks.get(key);
    if (until === undefined) return false;
    if (now.getTime() < until) return true;
    this.locks.delete(key);
    return false;
  }

  /** Records a failure; returns the lock-until time when this failure triggers a lock, else null. */
  recordFailure(key: string, now: Date): Date | null {
    const t = now.getTime();
    const recent = (this.failures.get(key) ?? []).filter((s) => s > t - this.policy.windowMs);
    recent.push(t);
    if (recent.length < this.policy.maxFailures) {
      this.failures.set(key, recent);
      return null;
    }
    this.failures.delete(key);
    const until = t + this.policy.lockMs;
    this.locks.set(key, until);
    return new Date(until);
  }

  clear(key: string): void {
    this.failures.delete(key);
    this.locks.delete(key);
  }

  /** Drops expired locks and stale counters; call periodically from the server loop. */
  prune(now: Date): void {
    const t = now.getTime();
    for (const [key, until] of this.locks) if (until <= t) this.locks.delete(key);
    for (const [key, stamps] of this.failures) if (stamps.every((s) => s <= t - this.policy.windowMs)) this.failures.delete(key);
  }
}
