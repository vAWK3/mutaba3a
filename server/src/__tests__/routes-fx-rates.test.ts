import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { CachedFxRates, JOD_PER_USD, type EcbSnapshot, type FxRateSource } from '../fx-rates.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/** MUT-228 (ADR-086): GET /v1/fx-rates — reference rates for display, sessions only, no profile. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };
const SNAPSHOT: EcbSnapshot = { rateDate: '2026-10-15', perEur: { USD: 1.1208, ILS: 3.4769 } };
const NOW = new Date('2026-10-15T14:02:11Z');

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

/** `fxRates: 'absent'` passes null, as an app with no rate source configured. */
function harness(options: { providerDown?: boolean; fxRates?: 'absent' } = {}) {
  const provider = { calls: 0, down: options.providerDown ?? false };
  const clock = { now: NOW };
  const source: FxRateSource = {
    async latest() {
      provider.calls += 1;
      if (provider.down) throw new Error('provider down');
      return SNAPSHOT;
    },
  };
  const app = createApp({
    store: new MemoryLedgerStore(),
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1 },
    fxRates: options.fxRates === 'absent' ? null : new CachedFxRates({ source, ttlMs: 4 * 60 * 60 * 1000, now: () => clock.now }),
  });
  return { app, provider, clock };
}

async function signedIn(h: ReturnType<typeof harness>) {
  const org = await read(await h.app.request('/admin/v1/organizations', json({ name: 'Haddad Law', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
  const key = await read(await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)));
  const email = 'nour@haddad.ps';
  const created = await read(await h.app.request('/admin/v1/users', json({ email, displayName: 'Nour Haddad', organizationId: org.id, locale: 'en' }, admin)));
  const res = await h.app.request('/v1/sessions', json({ email, password: created.initialPassword }, SAME_ORIGIN));
  const cookie = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const device = await read(await h.app.request('/v1/device-sessions', json({ email, password: created.initialPassword })));
  return {
    orgId: org.id as string,
    asCookie: { cookie: `${COOKIE}=${cookie}`, ...SAME_ORIGIN },
    asDevice: { authorization: `Bearer ${device.token}` },
    asKey: { authorization: `Bearer ${key.secret}` },
  };
}

const rates = (h: ReturnType<typeof harness>, query: string, headers: Record<string, string>) => h.app.request(`/v1/fx-rates${query}`, { headers });

describe('GET /v1/fx-rates', () => {
  it('answers a device session with every supported currency against the base, no profile header needed', async () => {
    const h = harness();
    const s = await signedIn(h);
    const res = await rates(h, '?base=ILS', s.asDevice);
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({
      base: 'ILS',
      rateDate: '2026-10-15',
      fetchedAt: '2026-10-15T14:02:11.000Z',
      source: 'live',
      rates: [
        { currency: 'ILS', rate: 1, derived: false },
        { currency: 'USD', rate: 0.322356, derived: false },
        { currency: 'EUR', rate: 0.287613, derived: false },
        { currency: 'JOD', rate: 0.22855, derived: true },
      ],
    });
  });

  it('answers a cookie session the same way, with or without a profile header', async () => {
    const h = harness();
    const s = await signedIn(h);
    const bare = await rates(h, '?base=USD', s.asCookie);
    expect(bare.status).toBe(200);
    expect((await read(bare)).rates.find((r: Loose) => r.currency === 'JOD')).toEqual({ currency: 'JOD', rate: 0.709, derived: true });
    expect((await rates(h, '?base=USD', { ...s.asCookie, 'x-mutaba3a-profile': s.orgId })).status).toBe(200);
  });

  it('asks the provider once for many requests inside the window', async () => {
    const h = harness();
    const s = await signedIn(h);
    for (const base of ['ILS', 'USD', 'EUR', 'JOD', 'ILS']) expect((await rates(h, `?base=${base}`, s.asDevice)).status).toBe(200);
    expect(h.provider.calls).toBe(1);
  });

  it.each([
    ['an unknown base', '?base=GBP'],
    ['a lower-case base', '?base=ils'],
    ['no base', ''],
  ])('refuses %s with 422 VALIDATION_FAILED', async (_label, query) => {
    const h = harness();
    const s = await signedIn(h);
    const res = await rates(h, query, s.asDevice);
    expect(res.status).toBe(422);
    expect((await read(res)).error.code).toBe('VALIDATION_FAILED');
    expect(h.provider.calls).toBe(0);
  });

  it('refuses no credentials with 401 and an API key with 403 PRINCIPAL_NOT_ACCEPTED', async () => {
    const h = harness();
    const s = await signedIn(h);
    expect((await rates(h, '?base=ILS', {})).status).toBe(401);
    const keyed = await rates(h, '?base=ILS', { ...s.asKey, 'x-mutaba3a-profile': s.orgId });
    expect(keyed.status).toBe(403);
    expect((await read(keyed)).error.code).toBe('PRINCIPAL_NOT_ACCEPTED');
  });

  it('answers 503 FX_RATES_UNAVAILABLE when the provider is down and nothing is cached, never a zero rate', async () => {
    const h = harness({ providerDown: true });
    const s = await signedIn(h);
    const res = await rates(h, '?base=ILS', s.asDevice);
    expect(res.status).toBe(503);
    expect((await read(res)).error.code).toBe('FX_RATES_UNAVAILABLE');
  });

  it('serves the last good rates as stale, with their original dates, when a refresh fails', async () => {
    const h = harness();
    const s = await signedIn(h);
    expect((await rates(h, '?base=ILS', s.asDevice)).status).toBe(200);
    h.clock.now = new Date(NOW.getTime() + 4 * 60 * 60 * 1000);
    h.provider.down = true;
    const res = await rates(h, '?base=ILS', s.asDevice);
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({ source: 'stale', rateDate: '2026-10-15', fetchedAt: '2026-10-15T14:02:11.000Z' });
    expect(h.provider.calls).toBe(2);
  });

  it('documents the JOD peg the code uses', async () => {
    const doc = await read(await harness().app.request('/openapi.json'));
    expect(doc.components.schemas.FxRate.properties.derived.description).toContain(`1 USD = ${JOD_PER_USD} JOD`);
  });

  it('answers 503 FX_RATES_UNAVAILABLE when the app has no rate source configured', async () => {
    const h = harness({ fxRates: 'absent' });
    const s = await signedIn(h);
    const res = await rates(h, '?base=ILS', s.asDevice);
    expect(res.status).toBe(503);
    expect((await read(res)).error.code).toBe('FX_RATES_UNAVAILABLE');
  });
});
