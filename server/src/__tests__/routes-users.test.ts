import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { ARGON2_MINIMUMS, createArgon2Hasher } from '../auth/users.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const hasher = createArgon2Hasher(ARGON2_MINIMUMS);

function harness() {
  const store = new MemoryLedgerStore();
  const clock = { now: new Date('2026-10-11T09:00:00Z') };
  const logs: string[] = [];
  const app = createApp({
    store,
    logger: pino({ level: 'trace' }, { write: (line: string) => void logs.push(line) }),
    rateLimiter: new SlidingWindowRateLimiter(1000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
    passwordHasher: hasher,
  });
  return { app, store, clock, logs };
}
type Harness = ReturnType<typeof harness>;

const send = (method: string, body?: unknown, headers: Record<string, string> = admin) => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

async function organization(h: Harness, name = `Sader Law Firm ${++seq}`): Promise<{ id: string }> {
  const res = await h.app.request('/admin/v1/organizations', send('POST', { name, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }));
  expect(res.status).toBe(201);
  return read(res);
}

async function createUser(h: Harness, organizationId: string, email = `partner${++seq}@firm.ps`) {
  const res = await h.app.request('/admin/v1/users', send('POST', { email, displayName: 'Nour Haddad', organizationId }));
  expect(res.status).toBe(201);
  return read(res) as Promise<{ user: { id: string; email: string; status: string; passwordChangedAt: string }; memberships: { organizationId: string }[]; initialPassword: string }>;
}

async function auditActions(h: Harness, organizationId: string): Promise<{ action: string; actorType: string; entityId: string }[]> {
  const res = await h.app.request(`/admin/v1/organizations/${organizationId}/audit?limit=200`, send('GET'));
  // The admin audit endpoint answers newest first; the assertions read oldest first.
  return [...(await read(res)).events].reverse();
}

describe('POST /admin/v1/users', () => {
  it('creates a user with one membership and a one-time password, never the hash', async () => {
    const h = harness();
    const org = await organization(h);
    const res = await h.app.request('/admin/v1/users', send('POST', { email: '  Partner@Firm.PS ', displayName: 'Nour Haddad', organizationId: org.id }));
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain('$argon2id$');
    const body = JSON.parse(text);
    expect(body.user).toMatchObject({ email: 'partner@firm.ps', displayName: 'Nour Haddad', locale: 'en', status: 'ACTIVE' });
    expect(body.user).not.toHaveProperty('passwordHash');
    expect(body.memberships).toEqual([{ organizationId: org.id, createdAt: '2026-10-11T09:00:00.000Z' }]);
    expect(body.initialPassword).toMatch(/^[A-Za-z0-9_-]{24}$/);

    const stored = await h.store.users.getById(body.user.id);
    expect(await hasher.verify(stored!.passwordHash, body.initialPassword)).toBe(true);
  });

  it('accepts locale ar', async () => {
    const h = harness();
    const org = await organization(h);
    const res = await h.app.request('/admin/v1/users', send('POST', { email: 'ar@firm.ps', displayName: 'نور', locale: 'ar', organizationId: org.id }));
    expect(res.status).toBe(201);
    expect((await read(res)).user.locale).toBe('ar');
  });

  it('refuses a reused email in any case or spacing with 409', async () => {
    const h = harness();
    const org = await organization(h);
    await createUser(h, org.id, 'partner@firm.ps');
    const res = await h.app.request('/admin/v1/users', send('POST', { email: ' PARTNER@firm.ps', displayName: 'Again', organizationId: org.id }));
    expect(res.status).toBe(409);
    expect((await read(res)).error.code).toBe('CONFLICT');
  });

  it('answers 404 for an unknown organization and creates nobody', async () => {
    const h = harness();
    const res = await h.app.request('/admin/v1/users', send('POST', { email: 'ghost@firm.ps', displayName: 'Ghost', organizationId: '00000000-0000-4000-8000-000000000000' }));
    expect(res.status).toBe(404);
    expect(await h.store.users.findByEmail('ghost@firm.ps')).toBeNull();
  });

  it.each([
    [{ email: 'not-an-email', displayName: 'X' }],
    [{ email: 'ok@firm.ps', displayName: '' }],
    [{ email: 'ok@firm.ps', displayName: 'X', locale: 'fr' }],
  ])('answers 422 for %j', async (partial) => {
    const h = harness();
    const org = await organization(h);
    const res = await h.app.request('/admin/v1/users', send('POST', { organizationId: org.id, ...partial }));
    expect(res.status).toBe(422);
  });
});

describe('GET /admin/v1/users', () => {
  it('finds by email regardless of case and spacing, and lists nothing for an unknown one', async () => {
    const h = harness();
    const org = await organization(h);
    const { user } = await createUser(h, org.id, 'partner@firm.ps');
    const found = await read(await h.app.request(`/admin/v1/users?email=${encodeURIComponent(' Partner@FIRM.ps ')}`, send('GET')));
    expect(found.users.map((u: { id: string }) => u.id)).toEqual([user.id]);
    const none = await read(await h.app.request('/admin/v1/users?email=nobody%40firm.ps', send('GET')));
    expect(none.users).toEqual([]);
  });

  it('returns a user with its memberships by id, 404 when unknown', async () => {
    const h = harness();
    const org = await organization(h);
    const { user } = await createUser(h, org.id);
    const res = await h.app.request(`/admin/v1/users/${user.id}`, send('GET'));
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.user.id).toBe(user.id);
    expect(body.memberships.map((m: { organizationId: string }) => m.organizationId)).toEqual([org.id]);
    expect((await h.app.request('/admin/v1/users/00000000-0000-4000-8000-000000000000', send('GET'))).status).toBe(404);
  });
});

