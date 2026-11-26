import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { UsageEventInput } from '../repositories/ports.js';
import { get, harness, minutes, operator, passwordSignIn, person, read, stepUp, type Harness } from './helpers/operator-harness.js';

/**
 * MUT-735 (ADR-281): Operator › Usage. A non-operator gets 404; reads need no step-up; the CSV export does
 * (RECENT_SIGN_IN_REQUIRED), and is UTF-8 with a byte-order mark.
 */
const MONTH = '2026-10'; // the harness clock: 2026-10-27, Jerusalem

const record = (h: Harness, subjectKey: string, n: number, over: Partial<UsageEventInput> = {}) =>
  Promise.all(
    Array.from({ length: n }, () =>
      h.store.usage.record({ occurredAt: h.clock.now, month: MONTH, subjectKey, actorUserId: null, organizationId: null, kind: 'DOCUMENT_ISSUED', detail: 'TAX_INVOICE', plan: 'solo', door: 'PORTAL', entityKey: randomUUID(), ...over }, null),
    ),
  );

async function seeded() {
  const h = harness();
  const op = await operator(h);
  const near = await person(h); // Solo, 41 of 50 documents (82%)
  const capped = await person(h); // Solo, 50 of 50
  const quiet = await person(h); // Business, 3 scans
  await record(h, `user:${near.id}`, 41);
  await record(h, `user:${capped.id}`, 50);
  await record(h, `user:${quiet.id}`, 3, { kind: 'SCAN', detail: 'LIBRARY', plan: 'business' });
  return { h, op, near, capped, quiet };
}

