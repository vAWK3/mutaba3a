import { PASSKEY_ORGANIZATION_INDEPENDENT_ROUTES } from '../routes/passkeys.js';
import { OAUTH_ORGANIZATION_INDEPENDENT_ROUTES } from '../routes/oauth-consent.js';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp, type AppDependencies } from '../app.js';
import { MemoryAttachmentStorage } from '../attachments/storage.js';
import { SCOPES } from '../auth/scopes.js';
import { PERSON_LEVEL_GATE } from '../billing/gate.js';
import { agentWriteGate } from '../auth/billing-gate.js';
import type { ApiError } from '../errors.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { ORGANIZATION_INDEPENDENT_ROUTES } from '../routes/sessions.js';
import { ME_ORGANIZATION_INDEPENDENT_ROUTES } from '../routes/me.js';
import { DEVICE_SESSION_ORGANIZATION_INDEPENDENT_ROUTES } from '../routes/device-sessions.js';
import { INBOX_ORGANIZATION_INDEPENDENT_ROUTES } from '../inbox/routes-keys.js';
import { PROFILE_ORGANIZATION_INDEPENDENT_ROUTES } from '../routes/profiles.js';
import { FX_ORGANIZATION_INDEPENDENT_ROUTES } from '../routes/fx-rates.js';
import { ENTRIES_ORGANIZATION_INDEPENDENT_ROUTES } from '../routes/entries.js';
import { SUMMARY_ORGANIZATION_INDEPENDENT_ROUTES } from '../routes/summaries.js';
import { BILLING_ORGANIZATION_INDEPENDENT_ROUTES } from '../routes/billing.js';
import { CLOSURE_ORGANIZATION_INDEPENDENT_ROUTES } from '../routes/account-closure.js';
import { provisionUser } from './helpers/provision.js';

