import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { generateApiKey } from '../auth/api-key.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import type { ProfileType } from '../repositories/ports.js';

/**
 * MUT-182 standalone guarantee (owner ruling, 2026-10-14): a profile a person
 * creates is a standalone organization hosted on our servers, never a Malafat
 * one. Every door MUT-120 closed on the personal profile is closed on it too —
 * no API key issued or accepted (so no Malafat bind), never granted to or
 * provisioned into another person, never revoked from its owner — with
 * reason OWNED_PROFILE, while the built-in profile keeps PERSONAL_PROFILE.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };

function harness() {
  const store = new MemoryLedgerStore();
  const clock = { now: new Date('2026-10-14T09:00:00Z') };
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
  });
  return { app, store, clock };
}
type Harness = ReturnType<typeof harness>;

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

async function user(h: Harness) {
  const created = await read(
    await h.app.request('/admin/v1/users', json({ email: `owner${++seq}@studio.ps`, displayName: 'Rana Saleh', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)),
  );
  return created.user.id as string;
}

async function ownedProfile(h: Harness, ownerId: string, profileType: ProfileType) {
  const result = await h.store.organizations.createOwned(ownerId, { name: 'Studio', slug: `p-${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', profileType, at: h.clock.now }, 6, { actorId: ownerId, requestId: null });
  if (result.kind !== 'created') throw new Error('cap');
  return result.organization.id;
}

const OWNED = { code: 'CONFLICT', details: { reason: 'OWNED_PROFILE' } };

describe.each(['BUSINESS', 'PERSONAL'] as const)('an owned %s profile is standalone (MUT-182)', (profileType) => {
  it('is never issued an API key (S1)', async () => {
    const h = harness();
    const id = await ownedProfile(h, await user(h), profileType);
    const res = await h.app.request(`/admin/v1/organizations/${id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin));
    expect(res.status).toBe(409);
    expect((await read(res)).error).toMatchObject(OWNED);
    expect(await h.store.apiKeys.listByOrganization(id)).toEqual([]);
  });

  it('refuses a key planted below the admin API, so it can never be bound to Malafat or read by a key (S2, S3)', async () => {
    const h = harness();
    const id = await ownedProfile(h, await user(h), profileType);
    const generated = generateApiKey('test');
    await h.store.apiKeys.create({ organizationId: id, name: 'planted', environment: generated.environment, prefix: generated.prefix, keyHash: generated.keyHash, scopes: [...SCOPES], expiresAt: null });
    const bind = await h.app.request(
      '/v1/integration/bind',
      json({ provider: 'MALAFAT', externalTenantId: `tenant-${seq}`, displayName: 'Nope' }, { authorization: `Bearer ${generated.secret}`, 'idempotency-key': `idem-owned-${seq}` }),
    );
    expect(bind.status).toBe(409);
    expect((await read(bind)).error).toMatchObject(OWNED);
    expect(await h.store.integrations.findByOrganizationAndProvider(id, 'MALAFAT')).toBeNull();
    const ledger = await h.app.request('/v1/customers', { headers: { authorization: `Bearer ${generated.secret}` } });
    expect(ledger.status).toBe(409);
  });

  it('is never granted to another person (S4)', async () => {
    const h = harness();
    const owner = await user(h);
    const id = await ownedProfile(h, owner, profileType);
    const other = await user(h);
    const res = await h.app.request(`/admin/v1/users/${other}/memberships`, json({ organizationId: id }, admin));
    expect(res.status).toBe(409);
    expect((await read(res)).error).toMatchObject(OWNED);
    expect(await h.store.memberships.find(other, id)).toBeNull();
    // Its owner already holds it: granting it to them again is the usual idempotent no-op.
    expect((await h.app.request(`/admin/v1/users/${owner}/memberships`, json({ organizationId: id }, admin))).status).toBe(200);
  });

  it('is never the firm a new user is provisioned into (S5)', async () => {
    const h = harness();
    const id = await ownedProfile(h, await user(h), profileType);
    const res = await h.app.request('/admin/v1/users', json({ email: `newcomer${++seq}@firm.ps`, displayName: 'New', organizationId: id }, admin));
    expect(res.status).toBe(409);
    expect((await read(res)).error).toMatchObject(OWNED);
  });

  it('is never revoked from its owner (S5)', async () => {
    const h = harness();
    const owner = await user(h);
    const id = await ownedProfile(h, owner, profileType);
    const res = await h.app.request(`/admin/v1/users/${owner}/memberships/${id}`, { method: 'DELETE', headers: admin });
    expect(res.status).toBe(409);
    expect((await read(res)).error).toMatchObject(OWNED);
    expect(await h.store.memberships.find(owner, id)).not.toBeNull();
  });
});

describe('a personal profile the old revision wrote without an owner stays protected (qa-reconcile D1)', () => {
  /** The shape a pre-MUT-182 revision writes during a deploy's roll window or after a rollback: personalOwnerUserId only. */
  async function unstampedPersonal(h: Harness) {
    const owner = await user(h);
    const id = (await h.store.memberships.listByUser(owner))[0]!.organizationId;
    const row = (h.store as unknown as { orgs: Map<string, { ownerUserId: string | null; profileType: string | null }> }).orgs.get(id)!;
    Object.assign(row, { ownerUserId: null, profileType: null });
    return { owner, id };
  }

  it('is still refused an API key and a grant to anyone else, as PERSONAL_PROFILE', async () => {
    const h = harness();
    const { id } = await unstampedPersonal(h);
    const key = await h.app.request(`/admin/v1/organizations/${id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin));
    expect((await read(key)).error).toMatchObject({ code: 'CONFLICT', details: { reason: 'PERSONAL_PROFILE' } });
    const other = await user(h);
    const grant = await h.app.request(`/admin/v1/users/${other}/memberships`, json({ organizationId: id }, admin));
    expect((await read(grant)).error).toMatchObject({ code: 'CONFLICT', details: { reason: 'PERSONAL_PROFILE' } });
  });

  it('still counts toward its owner’s cap', async () => {
    const h = harness();
    const { owner } = await unstampedPersonal(h);
    expect(await h.store.organizations.countOwnedBy(owner)).toBe(1);
  });
});

describe('the built-in personal profile keeps its own reason (MUT-120 regression)', () => {
  it('still answers PERSONAL_PROFILE on an API key request', async () => {
    const h = harness();
    const owner = await user(h);
    const personal = (await h.store.memberships.listByUser(owner))[0]!.organizationId;
    const res = await h.app.request(`/admin/v1/organizations/${personal}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin));
    expect((await read(res)).error).toMatchObject({ code: 'CONFLICT', details: { reason: 'PERSONAL_PROFILE' } });
  });
});
