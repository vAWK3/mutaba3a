import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import pino from 'pino';
import { createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { requestFingerprint } from '../idempotency.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/**
 * MUT-199: the fingerprint covers the request's meaning, not its bytes. The phone widget (Swift JSONEncoder: random key
 * order, `/` escaped as `\/`) and the app's replay (Dart jsonEncode: insertion order) send the same capture as
 * different bytes; under a byte fingerprint the replay was refused as IDEMPOTENCY_KEY_REUSED.
 */

// The same capture as each client serialises it.
const WIDGET_BODY = '{"occurredOn":"2026-10-08","title":"Logo\\/brand refresh","currency":"ILS","amount":"650.00"}';
const APP_BODY = '{"amount":"650.00","currency":"ILS","occurredOn":"2026-10-08","title":"Logo/brand refresh"}';

describe('requestFingerprint (MUT-199)', () => {
  it('fingerprints the widget body and the app body for the same capture identically', () => {
    expect(requestFingerprint('POST', '/v1/income', WIDGET_BODY)).toBe(requestFingerprint('POST', '/v1/income', APP_BODY));
  });

  it('sorts nested keys too, and ignores insignificant whitespace and unicode escapes', () => {
    const a = '{ "b": { "y": 1, "x": [ {"q":2,"p":"é"} ] }, "a": null }';
    const b = '{"a":null,"b":{"x":[{"p":"\\u00e9","q":2}],"y":1}}';
    expect(requestFingerprint('POST', '/v1/x', a)).toBe(requestFingerprint('POST', '/v1/x', b));
  });

  it('still tells different requests apart: a value, array order, the method or the path', () => {
    const base = requestFingerprint('POST', '/v1/income', APP_BODY);
    expect(requestFingerprint('POST', '/v1/income', APP_BODY.replace('650.00', '651.00'))).not.toBe(base);
    expect(requestFingerprint('POST', '/v1/x', '[1,2]')).not.toBe(requestFingerprint('POST', '/v1/x', '[2,1]'));
    expect(requestFingerprint('PATCH', '/v1/income', APP_BODY)).not.toBe(base);
    expect(requestFingerprint('POST', '/v1/expenses', APP_BODY)).not.toBe(base);
  });

  it('falls back to the raw bytes for a body that is not JSON, and an empty body', () => {
    expect(requestFingerprint('POST', '/v1/x', 'not json')).not.toBe(requestFingerprint('POST', '/v1/x', 'not  json'));
    expect(requestFingerprint('POST', '/v1/x', '')).toBe(requestFingerprint('POST', '/v1/x', ''));
  });
});

describe('a replay whose bytes differ (MUT-199)', () => {
  const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
  const admin = { 'x-admin-token': ADMIN_TOKEN, 'content-type': 'application/json' };

  async function setup() {
    const store = new MemoryLedgerStore();
    const app = createApp({ store, logger: pino({ level: 'silent' }), rateLimiter: new SlidingWindowRateLimiter(100_000), adminToken: ADMIN_TOKEN, keyEnvironment: 'test', version: '0.4.0-test', now: () => new Date('2026-10-08T10:00:00Z') });
    const org = (await (await app.request('/admin/v1/organizations', { method: 'POST', headers: admin, body: JSON.stringify({ name: 'Firm', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }) })).json()) as { id: string };
    const key = (await (await app.request(`/admin/v1/organizations/${org.id}/api-keys`, { method: 'POST', headers: admin, body: JSON.stringify({ name: 'Malafat', scopes: SCOPES }) })).json()) as { secret: string };
    const post = (body: string, idempotencyKey: string) =>
      app.request('/v1/customers', { method: 'POST', headers: { authorization: `Bearer ${key.secret}`, 'content-type': 'application/json', 'idempotency-key': idempotencyKey }, body });
    return { store, org, post };
  }

  it('gets the stored 2xx, not IDEMPOTENCY_KEY_REUSED, and creates nothing twice', async () => {
    const { post } = await setup();
    const first = await post('{"notes":"a\\/b","name":"Acme"}', 'widget-key-0001');
    expect(first.status).toBe(201);
    const replay = await post('{"name":"Acme","notes":"a/b"}', 'widget-key-0001');
    expect(replay.status).toBe(201);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect(((await replay.json()) as { id: string }).id).toBe(((await first.json()) as { id: string }).id);

    const different = await post('{"name":"Acme","notes":"a/c"}', 'widget-key-0001');
    expect(different.status).toBe(422);
    expect(((await different.json()) as { error: { code: string } }).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('still replays a key stored before the change, under its byte fingerprint', async () => {
    const { store, org, post } = await setup();
    const body = '{"name":"Acme","notes":"a\\/b"}';
    const legacy = createHash('sha256').update(`POST\n/v1/customers\n${body}`).digest('hex');
    const at = new Date('2026-10-08T09:00:00Z');
    await store.idempotency.claim({ organizationId: org.id, key: 'legacy-key-0001', operation: 'customers.create', fingerprint: legacy, at });
    await store.idempotency.complete({ organizationId: org.id, key: 'legacy-key-0001', responseStatus: 201, responseBody: { id: 'stored-id' }, at });

    const replay = await post(body, 'legacy-key-0001');
    expect(replay.status).toBe(201);
    expect(((await replay.json()) as { id: string }).id).toBe('stored-id');
  });
});