/**
 * MUT-361 (ADR-181): the lapse gate through the real app — each billing state × reads, writes, receipts uploads,
 * records export, identity and billing routes, the person-level routes, a phone device session, and a Malafat API key.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN = { 'x-admin-token': 'test-admin-token-with-at-least-32-characters' };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };
const NOW = new Date('2026-11-01T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);
const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const idem = () => ({ 'idempotency-key': randomUUID() });

function harness(overrides: Partial<AppDependencies> = {}) {
  const store = new MemoryLedgerStore();
  const storage = new MemoryAttachmentStorage();
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN['x-admin-token'],
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => NOW,
    attachments: storage,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 60 * 24 * 400, absoluteHours: 24 * 400, secureCookie: true, trustedProxyHops: 1 },
    billingGate: true,
    ...overrides,
  });
  return { app, store, storage };
}
type Harness = ReturnType<typeof harness>;

type State = 'trial-active' | 'grace' | 'trial-read-only' | 'trial-locked' | 'paid-lapsed' | 'pre-billing' | 'none';

async function person(h: Harness, state: State) {
  const email = `gate${++seq}@studio.ps`;
  const created = await provisionUser(h.app, { email, displayName: 'Rana Saleh', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: 'en' });
  const userId = created.user.id as string;
  const personalId = created.personalProfile.id as string;
  await arrange(h, state, userId);
  const res = await h.app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const session = { cookie: `${COOKIE}=${token}`, ...SAME_ORIGIN };
  const on = (profileId: string | null = personalId) => (profileId ? { ...session, 'x-mutaba3a-profile': profileId } : session);
  return { email, password: created.password as string, userId, personalId, session, on };
}

async function arrange(h: Harness, state: State, userId: string) {
  const subscription = async (status: string, periodEnd: Date) => {
    const customer = `cus_${++seq}`;
    await h.store.billing.saveAccount({ stripeCustomerId: customer, userId, country: 'IL', currency: 'ILS', at: NOW, linkAudit: [] });
    await h.store.billing.saveSubscription({
      stripeCustomerId: customer, stripeSubscriptionId: `sub_${++seq}`, tier: 'FREELANCER', organizationId: null, status, currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false, priceLookupKey: 'freelancer_list_monthly_ils', founderUntil: null, stripeUpdatedAt: NOW, at: NOW,
      audit: { profileIds: [], source: 'webhook', eventId: null, requestId: null },
    });
  };
  switch (state) {
    case 'trial-active': return void (await h.store.billing.setTrialStart(userId, daysAgo(3)));
    case 'trial-read-only': return void (await h.store.billing.setTrialStart(userId, daysAgo(20)));
    case 'trial-locked': return void (await h.store.billing.setTrialStart(userId, daysAgo(31)));
    case 'grace': return subscription('past_due', new Date(NOW.getTime() + 3 * DAY));
    case 'paid-lapsed':
      // A trial long over, then a subscription that was paid and cancelled: read-only for good, never locked.
      await h.store.billing.setTrialStart(userId, daysAgo(90));
      return subscription('canceled', daysAgo(40));
    case 'pre-billing': {
      const res = await h.app.request('/admin/v1/billing/grants', json({ userId, tier: 'FREELANCER', reason: 'pre-billing' }, ADMIN));
      if (res.status !== 201) throw new Error(`grant failed: ${res.status} ${await res.text()}`);
      return;
    }
    case 'none': return;
  }
}

async function firmWithKey(h: Harness) {
  const org = await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, ADMIN)));
  const key = await read(await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, ADMIN)));
  return { id: org.id as string, key: { authorization: `Bearer ${key.secret}` } };
}

const expense = (headers: Record<string, string>) => json({ amount: '12.00', currency: 'ILS', occurredOn: '2026-10-05', title: 'Paper' }, { ...headers, ...idem() });

describe('the lapse gate on a profile (MUT-361)', () => {
  const writable: State[] = ['trial-active', 'grace', 'pre-billing'];
  for (const state of writable) {
    it(`${state}: reads and writes work`, async () => {
      const h = harness();
      const p = await person(h, state);
      expect((await h.app.request('/v1/expenses', { headers: p.on() })).status).toBe(200);
      expect((await h.app.request('/v1/expenses', expense(p.on()))).status).toBe(201);
    });
  }

  for (const state of ['trial-read-only', 'paid-lapsed', 'none'] as const) {
    it(`${state}: reads and the export work, every write is refused 402 SUBSCRIPTION_LAPSED`, async () => {
      const h = harness();
      const p = await person(h, state);
      expect((await h.app.request('/v1/expenses', { headers: p.on() })).status).toBe(200);
      expect((await h.app.request('/v1/summaries/organization', { headers: p.on() })).status).toBe(200);
      expect((await h.app.request('/v1/records-export', { headers: p.on() })).status).toBe(200);

      const refused = await h.app.request('/v1/expenses', expense(p.on()));
      expect(refused.status).toBe(402);
      const body = await read(refused);
      expect(body.error.code).toBe('SUBSCRIPTION_LAPSED');
      expect(body.error.details).toMatchObject({ profileId: p.personalId, state: 'READ_ONLY' });
      expect((await h.app.request('/v1/income', json({ kind: 'received', amount: '50.00', currency: 'ILS', occurredOn: '2026-10-05' }, { ...p.on(), ...idem() }))).status).toBe(402);
      expect((await h.app.request('/v1/conversions', json({ fromAmount: '10.00', fromCurrency: 'USD', toAmount: '36.00', toCurrency: 'ILS', occurredOn: '2026-10-05' }, { ...p.on(), ...idem() }))).status).toBe(402);
    });
  }

  it('trial-read-only: the details carry the lock date; paid-lapsed carries none (a payer never locks)', async () => {
    const h = harness();
    const trial = await person(h, 'trial-read-only');
    const paid = await person(h, 'paid-lapsed');
    const t = await read(await h.app.request('/v1/expenses', expense(trial.on())));
    expect(t.error.details).toEqual({ profileId: trial.personalId, state: 'READ_ONLY', source: 'TRIAL', until: new Date(daysAgo(20).getTime() + 30 * DAY).toISOString() });
    const s = await read(await h.app.request('/v1/expenses', expense(paid.on())));
    expect(s.error.details).toEqual({ profileId: paid.personalId, state: 'READ_ONLY', source: 'STRIPE', until: null });
  });

  it('trial-locked: reads are refused too; the records export and its receipts still answer', async () => {
    const h = harness({ billingGate: false });
    const p = await person(h, 'trial-active');
    // Record an expense with a receipt while the trial runs, then move the trial back past day 30.
    const created = await read(await h.app.request('/v1/expenses', expense(p.on())));
    const started = await read(await h.app.request(`/v1/expenses/${created.id}/receipts`, json({ filename: 'r.png', mimeType: 'image/png', sizeBytes: 4 }, p.on())));
    const storageKey = new URL(started.upload.url).pathname.replace(/^\/+/, '').replace(/^upload\//, '');
    h.storage.put(storageKey, { sizeBytes: 4, contentType: 'image/png' }, new Uint8Array([1, 2, 3, 4]));
    expect((await h.app.request(`/v1/expenses/${created.id}/receipts/${started.receipt.id}/complete`, { method: 'POST', headers: p.on() })).status).toBe(200);
    await h.store.billing.setTrialStart(p.userId, daysAgo(31));
    const gated = harness();
    // Same store, gate on: a second app over the first one's data.
    const app = createApp({ ...gatedDeps(gated), store: h.store, attachments: h.storage });

    const list = await app.request('/v1/expenses', { headers: p.on() });
    expect(list.status).toBe(402);
    expect((await read(list)).error.details).toEqual({ profileId: p.personalId, state: 'LOCKED', source: 'TRIAL', until: null });
    expect((await app.request(`/v1/expenses/${created.id}/receipts/${started.receipt.id}/download`, { headers: p.on() })).status).toBe(402);
    expect((await app.request('/v1/expenses', expense(p.on()))).status).toBe(402);

    const exported = await app.request('/v1/records-export', { headers: p.on() });
    expect(exported.status).toBe(200);
    expect(JSON.stringify(await read(exported))).toContain(created.id);
    expect((await app.request(`/v1/records-export/receipts/${started.receipt.id}`, { headers: p.on() })).status).toBe(200);
    // Nothing was deleted: the expense is still there for the store.
    expect(await h.store.expenses.getById(p.personalId, created.id)).not.toBeNull();
  });

  it('a receipts upload (start, upload URL, complete) is a write: refused on a read-only profile', async () => {
    const h = harness({ receiptsLibrary: true });
    const p = await person(h, 'trial-read-only');
    expect((await h.app.request('/v1/receipts/uploads', json({ filename: 'r.png', mimeType: 'image/png', sizeBytes: 4 }, { ...p.on(), ...idem() }))).status).toBe(402);
  });
});

describe('routes that stay open in every state (MUT-361)', () => {
  for (const state of ['trial-read-only', 'trial-locked'] as const) {
    it(`${state}: /v1/me, the trial prompt, terms, billing and sign-out answer`, async () => {
      const h = harness();
      const p = await person(h, state);
      const me = await h.app.request('/v1/me', { headers: p.session });
      expect(me.status).toBe(200);
      expect((await read(me)).billingStanding).toBe(state === 'trial-locked' ? 'locked' : 'read-only');
      expect((await h.app.request('/v1/me/trial-prompt', { method: 'PATCH', headers: { ...p.session, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'banner-snoozed' }) })).status).toBe(200);
      expect((await h.app.request('/v1/billing', { headers: p.session })).status).toBe(200);
      expect((await h.app.request('/v1/sessions/current', { method: 'DELETE', headers: p.session })).status).toBe(204);
    });
  }

  it('a person who can write somewhere has standing open; with the gate off it is null', async () => {
    const h = harness();
    const p = await person(h, 'trial-active');
    expect((await read(await h.app.request('/v1/me', { headers: p.session }))).billingStanding).toBe('open');
    const off = harness({ billingGate: false });
    const q = await person(off, 'trial-locked');
    expect((await read(await off.app.request('/v1/me', { headers: q.session }))).billingStanding).toBeNull();
    expect((await off.app.request('/v1/expenses', expense(q.on()))).status).toBe(201);
  });

  it('an unmatched route still answers its 404, never the gate', async () => {
    const h = harness();
    const p = await person(h, 'trial-locked');
    expect((await h.app.request('/v1/no-such-route', { headers: p.on() })).status).toBe(404);
  });
});

describe('person-level routes follow the person’s best standing (MUT-361 D4)', () => {
  it('read-only: the inbox reads but takes no capture, and New profile is refused', async () => {
    const h = harness();
    const p = await person(h, 'trial-read-only');
    expect((await h.app.request('/v1/inbox', { headers: p.session })).status).toBe(200);
    const capture = await h.app.request('/v1/inbox', json({ kind: 'expense', amount: '5.00', currency: 'ILS', occurredOn: '2026-10-05' }, { ...p.session, ...idem() }));
    expect(capture.status).toBe(402);
    expect((await read(capture)).error.details).toMatchObject({ profileId: null, state: 'READ_ONLY' });
    expect((await h.app.request('/v1/profiles', json({ name: 'Studio', type: 'BUSINESS', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, { ...p.session, ...idem() }))).status).toBe(402);
  });

  it('MUT-447: the Reports verdict leaves a locked profile out, names it, and still counts the covered firm', async () => {
    const h = harness();
    const p = await person(h, 'trial-active');
    const firm = await firmWithKey(h);
    await h.app.request(`/admin/v1/users/${p.userId}/memberships`, json({ organizationId: firm.id }, ADMIN));
    await h.app.request('/admin/v1/billing/grants', json({ organizationId: firm.id, tier: 'FIRM', reason: 'pilot' }, ADMIN));
    await h.store.billing.setTrialStart(p.userId, daysAgo(31));

    const res = await h.app.request('/v1/summaries/verdict', { headers: p.session });
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.profiles.map((x: Loose) => x.profileId)).toEqual([firm.id]);
    expect(body.unavailable).toEqual([{ profileId: p.personalId, name: expect.any(String), code: 'SUBSCRIPTION_LAPSED' }]);
    expect(body.total.partial).toBe(true);
  });

  it('MUT-447 (review A1): the verdict never runs catch-up posting on a locked profile', async () => {
    const h = harness();
    const p = await person(h, 'trial-active');
    const firm = await firmWithKey(h);
    await h.app.request(`/admin/v1/users/${p.userId}/memberships`, json({ organizationId: firm.id }, ADMIN));
    await h.app.request('/admin/v1/billing/grants', json({ organizationId: firm.id, tier: 'FIRM', reason: 'pilot' }, ADMIN));
    await h.store.billing.setTrialStart(p.userId, daysAgo(31));
    // postDueItems starts by asking for a profile's unposted due installments: the locked profile must never be asked about.
    const asked: string[] = [];
    const listUnpostedDue = h.store.agreements.listUnpostedDue.bind(h.store.agreements);
    h.store.agreements.listUnpostedDue = (async (organizationId: string, ...rest: unknown[]) => {
      asked.push(organizationId);
      return (listUnpostedDue as Loose)(organizationId, ...rest);
    }) as Loose;

    expect((await h.app.request('/v1/summaries/verdict', { headers: p.session })).status).toBe(200);
    expect(asked).toEqual([firm.id]);
  });

  it('locked everywhere: the inbox and the entries feed are refused', async () => {
    const h = harness();
    const p = await person(h, 'trial-locked');
    expect((await h.app.request('/v1/inbox', { headers: p.session })).status).toBe(402);
    expect((await h.app.request('/v1/entries', { headers: p.session })).status).toBe(402);
  });

  it('a person with one covered profile keeps the inbox, and the entries feed leaves the locked one out', async () => {
    const h = harness();
    const p = await person(h, 'trial-active');
    const created = await read(await h.app.request('/v1/expenses', expense(p.on())));
    const firm = await firmWithKey(h);
    await h.app.request(`/admin/v1/users/${p.userId}/memberships`, json({ organizationId: firm.id }, ADMIN));
    await h.app.request('/admin/v1/billing/grants', json({ organizationId: firm.id, tier: 'FIRM', reason: 'pilot' }, ADMIN));
    await h.store.billing.setTrialStart(p.userId, daysAgo(31));

    expect((await h.app.request('/v1/inbox', json({ kind: 'expense', amount: '5.00', currency: 'ILS', occurredOn: '2026-10-05' }, { ...p.session, ...idem() }))).status).toBe(201);
    const feed = await read(await h.app.request('/v1/entries', { headers: p.session }));
    expect(feed.items.map((i: Loose) => i.id)).not.toContain(created.id);
    const asked = await h.app.request(`/v1/entries?profileId=${p.personalId}`, { headers: p.session });
    expect(asked.status).toBe(402);
    expect((await read(asked)).error.details).toEqual({ profileId: p.personalId, state: 'LOCKED', source: 'TRIAL', until: null });
    // The firm is covered by its grant, so it writes; the personal profile, locked, doesn't.
    expect((await h.app.request('/v1/expenses', expense(p.on(firm.id)))).status).toBe(201);
    expect((await h.app.request('/v1/expenses', expense(p.on()))).status).toBe(402);
  });

  it('a profile named in the path follows that profile: renaming a read-only one is refused', async () => {
    const h = harness();
    const p = await person(h, 'trial-read-only');
    const res = await h.app.request(`/v1/profiles/${p.personalId}`, { method: 'PATCH', headers: { ...p.session, 'content-type': 'application/json', ...idem() }, body: JSON.stringify({ name: 'Mine' }) });
    expect(res.status).toBe(402);
    expect((await read(res)).error.details).toMatchObject({ profileId: p.personalId, state: 'READ_ONLY' });
  });

  it('a path that is no profile id never reaches the gate, and the route answers it (review)', async () => {
    const h = harness();
    const p = await person(h, 'trial-read-only');
    const res = await h.app.request('/v1/profiles/%25', { method: 'PATCH', headers: { ...p.session, 'content-type': 'application/json', ...idem() }, body: JSON.stringify({ name: 'Mine' }) });
    expect(res.status).toBeLessThan(500);
    expect(res.status).not.toBe(402);
  });

  it('an agent’s write follows the profile’s lapse state like a session’s (MUT-434 agentWriteGate)', async () => {
    const h = harness();
    const write = async (state: State, enforced = true) => {
      const p = await person(h, state);
      const organization = (await h.store.organizations.getById(p.personalId))!;
      return agentWriteGate(h.store, organization, NOW, enforced).then(
        () => 'allowed',
        (err: ApiError) => `${err.code}:${(err.details as { state: string }).state}`,
      );
    };
    expect(await write('trial-active')).toBe('allowed');
    expect(await write('trial-read-only')).toBe('SUBSCRIPTION_LAPSED:READ_ONLY');
    expect(await write('trial-locked')).toBe('SUBSCRIPTION_LAPSED:LOCKED');
    expect(await write('trial-locked', false)).toBe('allowed');
  });

  it('every organization-independent endpoint is classified', () => {
    const all = [
      ...ORGANIZATION_INDEPENDENT_ROUTES, ...ME_ORGANIZATION_INDEPENDENT_ROUTES, ...DEVICE_SESSION_ORGANIZATION_INDEPENDENT_ROUTES, ...INBOX_ORGANIZATION_INDEPENDENT_ROUTES,
      ...PROFILE_ORGANIZATION_INDEPENDENT_ROUTES, ...FX_ORGANIZATION_INDEPENDENT_ROUTES, ...ENTRIES_ORGANIZATION_INDEPENDENT_ROUTES, ...BILLING_ORGANIZATION_INDEPENDENT_ROUTES, ...CLOSURE_ORGANIZATION_INDEPENDENT_ROUTES,
      ...PASSKEY_ORGANIZATION_INDEPENDENT_ROUTES,
      ...OAUTH_ORGANIZATION_INDEPENDENT_ROUTES,
      ...SUMMARY_ORGANIZATION_INDEPENDENT_ROUTES,
    ];
    expect(all.filter((endpoint) => !(endpoint in PERSON_LEVEL_GATE))).toEqual([]);
    expect(Object.keys(PERSON_LEVEL_GATE).filter((endpoint) => !all.includes(endpoint))).toEqual([]);
  });
});

describe('transports and principals (MUT-361)', () => {
  it('a phone device session gets the same refusal', async () => {
    const h = harness();
    const p = await person(h, 'trial-read-only');
    const signedIn = await read(await h.app.request('/v1/device-sessions', json({ email: p.email, password: p.password })));
    expect(signedIn.billingStanding ?? signedIn.me?.billingStanding).toBe('read-only');
    const bearer = { authorization: `Bearer ${signedIn.token}`, 'x-mutaba3a-profile': p.personalId };
    expect((await h.app.request('/v1/expenses', { headers: bearer })).status).toBe(200);
    const refused = await h.app.request('/v1/expenses', expense(bearer));
    expect(refused.status).toBe(402);
    expect((await read(refused)).error.code).toBe('SUBSCRIPTION_LAPSED');
  });

  it('a Malafat API key is never gated, though its firm resolves read-only for sessions', async () => {
    const h = harness();
    const firm = await firmWithKey(h);
    const res = await h.app.request('/v1/customers', json({ name: 'Ramallah Bakery' }, { ...firm.key, ...idem() }));
    expect(res.status).toBe(201);
  });
});

function gatedDeps(h: Harness): AppDependencies {
  return {
    store: h.store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN['x-admin-token'],
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => NOW,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 60 * 24 * 400, absoluteHours: 24 * 400, secureCookie: true, trustedProxyHops: 1 },
    billingGate: true,
  };
}
