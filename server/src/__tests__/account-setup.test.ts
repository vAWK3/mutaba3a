import { describe, expect, it } from 'vitest';
import { generateSetupToken, NEW_PASSWORD_POLICY, SETUP_LINK_POLICY, setupLinkOrigin, setupLinkState, setupUrl } from '../auth/account-setup.js';
import { NewPasswordSchema } from '../schemas.js';
import type { PersonSetupLinkRecord, UserRecord } from '../repositories/ports.js';

/** MUT-235 (ADR-088): the pure rules behind a setup link. */
const at = (hour: number) => new Date(Date.UTC(2026, 9, 16, hour, 0, 0));

const link = (overrides: Partial<PersonSetupLinkRecord> = {}): PersonSetupLinkRecord => ({
  id: 'l1',
  userId: 'u1',
  email: null,
  locale: null,
  mailed: false,
  tokenDigest: 'd'.repeat(64),
  purpose: 'SETUP',
  createdAt: at(0),
  expiresAt: at(72),
  usedAt: null,
  cancelledAt: null,
  ...overrides,
});

const person = (status: UserRecord['status'] = 'ACTIVE') => ({ status });

describe('generateSetupToken (MUT-235)', () => {
  it('is 43 base64url characters (256 bits)', () => {
    expect(generateSetupToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('never repeats', () => {
    const tokens = new Set(Array.from({ length: 1000 }, generateSetupToken));
    expect(tokens.size).toBe(1000);
  });
});

describe('setupLinkState (MUT-235)', () => {
  it('is valid before expiry for an active person', () => {
    expect(setupLinkState(link(), person(), at(71))).toBe('valid');
  });

  it('is expired at exactly the expiry instant and after it', () => {
    expect(setupLinkState(link(), person(), at(72))).toBe('expired');
    expect(setupLinkState(link(), person(), at(100))).toBe('expired');
  });

  it('is used once used, even after it would have expired', () => {
    expect(setupLinkState(link({ usedAt: at(1) }), person(), at(2))).toBe('used');
    expect(setupLinkState(link({ usedAt: at(1) }), person(), at(100))).toBe('used');
  });

  it('is superseded when a newer link cancelled it', () => {
    expect(setupLinkState(link({ cancelledAt: at(1) }), person(), at(2))).toBe('superseded');
  });

  it('is invalid for an unknown link or a person who is not active', () => {
    expect(setupLinkState(null, null, at(1))).toBe('invalid');
    expect(setupLinkState(link(), null, at(1))).toBe('invalid');
    expect(setupLinkState(link(), person('DISABLED'), at(1))).toBe('invalid');
  });
});

describe('setupUrl (MUT-235)', () => {
  it('carries the token in the fragment only', () => {
    const token = generateSetupToken();
    const url = new URL(setupUrl('https://portal.example', token));
    expect(url.pathname).toBe('/setup');
    expect(url.search).toBe('');
    expect(url.hash).toBe(`#${token}`);
  });

  it('ignores a trailing slash on the origin', () => {
    expect(setupUrl('https://portal.example/', 'abc')).toBe('https://portal.example/setup#abc');
  });
});

describe('setupLinkOrigin (MUT-235 review)', () => {
  it('uses PORTAL_ORIGIN when configured', () => {
    expect(setupLinkOrigin('https://portal.example', 'http://api.run.app/admin/v1/users')).toBe('https://portal.example');
  });

  it('upgrades a plain-http request to https on any real host (TLS ended at the proxy)', () => {
    expect(setupLinkOrigin(undefined, 'http://mutaba3a-api.run.app/admin/v1/users')).toBe('https://mutaba3a-api.run.app');
    expect(setupLinkOrigin(undefined, 'http://api.example.com:8443/x')).toBe('https://api.example.com:8443');
  });

  it('keeps http on a loopback host, for local development', () => {
    expect(setupLinkOrigin(undefined, 'http://localhost:8787/x')).toBe('http://localhost:8787');
    expect(setupLinkOrigin(undefined, 'http://127.0.0.1:8787/x')).toBe('http://127.0.0.1:8787');
    expect(setupLinkOrigin(undefined, 'http://[::1]:8787/x')).toBe('http://[::1]:8787');
  });
});

describe('policies (MUT-235)', () => {
  it('a link lasts 72 hours by default, between 1 and 720', () => {
    expect(SETUP_LINK_POLICY).toEqual({ defaultHours: 72, minHours: 1, maxHours: 720 });
  });

  it('a new password is 12 to 128 characters with no composition rules', () => {
    expect(NEW_PASSWORD_POLICY).toEqual({ minLength: 12, maxLength: 128 });
    expect(NewPasswordSchema.safeParse('a'.repeat(11)).success).toBe(false);
    expect(NewPasswordSchema.safeParse('a'.repeat(12)).success).toBe(true);
    expect(NewPasswordSchema.safeParse('a'.repeat(128)).success).toBe(true);
    expect(NewPasswordSchema.safeParse('a'.repeat(129)).success).toBe(false);
    expect(NewPasswordSchema.safeParse('correct horse 🐎').success).toBe(true);
  });
});