describe('memberships', () => {
  it('grants a second organization once, then reports it already existed', async () => {
    const h = harness();
    const a = await organization(h);
    const b = await organization(h);
    const { user } = await createUser(h, a.id);
    const first = await h.app.request(`/admin/v1/users/${user.id}/memberships`, send('POST', { organizationId: b.id }));
    expect(first.status).toBe(201);
    expect((await read(first)).created).toBe(true);
    const again = await h.app.request(`/admin/v1/users/${user.id}/memberships`, send('POST', { organizationId: b.id }));
    expect(again.status).toBe(200);
    expect((await read(again)).created).toBe(false);
  });

  it('answers 404 for an unknown user or organization on grant', async () => {
    const h = harness();
    const org = await organization(h);
    const { user } = await createUser(h, org.id);
    const nobody = '00000000-0000-4000-8000-000000000000';
    expect((await h.app.request(`/admin/v1/users/${nobody}/memberships`, send('POST', { organizationId: org.id }))).status).toBe(404);
    expect((await h.app.request(`/admin/v1/users/${user.id}/memberships`, send('POST', { organizationId: nobody }))).status).toBe(404);
  });

  it('removes once, then reports nothing removed; 404 for an unknown user', async () => {
    const h = harness();
    const a = await organization(h);
    const b = await organization(h);
    const { user } = await createUser(h, a.id);
    await h.app.request(`/admin/v1/users/${user.id}/memberships`, send('POST', { organizationId: b.id }));
    const first = await h.app.request(`/admin/v1/users/${user.id}/memberships/${b.id}`, send('DELETE'));
    expect(first.status).toBe(200);
    expect((await read(first)).removed).toBe(true);
    expect((await read(await h.app.request(`/admin/v1/users/${user.id}/memberships/${b.id}`, send('DELETE')))).removed).toBe(false);
    expect((await h.app.request(`/admin/v1/users/00000000-0000-4000-8000-000000000000/memberships/${b.id}`, send('DELETE'))).status).toBe(404);
  });
});

describe('password reset and status', () => {
  it('issues a new one-time password; the old one stops verifying', async () => {
    const h = harness();
    const org = await organization(h);
    const { user, initialPassword } = await createUser(h, org.id);
    h.clock.now = new Date('2026-10-11T10:30:00Z');
    const res = await h.app.request(`/admin/v1/users/${user.id}/password`, send('POST'));
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.password).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(body.password).not.toBe(initialPassword);
    expect(body.user.passwordChangedAt).toBe('2026-10-11T10:30:00.000Z');
    const stored = await h.store.users.getById(user.id);
    expect(await hasher.verify(stored!.passwordHash, initialPassword)).toBe(false);
    expect(await hasher.verify(stored!.passwordHash, body.password)).toBe(true);
    expect((await h.app.request('/admin/v1/users/00000000-0000-4000-8000-000000000000/password', send('POST'))).status).toBe(404);
  });

  it('disables idempotently and enables again', async () => {
    const h = harness();
    const org = await organization(h);
    const { user } = await createUser(h, org.id);
    for (let i = 0; i < 2; i++) {
      const res = await h.app.request(`/admin/v1/users/${user.id}/disable`, send('POST'));
      expect(res.status).toBe(200);
      expect((await read(res)).user.status).toBe('DISABLED');
    }
    const enabled = await h.app.request(`/admin/v1/users/${user.id}/enable`, send('POST'));
    expect((await read(enabled)).user.status).toBe('ACTIVE');
    expect((await h.app.request('/admin/v1/users/00000000-0000-4000-8000-000000000000/disable', send('POST'))).status).toBe(404);
  });
});

