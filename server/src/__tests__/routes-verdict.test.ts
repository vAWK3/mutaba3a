import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { CachedFxRates, type EcbSnapshot, type FxRateSource } from '../fx-rates.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/** MUT-447: GET /v1/summaries/verdict — the Reports verdict across a person's profiles (eng review D2–D12). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };
let seq = 0;
let ik = 0;
const idem = () => ({ 'idempotency-key': `key-${++ik}-${Math.random().toString(36).slice(2, 8)}` });
const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({ method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

const SNAPSHOT: EcbSnapshot = { rateDate: '2026-10-19', perEur: { USD: 1.1, ILS: 4.07 } };
const liveRates = (): FxRateSource => ({ latest: async () => SNAPSHOT });
const downRates = (): FxRateSource => ({
  latest: async () => {
    throw new Error('provider down');
  },
});

async function setup(options: { now?: string; fx?: FxRateSource; timezone?: string } = {}) {
  const store = new MemoryLedgerStore();
  const clock = { now: new Date(options.now ?? '2026-10-20T09:00:00Z') };
  const reported: unknown[] = [];
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
    reporter: { captureException: (err: unknown) => void reported.push(err), captureMessage: () => undefined } as Loose,
    ...(options.fx ? { fxRates: new CachedFxRates({ source: options.fx, ttlMs: 60_000, now: () => clock.now }) } : {}),
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1 },
  });
  const firm = await read(await app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
  const key = await read(await app.request(`/admin/v1/organizations/${firm.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)));
  const keyAuth = { authorization: `Bearer ${key.secret}` };
  const signIn = async (email: string, password: string) => {
    const res = await app.request('/v1/sessions', json({ email, password }, SAME_ORIGIN));
    const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
    return { cookie: `${COOKIE}=${token}`, ...SAME_ORIGIN };
  };
  const email = `owner${++seq}@firm.ps`;
  const created = await provisionUser(app, { email, displayName: 'Nour Haddad', organizationId: firm.id, ...(options.timezone ? { timezone: options.timezone } : {}) });
  const session = await signIn(email, created.password);
  const personal = created.personalProfile.id as string;
  const on = (profile: string) => ({ ...session, 'x-mutaba3a-profile': profile });
  const verdict = (query = '', headers: Record<string, string> = session) => app.request(`/v1/summaries/verdict${query ? `?${query}` : ''}`, { headers });
  const income = (profile: string, body: Record<string, unknown>) => app.request('/v1/income', json({ currency: 'ILS', ...body }, { ...on(profile), ...idem() }));
  const expense = (profile: string, body: Record<string, unknown>) => app.request('/v1/expenses', json({ currency: 'ILS', ...body }, { ...on(profile), ...idem() }));
  const business = async (name: string) => (await read(await app.request('/v1/profiles', json({ name, type: 'BUSINESS', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, { ...session, ...idem() })))).id as string;
  return { app, store, clock, reported, firm: firm.id as string, keyAuth, personal, userId: created.user.id as string, session, on, verdict, income, expense, business, signIn };
}

const line = (body: Loose, profileId: string) => body.profiles.find((p: Loose) => p.profileId === profileId);

describe('GET /v1/summaries/verdict', () => {
  it('answers without a profile header: the personal profile and the firm the person owns, kept across both', async () => {
    const s = await setup({ fx: liveRates() });
    expect((await s.income(s.firm, { kind: 'received', amount: '4200.00', occurredOn: '2026-10-05' })).status).toBe(201);
    expect((await s.expense(s.personal, { amount: '600.00', occurredOn: '2026-10-06' })).status).toBe(201);
    const res = await s.verdict('from=2026-10-01&to=2026-10-31');
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body).toMatchObject({ from: '2026-10-01', to: '2026-10-31', asOf: '2026-10-20', base: 'ILS', rates: { date: '2026-10-19', source: 'live' }, unavailable: [] });
    expect(line(body, s.firm)).toMatchObject({ kind: 'FIRM', shared: false, currencies: [{ currency: 'ILS', received: '4200.00', spent: '0.00', net: '4200.00' }] });
    expect(line(body, s.personal)).toMatchObject({ kind: 'PERSONAL', currencies: [{ currency: 'ILS', received: '0.00', spent: '600.00', net: '-600.00' }] });
    expect(line(body, s.firm).history).toHaveLength(12);
    expect(body.total).toMatchObject({ label: 'kept', currencies: [{ currency: 'ILS', net: '3600.00' }], converted: '3600.00', inCurrencyOnly: null, sharedInFull: false });
  });

  it('counts an owned business, flags a co-owned one, and never shows another person’s profile', async () => {
    const s = await setup();
    const studio = await s.business('Studio');
    const other = await provisionUser(s.app, { email: `other${++seq}@studio.ps`, displayName: 'Rana Saleh', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    await s.store.memberships.grantOwner(other.user.id, studio, s.clock.now, 3, { organizationId: studio, actorType: 'SYSTEM', actorId: null, action: 'membership.granted', entityType: 'user', entityId: other.user.id, requestId: null });
    const body = await read(await s.verdict());
    expect(line(body, studio)).toMatchObject({ kind: 'BUSINESS', shared: true });
    expect(body.total.sharedInFull).toBe(true);
    expect(line(body, other.personalProfile.id)).toBeUndefined();
  });

  it('leaves out a firm the person only staffs (BOOKKEEPER)', async () => {
    const s = await setup();
    const staffed = await read(await s.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
    const partner = await provisionUser(s.app, { email: `partner${++seq}@firm.ps`, displayName: 'Sami Odeh', organizationId: staffed.id });
    expect(await s.store.organizations.setFirm(staffed.id, { enabled: true, ownerUserIds: [partner.user.id] }, s.clock.now, { actorId: null, requestId: null })).toMatchObject({ kind: 'updated' });
    expect((await s.app.request(`/admin/v1/users/${s.userId}/memberships`, json({ organizationId: staffed.id }, admin))).status).toBeLessThan(300);
    expect((await s.store.memberships.find(s.userId, staffed.id))?.role).toBe('BOOKKEEPER');
    const body = await read(await s.verdict());
    expect(line(body, staffed.id)).toBeUndefined();
    expect(body.profiles.map((p: Loose) => p.profileId).sort()).toEqual([s.firm, s.personal].sort());
  });

  it('labels the total businessNet when no personal profile is in view', async () => {
    const s = await setup();
    await s.store.memberships.revoke(s.userId, s.personal);
    const body = await read(await s.verdict());
    expect(body.total.label).toBe('businessNet');
  });

  // REVERSED payments are excluded by summarizeActivity (summaries/__tests__/activity.test.ts), which the verdict reuses.
  it('never counts unpaid Owed in net; Owed is the open balance only', async () => {
    const s = await setup();
    const client = await read(await s.app.request('/v1/customers', json({ name: 'Haddad' }, { ...s.on(s.personal), ...idem() })));
    expect((await s.income(s.personal, { kind: 'owed', amount: '300.00', occurredOn: '2026-10-02', customerId: client.id, title: 'Work' })).status).toBe(201);
    const body = await read(await s.verdict('from=2026-10-01&to=2026-10-31'));
    expect(line(body, s.personal).currencies).toEqual([]);
    expect(line(body, s.personal).owed).toEqual({ currencies: [{ currency: 'ILS', outstanding: '300.00', overdue: '0.00' }], overdueCount: 0 });
    expect(body.owed).toMatchObject({ currencies: [{ currency: 'ILS', outstanding: '300.00', overdue: '0.00' }], converted: '300.00', overdueCount: 0 });
  });

  it('posts due installments first, so owed matches the organization summary (D3)', async () => {
    const s = await setup();
    await s.app.request('/v1/settings/vat', json({ rateBasisPoints: 1800, effectiveFrom: '2025-01-01' }, s.keyAuth, 'PUT'));
    const customer = await read(await s.app.request('/v1/customers', json({ name: 'Haddad' }, { ...s.keyAuth, ...idem() })));
    const project = await read(await s.app.request('/v1/projects', json({ customerId: customer.id, name: 'Sale', currency: 'ILS' }, { ...s.keyAuth, ...idem() })));
    const body = {
      projectId: project.id,
      amount: '500.00',
      pricingBasis: 'VAT_EXCLUSIVE',
      vatTreatment: 'EXEMPT',
      agreementDate: '2026-10-01',
      paymentTerms: 'EOM',
      installments: [{ label: 'I1', amount: '500.00', trigger: { type: 'IMMEDIATE' }, dueDate: '2026-10-20' }],
    };
    const preview = await read(await s.app.request('/v1/agreements/preview', json(body, s.keyAuth)));
    expect((await s.app.request('/v1/agreements', json({ ...body, previewToken: preview.previewToken }, { ...s.keyAuth, ...idem() }))).status).toBe(201);
    const verdict = await read(await s.verdict());
    expect(line(verdict, s.firm).owed.currencies).toEqual([{ currency: 'ILS', outstanding: '500.00', overdue: '0.00' }]);
    const summary = await read(await s.app.request('/v1/summaries/organization', { headers: { ...s.keyAuth, 'x-mutaba3a-profile': s.firm } }));
    expect(summary.currencies[0].outstanding).toBe('500.00');
  });

  it('still answers when rates are down: per-currency figures, converted null unless all base (D4)', async () => {
    const s = await setup({ fx: downRates() });
    await s.income(s.personal, { kind: 'received', amount: '10.00', occurredOn: '2026-10-05' });
    let body = await read(await s.verdict());
    expect(body.rates).toBeNull();
    expect(body.total).toMatchObject({ converted: '10.00', inCurrencyOnly: null });
    await s.income(s.firm, { kind: 'received', amount: '5.00', currency: 'USD', occurredOn: '2026-10-05' });
    body = await read(await s.verdict());
    expect(body.total).toMatchObject({ converted: null, currencies: [{ currency: 'ILS', net: '10.00' }, { currency: 'USD', net: '5.00' }] });
    expect(body.usual).toBeNull();
  });

  it('names a profile that fails to read and answers for the rest, reporting the error', async () => {
    const s = await setup();
    const list = s.store.receivables.list.bind(s.store.receivables);
    s.store.receivables.list = (async (organizationId: string, ...rest: unknown[]) => {
      if (organizationId === s.firm) throw new Error('boom');
      return (list as Loose)(organizationId, ...rest);
    }) as Loose;
    const res = await s.verdict();
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.unavailable).toEqual([{ profileId: s.firm, name: expect.any(String), code: 'INTERNAL' }]);
    expect(line(body, s.personal)).toBeDefined();
    expect(s.reported).toHaveLength(1);
  });

  it('validates the range like the activity summary (D5)', async () => {
    const s = await setup();
    expect((await read(await s.verdict('from=2026-10-10&to=2026-10-01'))).error.code).toBe('VALIDATION_FAILED');
    expect((await read(await s.verdict('from=2026-10-10&to=2026-10-01'))).error.details).toMatchObject({ reason: 'END_BEFORE_START' });
    expect((await read(await s.verdict('from=2025-01-01&to=2026-12-31'))).error.details).toMatchObject({ reason: 'RANGE_TOO_LONG' });
  });

  it('defaults to this month in the base profile’s timezone (D12)', async () => {
    // 22:30 UTC on 31 Oct: already 1 Nov in Jerusalem (the firm), still 31 Oct in New York (the personal, base profile).
    const s = await setup({ now: '2026-10-31T22:30:00Z', timezone: 'America/New_York' });
    const body = await read(await s.verdict());
    expect(body).toMatchObject({ from: '2026-10-01', to: '2026-10-31', asOf: '2026-10-31' });
  });

  it('refuses an API key', async () => {
    const s = await setup();
    const res = await s.verdict('', { ...s.keyAuth, 'x-mutaba3a-profile': s.firm });
    expect(res.status).toBe(403);
    expect((await read(res)).error.code).toBe('PRINCIPAL_NOT_ACCEPTED');
  });
});

describe('GET /v1/summaries/verdict — review fixes (qa-reconcile 2026-10-26)', () => {
  it('answers 200 when a profile holds a row in a retired currency, leaving it out and naming it (#1)', async () => {
    const s = await setup();
    await s.income(s.personal, { kind: 'received', amount: '10.00', occurredOn: '2026-10-05' });
    await s.store.expenses.create({ organizationId: s.personal, occurredOn: '2026-10-06', amountMinor: 500n, currency: 'AED', title: 'Old', vendor: null, categoryId: null, customerId: null, projectId: null, notes: null, createdByUserId: s.userId }, s.clock.now);
    const res = await s.verdict();
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(line(body, s.personal)).toMatchObject({ currencies: [{ currency: 'ILS', net: '10.00' }], omittedCurrencies: ['AED'] });
  });

  it('answers 200 with no conversion when the rate source fails unexpectedly, and reports it (#5)', async () => {
    // A snapshot that passes the cache's date check but holds no rates: crossRates throws a TypeError, not FX_RATES_UNAVAILABLE.
    const s = await setup({ fx: { latest: async () => ({ rateDate: '2026-10-19', perEur: null }) as unknown as EcbSnapshot } });
    await s.income(s.personal, { kind: 'received', amount: '10.00', occurredOn: '2026-10-05' });
    const res = await s.verdict();
    expect(res.status).toBe(200);
    expect((await read(res)).total.converted).toBe('10.00');
    expect(s.reported).toHaveLength(1);
  });

  it('names a profile whose read fails with an API error as INTERNAL and reports server errors only (#8)', async () => {
    const s = await setup();
    const { ApiError } = await import('../errors.js');
    const list = s.store.receivables.list.bind(s.store.receivables);
    let thrown: unknown = new ApiError('INTERNAL', 'receivable vanished');
    s.store.receivables.list = (async (organizationId: string, ...rest: unknown[]) => {
      if (organizationId === s.firm) throw thrown;
      return (list as Loose)(organizationId, ...rest);
    }) as Loose;
    let body = await read(await s.verdict());
    expect(body.unavailable).toEqual([{ profileId: s.firm, name: expect.any(String), code: 'INTERNAL' }]);
    expect(body.total.partial).toBe(true);
    expect(s.reported).toHaveLength(1);
    thrown = new ApiError('NOT_FOUND', 'gone');
    body = await read(await s.verdict());
    expect(body.unavailable[0].code).toBe('INTERNAL');
    expect(s.reported).toHaveLength(1);
  });

  it('answers 404 when the person holds no profile the verdict counts', async () => {
    const s = await setup();
    await s.store.memberships.revoke(s.userId, s.personal);
    await s.store.memberships.revoke(s.userId, s.firm);
    const res = await s.verdict();
    expect(res.status).toBe(404);
    expect((await read(res)).error.code).toBe('NOT_FOUND');
  });

  it('leaves out a firm where the person is a SUBMITTER', async () => {
    const s = await setup();
    const staffed = await read(await s.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
    const partner = await provisionUser(s.app, { email: `partner${++seq}@firm.ps`, displayName: 'Sami Odeh', organizationId: staffed.id });
    await s.store.organizations.setFirm(staffed.id, { enabled: true, ownerUserIds: [partner.user.id] }, s.clock.now, { actorId: null, requestId: null });
    await s.app.request(`/admin/v1/users/${s.userId}/memberships`, json({ organizationId: staffed.id }, admin));
    const member = (await s.store.memberships.find(s.userId, staffed.id))!;
    (s.store as Loose).members.set(`${s.userId}:${staffed.id}`, { ...member, role: 'SUBMITTER' });
    expect((await s.store.memberships.find(s.userId, staffed.id))?.role).toBe('SUBMITTER');
    expect(line(await read(await s.verdict()), staffed.id)).toBeUndefined();
  });
});
