import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/**
 * MUT-194 (pre-review decision 2): conversions are a hosted profile's own
 * activity, like expenses (expenses-invisible.test.ts). GET /v1/audit with
 * Malafat's key used to list `conversion.created`, because the route only
 * excluded EXPENSE_ENTITY_TYPES; the new update and delete events would have
 * leaked the same way. The store still records all three.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

describe('GET /v1/audit never lists conversion activity (MUT-194)', () => {
  it('hides conversion.created, .updated and .deleted from Malafat’s key, including with ?entityType=conversion', async () => {
    const store = new MemoryLedgerStore();
    const app = createApp({
      store,
      logger: pino({ level: 'silent' }),
      rateLimiter: new SlidingWindowRateLimiter(1_000_000),
      adminToken: ADMIN_TOKEN,
      keyEnvironment: 'test',
      version: '0.1.0-test',
      now: () => new Date('2026-10-20T09:00:00Z'),
      attachments: null,
      attachmentUrlTtlSeconds: 900,
      sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1 },
    });
    const org = await read(await app.request('/admin/v1/organizations', json({ name: 'Firm', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
    const apiKey = await read(await app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)));
    const key = { authorization: `Bearer ${apiKey.secret}` };
    const created = await read(await app.request('/admin/v1/users', json({ email: 'nour@firm.ps', displayName: 'Nour Haddad', organizationId: org.id, locale: 'en' }, admin)));
    const signIn = await app.request('/v1/sessions', json({ email: 'nour@firm.ps', password: created.initialPassword }, SAME_ORIGIN));
    const token = new RegExp(`${COOKIE}=([^;]*)`).exec(signIn.headers.get('set-cookie') ?? '')?.[1] ?? '';
    const session = { cookie: `${COOKIE}=${token}`, 'x-mutaba3a-profile': org.id, ...SAME_ORIGIN };

    // Something Malafat may see, so an empty feed can't pass by accident.
    expect((await app.request('/v1/customers', json({ name: 'Haddad' }, { ...key, 'idempotency-key': 'customer-0001' }))).status).toBe(201);

    const conversion = await read(
      await app.request('/v1/conversions', json({ occurredOn: '2026-10-05', amount: '100.00', currency: 'USD', toAmount: '365.00', toCurrency: 'ILS' }, { ...session, 'idempotency-key': 'conversion-0001' })),
    );
    expect((await app.request(`/v1/conversions/${conversion.id}`, json({ notes: 'fixed' }, { ...session, 'if-match': '1' }, 'PATCH'))).status).toBe(200);
    expect((await app.request(`/v1/conversions/${conversion.id}`, { method: 'DELETE', headers: session })).status).toBe(204);

    const recorded = (await store.audit.list(org.id, { entityType: 'conversion' }, { limit: 50, cursor: null })).items.map((e) => e.action).sort();
    expect(recorded).toEqual(['conversion.created', 'conversion.deleted', 'conversion.updated']);

    const listed = await read(await app.request('/v1/audit?limit=200', { headers: key }));
    expect(listed.items.length).toBeGreaterThan(0);
    expect(listed.items.filter((e: Loose) => e.entityType === 'conversion' || String(e.action).startsWith('conversion.'))).toEqual([]);
    expect(await read(await app.request('/v1/audit?entityType=conversion', { headers: key }))).toMatchObject({ items: [] });
    expect(await read(await app.request(`/v1/audit?entityId=${conversion.id}`, { headers: key }))).toMatchObject({ items: [] });
    expect(await read(await app.request('/v1/audit?action=conversion.created', { headers: key }))).toMatchObject({ items: [] });
  });
});