describe('Operator › Usage (MUT-735)', () => {
  it('is 404 for a person who is not an operator', async () => {
    const h = harness();
    const p = await person(h);
    const token = await passwordSignIn(h, p.email, p.password);
    for (const path of ['/v1/operator/usage/overview', '/v1/operator/usage/people', `/v1/operator/accounts/${p.id}/usage`, '/v1/operator/usage/routes', '/v1/operator/usage/export.csv?view=overview']) {
      expect((await get(h, path, token)).status, path).toBe(404);
    }
  });

  it('overview: per plan, payers, near / capped / over, and events per kind; this month by default', async () => {
    const { h, op } = await seeded();
    const res = await get(h, '/v1/operator/usage/overview', op.token);
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.month).toBe(MONTH);
    expect(body.plans).toEqual([
      { plan: 'business', payers: 1, near: 0, capped: 0, over: 0, kinds: [{ kind: 'SCAN', events: 3, payers: 1 }] },
      { plan: 'solo', payers: 2, near: 1, capped: 1, over: 0, kinds: [{ kind: 'DOCUMENT_ISSUED', events: 91, payers: 2 }] },
    ]);
    expect((await read(await get(h, '/v1/operator/usage/overview?month=2026-09', op.token))).plans).toEqual([]);
    expect((await get(h, '/v1/operator/usage/overview?month=2026-13', op.token)).status).toBe(422);
  });

  it('people: who is near or at a cap, with names and levels, paged', async () => {
    const { h, op, near, capped } = await seeded();
    const nearBody = await read(await get(h, '/v1/operator/usage/people?filter=near', op.token));
    expect(nearBody.items).toEqual([
      { subjectKey: `user:${near.id}`, userId: near.id, email: near.email, name: 'Basel Sader', plan: 'solo', meters: [{ meter: 'documents', used: 41, limit: 50, level: 'near' }, { meter: 'scans', used: 0, limit: 100, level: 'ok' }] },
    ]);
    const cappedBody = await read(await get(h, '/v1/operator/usage/people?filter=capped&plan=solo', op.token));
    expect(cappedBody.items.map((i: { userId: string }) => i.userId)).toEqual([capped.id]);
    const first = await read(await get(h, '/v1/operator/usage/people?limit=2', op.token));
    expect(first.items).toHaveLength(2);
    const second = await read(await get(h, `/v1/operator/usage/people?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`, op.token));
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });

  it('an account: six months against each month’s plan, and per profile', async () => {
    const { h, op, near } = await seeded();
    const profile = (await h.store.memberships.listByUser(near.id))[0]!.organizationId;
    await record(h, `user:${near.id}`, 2, { organizationId: profile, kind: 'SCAN', detail: 'EXPENSE' });
    const body = await read(await get(h, `/v1/operator/accounts/${near.id}/usage`, op.token));
    expect(body.months.map((m: { month: string }) => m.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(body.months[5]).toEqual({ month: '2026-10', plan: 'solo', meters: [{ meter: 'documents', used: 41, limit: 50, level: 'near' }, { meter: 'scans', used: 2, limit: 100, level: 'ok' }] });
    expect(body.months[0]).toEqual({ month: '2026-05', plan: 'none', meters: [{ meter: 'documents', used: 0, limit: null, level: 'ok' }, { meter: 'scans', used: 0, limit: null, level: 'ok' }] });
    const own = body.profiles.find((p: { organizationId: string | null }) => p.organizationId === profile);
    expect(own.name).toBeTruthy();
    expect(own.months[5]).toEqual({ month: '2026-10', documents: 0, scans: 2, other: 0 });
    expect((await get(h, `/v1/operator/accounts/${randomUUID()}/usage`, op.token)).status).toBe(404);
  });

  it('routes: the busiest routes over the last 7 days, with errors and p95', async () => {
    const { h, op } = await seeded();
    const buckets = Array.from({ length: 12 }, () => 0);
    await h.store.usage.addRouteUsage([
      { day: '2026-10-27', routeKey: 'POST /v1/issued-documents', plan: 'solo', statusClass: '2xx', count: 19, durationMsSum: 19 * 40, buckets: buckets.map((_, i) => (i === 3 ? 19 : 0)) },
      { day: '2026-10-26', routeKey: 'POST /v1/issued-documents', plan: 'solo', statusClass: '4xx', count: 1, durationMsSum: 900, buckets: buckets.map((_, i) => (i === 7 ? 1 : 0)) },
      { day: '2026-10-01', routeKey: 'GET /v1/me', plan: 'unknown', statusClass: '2xx', count: 5, durationMsSum: 5, buckets },
    ]);
    const body = await read(await get(h, '/v1/operator/usage/routes', op.token));
    expect(body.from).toBe('2026-10-21');
    expect(body.to).toBe('2026-10-27');
    expect(body.routes).toEqual([{ routeKey: 'POST /v1/issued-documents', count: 20, clientErrors: 1, serverErrors: 0, meanMs: 83, p95Ms: 50, p95Over: false }]);
    expect((await get(h, '/v1/operator/usage/routes?from=2026-10-28&to=2026-10-01', op.token)).status).toBe(422);
  });

  it('the CSV export needs a fresh passkey step-up; with it, a UTF-8 CSV with a BOM and the same totals', async () => {
    const { h, op } = await seeded();
    minutes(h, 60);
    const refused = await get(h, '/v1/operator/usage/export.csv?view=overview', op.token);
    expect(refused.status).toBe(403);
    expect((await read(refused)).error.code).toBe('RECENT_SIGN_IN_REQUIRED');
    expect((await stepUp(h, op.token, op.auth)).status).toBe(200);
    const res = await get(h, '/v1/operator/usage/export.csv?view=overview', op.token);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('usage-overview-2026-10.csv');
    const bytes = new Uint8Array(await res.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = (await res.text()).replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines).toEqual(['month,plan,payers,near,capped,over,kind,events,kind_payers', '2026-10,business,1,0,0,0,SCAN,3,1', '2026-10,solo,2,1,1,0,DOCUMENT_ISSUED,91,2']);
    const people = (await (await get(h, '/v1/operator/usage/export.csv?view=people&filter=capped', op.token)).text()).trim().split('\r\n');
    expect(people).toHaveLength(2);
    expect(people[1]).toContain(',solo,50,50,at_cap,0,100,ok');
    const routes = await get(h, '/v1/operator/usage/export.csv?view=routes', op.token);
    expect((await routes.text()).split('\r\n')[0]).toBe('from,to,route,requests,client_errors,server_errors,mean_ms,p95_ms,p95_over_10s');
  });
});
