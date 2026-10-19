import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { CachedFxRates, USD_PEGS, type EcbSnapshot, type FxRateSource } from '../fx-rates.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/** MUT-228 (ADR-087): GET /v1/fx-rates — reference rates for display, sessions only, no profile. */
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
function harness(options: { providerDown?: boolean; fxRates?: 'absent'; publicPerMinute?: number } = {}) {
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
    publicFxIpLimiter: new SlidingWindowRateLimiter(options.publicPerMinute ?? 1_000_000),
  });
  return { app, provider, clock };
}

async function signedIn(h: ReturnType<typeof harness>) {
  const org = await read(await h.app.request('/admin/v1/organizations', json({ name: 'Haddad Law', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
  const key = await read(await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)));
  const email = 'nour@haddad.ps';
  const created = await provisionUser(h.app, { email, displayName: 'Nour Haddad', organizationId: org.id, locale: 'en' });
  const res = await h.app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
  const cookie = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const device = await read(await h.app.request('/v1/device-sessions', json({ email, password: created.password })));
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
        { currency: 'AED', rate: 1.183853, derived: true },
        { currency: 'SAR', rate: 1.208835, derived: true },
        { currency: 'QAR', rate: 1.173376, derived: true },
        { currency: 'BHD', rate: 0.121206, derived: true },
        { currency: 'OMR', rate: 0.123946, derived: true },
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

  it.each(['AED', 'BHD'])('answers base %s with all nine currencies, every row but the base derived (MUT-280)', async (base) => {
    const h = harness();
    const s = await signedIn(h);
    const res = await rates(h, `?base=${base}`, s.asDevice);
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.rates.map((r: Loose) => r.currency)).toEqual(['ILS', 'USD', 'EUR', 'JOD', 'AED', 'SAR', 'QAR', 'BHD', 'OMR']);
    expect(body.rates.filter((r: Loose) => r.derived).map((r: Loose) => r.currency)).not.toContain(base);
    expect(body.rates.filter((r: Loose) => r.derived)).toHaveLength(8);
  });

  it('answers 503 for a pegged base too when the provider is down and nothing is cached (MUT-280)', async () => {
    const h = harness({ providerDown: true });
    const s = await signedIn(h);
    const res = await rates(h, '?base=AED', s.asDevice);
    expect(res.status).toBe(503);
    expect((await read(res)).error.code).toBe('FX_RATES_UNAVAILABLE');
  });

  it('asks the provider once for many requests inside the window', async () => {
    const h = harness();
    const s = await signedIn(h);
    for (const base of ['ILS', 'USD', 'EUR', 'JOD', 'ILS']) expect((await rates(h, `?base=${base}`, s.asDevice)).status).toBe(200);
    expect(h.provider.calls).toBe(1);
  });

  it.each([
    ['an unknown base', '?base=GBP'],
    ['KWD, which has no fixed USD rate (MUT-280)', '?base=KWD'],
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

  it('documents every USD peg the code uses', async () => {
    const doc = await read(await harness().app.request('/openapi.json'));
    const description: string = doc.components.schemas.FxRate.properties.derived.description;
    for (const [currency, peg] of Object.entries(USD_PEGS)) expect(description).toContain(`${peg} ${currency}`);
  });

  it('answers 503 FX_RATES_UNAVAILABLE when the app has no rate source configured', async () => {
    const h = harness({ fxRates: 'absent' });
    const s = await signedIn(h);
    const res = await rates(h, '?base=ILS', s.asDevice);
    expect(res.status).toBe(503);
    expect((await read(res)).error.code).toBe('FX_RATES_UNAVAILABLE');
  });
});

/** MUT-287 (MUT-285 D3, ADR-097 §7): the raw ECB snapshot, anonymous, for the portal's signed-out FX source. */
describe('GET /v1/public/fx-rates', () => {
  const publicRates = (h: ReturnType<typeof harness>, headers: Record<string, string> = {}) => h.app.request('/v1/public/fx-rates', { headers });

  it('answers with no session and no profile header: the cached ECB snapshot, not cross rates', async () => {
    const h = harness();
    const res = await publicRates(h);
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ rateDate: '2026-10-15', perEur: { USD: 1.1208, ILS: 3.4769 }, fetchedAt: '2026-10-15T14:02:11.000Z', source: 'live' });
  });

  it('reads the same cache as /v1/fx-rates, so it never adds a provider call', async () => {
    const h = harness();
    const s = await signedIn(h);
    expect((await publicRates(h)).status).toBe(200);
    expect((await rates(h, '?base=USD', s.asDevice)).status).toBe(200);
    expect(h.provider.calls).toBe(1);
  });

  it('answers 503 FX_RATES_UNAVAILABLE when the app has no rate source configured', async () => {
    const h = harness({ fxRates: 'absent' });
    const res = await publicRates(h);
    expect(res.status).toBe(503);
    expect((await read(res)).error.code).toBe('FX_RATES_UNAVAILABLE');
  });

  it('answers 503 FX_RATES_UNAVAILABLE when the provider is down and nothing is cached', async () => {
    const h = harness({ providerDown: true });
    const res = await publicRates(h);
    expect(res.status).toBe(503);
    expect((await read(res)).error.code).toBe('FX_RATES_UNAVAILABLE');
  });

  it('limits each address per minute with 429 RATE_LIMITED and Retry-After', async () => {
    const h = harness({ publicPerMinute: 2 });
    const from = { 'x-forwarded-for': '203.0.113.9' };
    expect((await publicRates(h, from)).status).toBe(200);
    expect((await publicRates(h, from)).status).toBe(200);
    const res = await publicRates(h, from);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toMatch(/^\d+$/);
    expect((await read(res)).error.code).toBe('RATE_LIMITED');
    expect((await publicRates(h, { 'x-forwarded-for': '198.51.100.4' })).status).toBe(200);
  });
});
