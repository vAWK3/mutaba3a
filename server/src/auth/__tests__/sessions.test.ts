import { describe, expect, it } from 'vitest';
import {
  SIGN_IN_POLICY,
  SignInThrottle,
  clientIp,
  generateSessionToken,
  isSameOriginRequest,
  sessionCookieName,
  sessionDigest,
} from '../sessions.js';

const PEPPER = 'p'.repeat(32);

describe('session tokens', () => {
  it('are 43 base64url characters and do not repeat', () => {
    const tokens = Array.from({ length: 1000 }, () => generateSessionToken());
    for (const t of tokens.slice(0, 5)) expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Set(tokens).size).toBe(1000);
  });

  it('digest deterministically under one pepper, differently under another, never equal to the token', () => {
    const token = generateSessionToken();
    const a = sessionDigest(PEPPER, token);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(sessionDigest(PEPPER, token)).toBe(a);
    expect(sessionDigest('q'.repeat(32), token)).not.toBe(a);
    expect(a).not.toBe(token);
  });
});

describe('sessionCookieName', () => {
  it('uses the __Host- prefix when the cookie is Secure', () => {
    expect(sessionCookieName(true)).toBe('__Host-mut_session');
    expect(sessionCookieName(false)).toBe('mut_session');
  });
});

describe('clientIp', () => {
  const headers = (xff?: string) => (name: string) => (name.toLowerCase() === 'x-forwarded-for' ? xff : undefined);

  it('takes the entry the trusted proxy appended, counting from the right', () => {
    expect(clientIp(headers('203.0.113.9, 198.51.100.7'), 1)).toBe('198.51.100.7');
    expect(clientIp(headers('203.0.113.9, 198.51.100.7'), 2)).toBe('203.0.113.9');
    expect(clientIp(headers(' 203.0.113.9 '), 1)).toBe('203.0.113.9');
  });

  it('never trusts a client-forged leftmost value beyond the hop count', () => {
    expect(clientIp(headers('6.6.6.6, 203.0.113.9, 198.51.100.7'), 1)).toBe('198.51.100.7');
  });

  it('answers unknown with no header, zero hops, or too few entries', () => {
    expect(clientIp(headers(undefined), 1)).toBe('unknown');
    expect(clientIp(headers('198.51.100.7'), 0)).toBe('unknown');
    expect(clientIp(headers('198.51.100.7'), 2)).toBe('unknown');
  });
});

describe('isSameOriginRequest', () => {
  const req = (h: Record<string, string>, url = 'https://portal.mutaba3a.app/v1/sessions') => ({
    url,
    header: (name: string) => h[name.toLowerCase()],
  });

  it('trusts Sec-Fetch-Site', () => {
    expect(isSameOriginRequest(req({ 'sec-fetch-site': 'same-origin' }), undefined)).toBe(true);
    for (const site of ['cross-site', 'same-site', 'none']) {
      expect(isSameOriginRequest(req({ 'sec-fetch-site': site, origin: 'https://portal.mutaba3a.app' }), undefined)).toBe(false);
    }
  });

  it('compares Origin with the configured portal origin', () => {
    expect(isSameOriginRequest(req({ origin: 'https://portal.mutaba3a.app' }), 'https://portal.mutaba3a.app')).toBe(true);
    expect(isSameOriginRequest(req({ origin: 'https://evil.example' }), 'https://portal.mutaba3a.app')).toBe(false);
  });

  it('falls back to the request origin when no portal origin is configured', () => {
    expect(isSameOriginRequest(req({ origin: 'https://portal.mutaba3a.app' }), undefined)).toBe(true);
    expect(isSameOriginRequest(req({ origin: 'https://evil.example' }), undefined)).toBe(false);
  });

  it('refuses a request that carries neither header', () => {
    expect(isSameOriginRequest(req({}), undefined)).toBe(false);
  });
});

describe('SignInThrottle', () => {
  const t0 = new Date('2026-10-11T09:00:00Z');
  const plus = (ms: number) => new Date(t0.getTime() + ms);
  const minute = 60_000;

  it('locks on the fifth failure within the window and reports the lock time', () => {
    const throttle = new SignInThrottle();
    for (let i = 0; i < SIGN_IN_POLICY.maxFailures - 1; i++) expect(throttle.recordFailure('a@firm.ps', plus(i * minute))).toBeNull();
    expect(throttle.isLocked('a@firm.ps', plus(4 * minute))).toBe(false);
    const lockedUntil = throttle.recordFailure('a@firm.ps', plus(4 * minute));
    expect(lockedUntil?.toISOString()).toBe(plus(4 * minute + SIGN_IN_POLICY.lockMs).toISOString());
    expect(throttle.isLocked('a@firm.ps', plus(4 * minute + SIGN_IN_POLICY.lockMs - 1))).toBe(true);
    expect(throttle.isLocked('a@firm.ps', plus(4 * minute + SIGN_IN_POLICY.lockMs))).toBe(false);
  });

  it('forgets failures older than the window', () => {
    const throttle = new SignInThrottle();
    for (let i = 0; i < 4; i++) throttle.recordFailure('a@firm.ps', plus(i * minute));
    expect(throttle.recordFailure('a@firm.ps', plus(SIGN_IN_POLICY.windowMs + 10 * minute))).toBeNull();
  });

  it('clears on success and keeps keys independent', () => {
    const throttle = new SignInThrottle();
    for (let i = 0; i < 4; i++) throttle.recordFailure('a@firm.ps', t0);
    throttle.clear('a@firm.ps');
    expect(throttle.recordFailure('a@firm.ps', t0)).toBeNull();
    for (let i = 0; i < 5; i++) throttle.recordFailure('b@firm.ps', t0);
    expect(throttle.isLocked('b@firm.ps', t0)).toBe(true);
    expect(throttle.isLocked('a@firm.ps', t0)).toBe(false);
  });
});
