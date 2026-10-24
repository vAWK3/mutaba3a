import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/**
 * ADR-037 decision 1 / TD-018: accounts were operator-issued only. ADR-159 (MUT-366, ADR-175) opened exactly two
 * public doors, reviewed and named here: POST /v1/signups (behind SELF_SIGNUP_ENABLED) and POST /v1/account-recovery.
 * No other route outside the operator surface (`/admin/`) may let anyone sign up, register, be invited or reset a
 * password, in any environment. This walks both the router and the published contract so neither can grow one unnoticed.
 */
const FORBIDDEN = /sign-?up|register|invite|forgot|reset/i;
/** MUT-366: the reviewed exceptions. (`/v1/account-recovery` doesn't match the pattern, but it is the other door.) */
const REVIEWED_SELF_SERVICE_PATHS: ReadonlySet<string> = new Set(['/v1/signups']);

function inventory() {
  const app = createApp({
    store: new MemoryLedgerStore(),
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1),
    adminToken: 'x'.repeat(32),
    keyEnvironment: 'test',
    version: 'test',
  });
  return app;
}

describe('no self-registration route exists (MUT-37)', () => {
  it('the router has no signup, invite or reset path outside /admin/', () => {
    const paths = [...new Set(inventory().routes.map((r) => r.path))];
    expect(paths.length).toBeGreaterThan(50);
    const offenders = paths.filter((p) => !p.startsWith('/admin/') && !REVIEWED_SELF_SERVICE_PATHS.has(p) && FORBIDDEN.test(p));
    expect(offenders).toEqual([]);
  });

  it('the published contract has no signup, invite or reset path outside /admin/', async () => {
    const doc = (await (await inventory().request('/openapi.json')).json()) as { paths: Record<string, unknown> };
    const paths = Object.keys(doc.paths);
    expect(paths.length).toBeGreaterThan(50);
    const offenders = paths.filter((p) => !p.startsWith('/admin/') && !REVIEWED_SELF_SERVICE_PATHS.has(p) && FORBIDDEN.test(p));
    expect(offenders).toEqual([]);
  });

  it('the operator surface is where account creation lives', async () => {
    const doc = (await (await inventory().request('/openapi.json')).json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toContain('/admin/v1/users');
  });

  /**
   * MUT-235 (ADR-088): the only operations anyone can call without a credential
   * are signing in and redeeming an operator-issued setup link. A new public
   * operation — a signup, an invite, a "forgot password" — fails this test.
   */
  // MUT-287 (MUT-285 D3, ADR-097 §7): GET /v1/public/fx-rates is public market data for the signed-out portal, read-only and rate-limited; it creates no account.
  // MUT-360 (ADR-165): the Stripe webhook is public too; its credential is Stripe-Signature, and it creates no user account.
  // MUT-359 (D19): so is Resend's bounce webhook; its credential is the Svix signature, and it only suppresses addresses.
  // MUT-366 (ADR-159): signup and recovery. Both only mail a link that ends on the setup-link redeem; neither signs anyone in.
  // MUT-368 (D1): GET /v1/self-service says which of those two doors this server opens; it reads config, nothing else.
  it('the public operations are exactly sign-in, the setup-link pair, signup and recovery and their doors, the public FX snapshot and the Stripe and Resend webhooks', async () => {
    const doc = (await (await inventory().request('/openapi.json')).json()) as {
      paths: Record<string, Record<string, { security?: unknown[] }>>;
    };
    const publicOperations = Object.entries(doc.paths)
      .filter(([path]) => path.startsWith('/v1/'))
      .flatMap(([path, methods]) => Object.entries(methods).map(([method, op]) => ({ key: `${method.toUpperCase()} ${path}`, security: op.security })))
      .filter((op) => Array.isArray(op.security) && op.security.length === 0)
      .map((op) => op.key)
      .sort();
    expect(publicOperations).toEqual([
      'GET /v1/public/fx-rates',
      'GET /v1/self-service',
      'POST /v1/account-recovery',
      'POST /v1/account-setup',
      'POST /v1/account-setup/check',
      'POST /v1/billing/stripe/webhook',
      'POST /v1/device-sessions',
      'POST /v1/email/resend/webhook',
      'POST /v1/sessions',
      'POST /v1/signups',
    ]);
  });

  it('the reviewed exceptions are exactly the two self-service doors', () => {
    const paths = new Set(inventory().routes.map((r) => r.path));
    expect([...REVIEWED_SELF_SERVICE_PATHS].every((p) => paths.has(p))).toBe(true);
    expect(paths.has('/v1/account-recovery')).toBe(true);
  });

  /** MUT-366 (ADR-159 §7): signup stays shut until the operator opens it; recovery is never behind the switch. */
  it('signup answers 404 while SELF_SIGNUP_ENABLED is off (the default)', async () => {
    const res = await inventory().request('/v1/signups', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost' },
      body: JSON.stringify({ email: 'someone@studio.example', locale: 'en', turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });
});
