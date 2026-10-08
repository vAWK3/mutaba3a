import { beforeEach, describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp, API_VERSION } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';

interface Harness {
  app: ReturnType<typeof createApp>;
  store: MemoryLedgerStore;
  clock: { now: Date };
  limiter: SlidingWindowRateLimiter;
}

function harness(limit = 1000): Harness {
  const store = new MemoryLedgerStore();
  const clock = { now: new Date('2026-10-08T10:00:00Z') };
  const limiter = new SlidingWindowRateLimiter(limit);
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: limiter,
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
  });
  return { app, store, clock, limiter };
}

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

const admin = { 'x-admin-token': ADMIN_TOKEN };

async function provision(h: Harness, scopes: readonly string[] = SCOPES) {
  const orgRes = await h.app.request('/admin/v1/organizations', json({ name: `Sader Law Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin));
  expect(orgRes.status).toBe(201);
  const org = (await read(orgRes)) as { id: string; slug: string };
  const keyRes = await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes }, admin));
  expect(keyRes.status).toBe(201);
  const key = (await read(keyRes)) as { secret: string; apiKey: { id: string; masked: string } };
  return { org, key };
}

const bearer = (secret: string, extra: Record<string, string> = {}) => ({ headers: { authorization: `Bearer ${secret}`, ...extra } });

describe('operations', () => {
  it('serves health and readiness without auth', async () => {
    const h = harness();
    const health = await h.app.request('/health');
    expect(health.status).toBe(200);
    expect(await read(health)).toMatchObject({ status: 'ok', version: '0.1.0-test', time: '2026-10-08T10:00:00.000Z' });
    expect(health.headers.get('x-request-id')).toBeTruthy();
    expect(health.headers.get('cache-control')).toBe('no-store');
    const ready = await h.app.request('/ready');
    expect(ready.status).toBe(200);
  });

  it('echoes a caller-supplied request id and uses it in error envelopes', async () => {
    const h = harness();
    const res = await h.app.request('/nope', { headers: { 'x-request-id': 'req-123' } });
    expect(res.status).toBe(404);
    expect(await read(res)).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String), requestId: 'req-123' } });
  });

  it('publishes an OpenAPI 3.1 document with the scope and error vocabulary', async () => {
    const h = harness();
    const res = await h.app.request('/openapi.json');
    expect(res.status).toBe(200);
    const doc = (await read(res)) as { openapi: string; info: { version: string; description: string }; paths: Record<string, unknown>; components: { securitySchemes: Record<string, unknown> } };
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.version).toBe(API_VERSION);
    for (const s of SCOPES) expect(doc.info.description).toContain(s);
    expect(doc.info.description).toContain('IDEMPOTENCY_KEY_REUSED');
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/health', '/ready', '/v1/integration', '/v1/integration/bind', '/v1/integration/disconnect', '/admin/v1/organizations']),
    );
    expect(doc.components.securitySchemes).toHaveProperty('apiKey');
    expect(doc.components.securitySchemes).toHaveProperty('adminToken');
  });
});

describe('admin provisioning', () => {
  it('refuses a missing or wrong admin token in constant time', async () => {
    const h = harness();
    const none = await h.app.request('/admin/v1/organizations', json({ name: 'x', defaultCurrency: 'ILS', timezone: 'UTC' }));
    expect(none.status).toBe(401);
    expect((await read(none)).error.code).toBe('ADMIN_UNAUTHORIZED');
    const wrong = await h.app.request('/admin/v1/organizations', json({ name: 'x', defaultCurrency: 'ILS', timezone: 'UTC' }, { 'x-admin-token': ADMIN_TOKEN + 'x' }));
    expect(wrong.status).toBe(401);
  });

  it('creates an organization, derives a slug, and rejects a duplicate slug with CONFLICT', async () => {
    const h = harness();
    const res = await h.app.request('/admin/v1/organizations', json({ name: 'Haddad & Partners', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin));
    expect(res.status).toBe(201);
    expect(await read(res)).toMatchObject({ slug: 'haddad-partners', defaultCurrency: 'ILS' });
    const dup = await h.app.request('/admin/v1/organizations', json({ name: 'Other', slug: 'haddad-partners', defaultCurrency: 'ILS', timezone: 'UTC' }, admin));
    expect(dup.status).toBe(409);
    expect((await read(dup)).error.code).toBe('CONFLICT');
  });

  it('validates bodies into the error envelope', async () => {
    const h = harness();
    const res = await h.app.request('/admin/v1/organizations', json({ name: '', defaultCurrency: 'GBP', timezone: 'UTC' }, admin));
    expect(res.status).toBe(422);
    const body = await read(res);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(Array.isArray(body.error.details)).toBe(true);
  });

  it('issues a key whose secret appears once and is masked everywhere else, and audits it', async () => {
    const h = harness();
    const { org, key } = await provision(h);
    expect(key.secret).toMatch(/^mut_test_/);
    expect(key.apiKey.masked).toMatch(/^mut_test_[a-z0-9]{4}…[0-9a-f]{4}$/);

    const detail = await h.app.request(`/admin/v1/organizations/${org.id}`, { headers: admin });
    const body = await read(detail);
    expect(JSON.stringify(body)).not.toContain(key.secret);
    expect(body.apiKeys[0].masked).toBe(key.apiKey.masked);

    const audit = await h.app.request(`/admin/v1/organizations/${org.id}/audit`, { headers: admin });
    const events = (await read(audit)).events as Array<{ action: string }>;
    expect(events.map((e) => e.action)).toEqual(['api_key.issued', 'organization.created']);
  });

  it('rejects an unknown scope and a past expiry', async () => {
    const h = harness();
    const { org } = await provision(h);
    const bad = await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'x', scopes: ['money:everything'] }, admin));
    expect(bad.status).toBe(422);
    const past = await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'x', scopes: ['integration:read'], expiresAt: '2020-01-01T00:00:00Z' }, admin));
    expect(past.status).toBe(422);
    expect((await read(past)).error.message).toContain('future');
  });
});

describe('API key authentication', () => {
  let h: Harness;
  let secret: string;
  let keyId: string;

  beforeEach(async () => {
    h = harness();
    const p = await provision(h);
    secret = p.key.secret;
    keyId = p.key.apiKey.id;
  });

  it('validates a good key and reports organization, scopes, binding and server', async () => {
    const res = await h.app.request('/v1/integration', bearer(secret));
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.organization.name).toMatch(/^Sader Law Firm \d+$/);
    expect(body.apiKey.scopes).toEqual([...SCOPES]);
    expect(body.missingScopes).toEqual([]);
    expect(body.integration).toBeNull();
    expect(body.server).toEqual({ version: '0.1.0-test', apiVersion: 'v1', time: '2026-10-08T10:00:00.000Z' });
    expect(body.apiKey.lastUsedAt).toBeNull(); // touched after the response was built
    const again = await h.app.request('/v1/integration', bearer(secret));
    expect((await read(again)).apiKey.lastUsedAt).toBe('2026-10-08T10:00:00.000Z');
  });

  it.each([
    ['no header', {}, 'UNAUTHENTICATED'],
    ['wrong scheme', { authorization: 'Basic abc' }, 'UNAUTHENTICATED'],
    ['malformed', { authorization: 'Bearer not-a-key' }, 'INVALID_API_KEY'],
    ['wrong environment', { authorization: `Bearer ${'mut_live_abcdefgh_' + 'a'.repeat(43)}` }, 'API_KEY_ENVIRONMENT_MISMATCH'],
    ['unknown key', { authorization: `Bearer ${'mut_test_abcdefgh_' + 'a'.repeat(43)}` }, 'INVALID_API_KEY'],
  ])('rejects %s with a distinct code', async (_label, headers, code) => {
    const res = await h.app.request('/v1/integration', { headers });
    expect(res.status).toBe(401);
    expect((await read(res)).error.code).toBe(code);
  });

  it('rejects a key whose secret differs from the stored hash even with a matching prefix', async () => {
    const prefix = secret.split('_')[2];
    const forged = `mut_test_${prefix}_${'b'.repeat(43)}`;
    const res = await h.app.request('/v1/integration', bearer(forged));
    expect(res.status).toBe(401);
    expect((await read(res)).error.code).toBe('INVALID_API_KEY');
  });

  it('rejects a revoked key', async () => {
    await h.app.request(`/admin/v1/api-keys/${keyId}/revoke`, json({ reason: 'rotated' }, admin));
    const res = await h.app.request('/v1/integration', bearer(secret));
    expect(res.status).toBe(401);
    expect((await read(res)).error.code).toBe('API_KEY_REVOKED');
  });

  it('rejects an expired key once the clock passes expiresAt', async () => {
    const { org } = await provision(h);
    const keyRes = await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'short', scopes: ['integration:read'], expiresAt: '2026-10-08T11:00:00Z' }, admin));
    const { secret: s } = (await read(keyRes)) as { secret: string };
    expect((await h.app.request('/v1/integration', bearer(s))).status).toBe(200);
    h.clock.now = new Date('2026-10-08T11:00:00Z');
    const res = await h.app.request('/v1/integration', bearer(s));
    expect(res.status).toBe(401);
    expect((await read(res)).error.code).toBe('API_KEY_EXPIRED');
  });

  it('enforces scopes per route, non-hierarchically', async () => {
    const { key } = await provision(h, ['integration:write']);
    const res = await h.app.request('/v1/integration', bearer(key.secret));
    expect(res.status).toBe(403);
    const body = await read(res);
    expect(body.error.code).toBe('INSUFFICIENT_SCOPE');
    expect(body.error.details).toEqual({ required: 'integration:read', granted: ['integration:write'] });
  });

  it('reports missing scopes for Malafat on a narrow key', async () => {
    const { key } = await provision(h, ['integration:read']);
    const body = await read(await h.app.request('/v1/integration', bearer(key.secret)));
    expect(body.missingScopes).toEqual(SCOPES.filter((s) => s !== 'integration:read'));
  });

  it('rate limits per key with headers and Retry-After', async () => {
    const tight = harness(2);
    const { key } = await provision(tight);
    expect((await tight.app.request('/v1/integration', bearer(key.secret))).headers.get('x-ratelimit-remaining')).toBe('1');
    expect((await tight.app.request('/v1/integration', bearer(key.secret))).headers.get('x-ratelimit-remaining')).toBe('0');
    const limited = await tight.app.request('/v1/integration', bearer(key.secret));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect((await read(limited)).error.code).toBe('RATE_LIMITED');
  });
});

describe('integration binding', () => {
  let h: Harness;
  let secret: string;
  let orgId: string;
  const bind = (s: string, body: unknown, idem = 'idem-key-0001') =>
    h.app.request('/v1/integration/bind', json(body, { authorization: `Bearer ${s}`, 'idempotency-key': idem }));
  const malafat = { provider: 'MALAFAT', externalTenantId: 'tenant-sader', displayName: 'Sader Law Firm (sader.malafat.app)' };

  beforeEach(async () => {
    h = harness();
    const p = await provision(h);
    secret = p.key.secret;
    orgId = p.org.id;
  });

  it('requires an Idempotency-Key', async () => {
    const res = await h.app.request('/v1/integration/bind', json(malafat, { authorization: `Bearer ${secret}` }));
    expect(res.status).toBe(422);
    expect((await read(res)).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('binds, then re-binding the same tenant is a 200 no-op, and GET reflects it', async () => {
    const first = await bind(secret, malafat);
    expect(first.status).toBe(201);
    const created = await read(first);
    expect(created).toMatchObject({ created: true, integration: { status: 'CONNECTED', externalTenantId: 'tenant-sader' } });

    const second = await bind(secret, malafat, 'idem-key-0002');
    expect(second.status).toBe(200);
    expect(await read(second)).toMatchObject({ created: false, integration: { id: created.integration.id } });

    const status = await read(await h.app.request('/v1/integration', bearer(secret)));
    expect(status.integration).toMatchObject({ id: created.integration.id, status: 'CONNECTED' });
  });

  it('replays the stored outcome for the same key and body, and rejects the same key with a different body', async () => {
    const first = await bind(secret, malafat);
    expect(first.status).toBe(201);
    const replay = await bind(secret, malafat);
    expect(replay.status).toBe(201);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect(await read(replay)).toEqual(await read(first.clone()));

    const reused = await bind(secret, { ...malafat, displayName: 'Different' });
    expect(reused.status).toBe(422);
    expect((await read(reused)).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('refuses to bind a different tenant while connected (ORGANIZATION_MISMATCH)', async () => {
    await bind(secret, malafat);
    const other = await bind(secret, { ...malafat, externalTenantId: 'tenant-other' }, 'idem-key-0009');
    expect(other.status).toBe(409);
    const body = await read(other);
    expect(body.error.code).toBe('ORGANIZATION_MISMATCH');
    expect(body.error.details).toEqual({ connectedTenantId: 'tenant-sader' });
  });

  it('refuses a tenant already bound to another organization', async () => {
    await bind(secret, malafat);
    const other = await provision(h);
    const res = await bind(other.key.secret, malafat, 'idem-key-0010');
    expect(res.status).toBe(409);
    expect((await read(res)).error.code).toBe('ORGANIZATION_MISMATCH');
  });

  it('disconnect keeps the row, revokes the calling key, audits, and a fresh key can reconnect with the same id', async () => {
    const created = (await read(await bind(secret, malafat))).integration as { id: string };
    const off = await h.app.request('/v1/integration/disconnect', json({}, { authorization: `Bearer ${secret}` }));
    expect(off.status).toBe(200);
    expect(await read(off)).toMatchObject({ apiKeyRevoked: true, integration: { id: created.id, status: 'DISCONNECTED' } });

    const dead = await h.app.request('/v1/integration', bearer(secret));
    expect((await read(dead)).error.code).toBe('API_KEY_REVOKED');

    const newKey = (await read(await h.app.request(`/admin/v1/organizations/${orgId}/api-keys`, json({ name: 'rotated', scopes: SCOPES }, admin)))) as { secret: string };
    const again = await bind(newKey.secret, malafat, 'idem-key-0011');
    expect(again.status).toBe(201);
    expect((await read(again)).integration.id).toBe(created.id);

    const events = ((await read(await h.app.request(`/admin/v1/organizations/${orgId}/audit`, { headers: admin }))).events as Array<{ action: string }>).map((e) => e.action);
    expect(events).toEqual(['integration.reconnected', 'api_key.issued', 'integration.disconnected', 'integration.connected', 'api_key.issued', 'organization.created']);
  });

  it('self-revoke retires only the calling key and leaves the binding intact (rotation)', async () => {
    await bind(secret, malafat);
    const newKey = (await read(await h.app.request(`/admin/v1/organizations/${orgId}/api-keys`, json({ name: 'rotated', scopes: SCOPES }, admin)))) as { secret: string };
    const res = await h.app.request('/v1/api-keys/self/revoke', json({}, { authorization: `Bearer ${secret}` }));
    expect(res.status).toBe(200);
    expect((await read(res)).revokedAt).toBe('2026-10-08T10:00:00.000Z');
    expect((await read(await h.app.request('/v1/integration', bearer(secret)))).error.code).toBe('API_KEY_REVOKED');
    const status = await read(await h.app.request('/v1/integration', bearer(newKey.secret)));
    expect(status.integration.status).toBe('CONNECTED');
  });

  it('disconnect without a binding is NOT_FOUND and does not revoke the key', async () => {
    const res = await h.app.request('/v1/integration/disconnect', json({}, { authorization: `Bearer ${secret}` }));
    expect(res.status).toBe(404);
    expect((await h.app.request('/v1/integration', bearer(secret))).status).toBe(200);
  });

  it('never reveals one organization to another', async () => {
    await bind(secret, malafat);
    const other = await provision(h);
    const body = await read(await h.app.request('/v1/integration', bearer(other.key.secret)));
    expect(body.integration).toBeNull();
    expect(body.organization.id).toBe(other.org.id);
    expect(body.organization.id).not.toBe(orgId);
  });
});
