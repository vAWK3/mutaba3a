import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/**
 * ADR-037 decision 1 / TD-018: accounts are operator-issued only. No route
 * outside the operator surface (`/admin/`) may let anyone sign up, register,
 * be invited or reset a password, in any environment. This walks both the
 * router and the published contract so neither can grow one unnoticed.
 */
const FORBIDDEN = /sign-?up|register|invite|forgot|reset/i;

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
    const offenders = paths.filter((p) => !p.startsWith('/admin/') && FORBIDDEN.test(p));
    expect(offenders).toEqual([]);
  });

  it('the published contract has no signup, invite or reset path outside /admin/', async () => {
    const doc = (await (await inventory().request('/openapi.json')).json()) as { paths: Record<string, unknown> };
    const paths = Object.keys(doc.paths);
    expect(paths.length).toBeGreaterThan(50);
    const offenders = paths.filter((p) => !p.startsWith('/admin/') && FORBIDDEN.test(p));
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
  it('the public operations are exactly sign-in and the setup-link pair', async () => {
    const doc = (await (await inventory().request('/openapi.json')).json()) as {
      paths: Record<string, Record<string, { security?: unknown[] }>>;
    };
    const publicOperations = Object.entries(doc.paths)
      .filter(([path]) => path.startsWith('/v1/'))
      .flatMap(([path, methods]) => Object.entries(methods).map(([method, op]) => ({ key: `${method.toUpperCase()} ${path}`, security: op.security })))
      .filter((op) => Array.isArray(op.security) && op.security.length === 0)
      .map((op) => op.key)
      .sort();
    expect(publicOperations).toEqual(['POST /v1/account-setup', 'POST /v1/account-setup/check', 'POST /v1/device-sessions', 'POST /v1/sessions']);
  });
});