describe('audit', () => {
  it('appends each account mutation, as ADMIN, to every member organization', async () => {
    const h = harness();
    const a = await organization(h);
    const b = await organization(h);
    const { user } = await createUser(h, a.id);
    await h.app.request(`/admin/v1/users/${user.id}/memberships`, send('POST', { organizationId: b.id }));
    await h.app.request(`/admin/v1/users/${user.id}/password`, send('POST'));
    await h.app.request(`/admin/v1/users/${user.id}/disable`, send('POST'));
    await h.app.request(`/admin/v1/users/${user.id}/enable`, send('POST'));
    await h.app.request(`/admin/v1/users/${user.id}/memberships/${b.id}`, send('DELETE'));

    const userEvents = (events: { action: string; actorType: string; entityId: string }[]) =>
      events.filter((e) => e.entityId === user.id).map((e) => `${e.actorType}:${e.action}`);
    expect(userEvents(await auditActions(h, a.id))).toEqual([
      'ADMIN:user.created',
      'ADMIN:user.password_reset',
      'ADMIN:user.disabled',
      'ADMIN:user.enabled',
    ]);
    expect(userEvents(await auditActions(h, b.id))).toEqual([
      'ADMIN:membership.granted',
      'ADMIN:user.password_reset',
      'ADMIN:user.disabled',
      'ADMIN:user.enabled',
      'ADMIN:membership.revoked',
    ]);
  });

  it('records the email and display name on user.created', async () => {
    const h = harness();
    const org = await organization(h);
    const { user } = await createUser(h, org.id, 'nour@firm.ps');
    const res = await h.app.request(`/admin/v1/organizations/${org.id}/audit?limit=200`, send('GET'));
    const created = (await read(res)).events.find((e: { action: string; entityId: string }) => e.action === 'user.created' && e.entityId === user.id);
    expect(created).toMatchObject({ entityType: 'user', metadata: { email: 'nour@firm.ps', displayName: 'Nour Haddad' } });
  });

  it('still answers 200 for a user with no memberships, auditing nowhere', async () => {
    const h = harness();
    const org = await organization(h);
    const { user } = await createUser(h, org.id);
    await h.app.request(`/admin/v1/users/${user.id}/memberships/${org.id}`, send('DELETE'));
    const before = h.store.auditCount(org.id);
    expect((await h.app.request(`/admin/v1/users/${user.id}/password`, send('POST'))).status).toBe(200);
    expect(h.store.auditCount(org.id)).toBe(before);
  });
});

describe('admin authentication', () => {
  const routes: [string, string][] = [
    ['POST', '/admin/v1/users'],
    ['GET', '/admin/v1/users?email=a%40b.c'],
    ['GET', '/admin/v1/users/00000000-0000-4000-8000-000000000000'],
    ['POST', '/admin/v1/users/00000000-0000-4000-8000-000000000000/memberships'],
    ['DELETE', '/admin/v1/users/00000000-0000-4000-8000-000000000000/memberships/00000000-0000-4000-8000-000000000000'],
    ['POST', '/admin/v1/users/00000000-0000-4000-8000-000000000000/password'],
    ['POST', '/admin/v1/users/00000000-0000-4000-8000-000000000000/disable'],
    ['POST', '/admin/v1/users/00000000-0000-4000-8000-000000000000/enable'],
  ];

  it.each(routes)('%s %s refuses a missing or wrong admin token', async (method, path) => {
    const h = harness();
    for (const headers of [{}, { 'x-admin-token': 'wrong-token-with-at-least-32-characters!' }]) {
      const res = await h.app.request(path, send(method, method === 'GET' || method === 'DELETE' ? undefined : {}, headers));
      expect(res.status).toBe(401);
      expect((await read(res)).error.code).toBe('ADMIN_UNAUTHORIZED');
    }
  });
});

describe('secrets never reach the log', () => {
  it('logs no one-time password and no argon2 hash across every account operation', async () => {
    const h = harness();
    const a = await organization(h);
    const b = await organization(h);
    const { user, initialPassword } = await createUser(h, a.id);
    await h.app.request(`/admin/v1/users/${user.id}/memberships`, send('POST', { organizationId: b.id }));
    const reset = await read(await h.app.request(`/admin/v1/users/${user.id}/password`, send('POST')));
    await h.app.request(`/admin/v1/users/${user.id}/disable`, send('POST'));
    await h.app.request(`/admin/v1/users/${user.id}/enable`, send('POST'));

    const text = h.logs.join('');
    expect(h.logs.length).toBeGreaterThan(0);
    expect(text).not.toContain(initialPassword);
    expect(text).not.toContain(reset.password);
    expect(text).not.toContain('$argon2id$');
  });
});
