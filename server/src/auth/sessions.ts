import { createHmac, randomBytes } from 'node:crypto';

/**
 * Browser sessions on the hosted service (MUT-38, ADR-033 decisions 3–4,
 * hosted-portal.md §4). A session is a server-side record; the browser holds
 * only an opaque random token in an httpOnly cookie on the API's own origin,
 * and the store holds only its HMAC digest.
 */

/** 32 random bytes → 43 base64url characters. */
const SESSION_TOKEN_BYTES = 32;

export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

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
