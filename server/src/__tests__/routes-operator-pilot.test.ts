import { describe, expect, it } from 'vitest';
import { usageMonthOf } from '../usage/month.js';
import { ADMIN, get, harness, json, minutes, operator, person, read, type Harness, type Loose } from './helpers/operator-harness.js';

/**
 * MUT-757 (ADR-297): the operator's Accounts list with the Pilot filter: only accounts that held a pilot grant, the
 * chip on every row, and with the filter the first-scan and first-invoice ticks from one grouped usage read per page.
 */
const LIST = '/v1/operator/accounts';
const DAY = 86_400_000;

async function pilotFor(h: Harness, userId: string, body: Record<string, unknown> = {}) {
  const res = await h.app.request('/admin/v1/billing/grants', json({ userId, tier: 'BUSINESS', reason: 'pilot', cohort: 'dec-2026', ...body }, ADMIN));
  expect(res.status).toBe(201);
  return read(res);
}

async function used(h: Harness, userId: string, kind: 'SCAN' | 'DOCUMENT_ISSUED', at: Date) {
  await h.store.usage.record(
    { subjectKey: `user:${userId}`, plan: 'business', door: 'PHONE', actorUserId: userId, occurredAt: at, month: usageMonthOf(at), organizationId: null, kind, detail: kind === 'SCAN' ? 'LIBRARY' : 'RECEIPT', entityKey: `${kind}-${at.getTime()}-${Math.random()}` },
    null,
  );
}

describe('MUT-757 the Pilot filter on the Accounts list', () => {
  it('keeps the pilot testers only, each with the chip, the accountant and the two ticks', async () => {
    const h = harness();
    const op = await operator(h);
    const accountant = await person(h);
    minutes(h, 1);
    const scanned = await person(h);
    minutes(h, 1);
    const quiet = await person(h);
    minutes(h, 1);
    await person(h); // never a pilot
    const grant = await pilotFor(h, scanned.id, { referredByUserId: accountant.id });
    await pilotFor(h, quiet.id);
    const scanAt = new Date(h.clock.now.getTime() + 60_000);
    const invoiceAt = new Date(h.clock.now.getTime() + 120_000);
    await used(h, scanned.id, 'SCAN', scanAt);
    await used(h, scanned.id, 'SCAN', new Date(scanAt.getTime() + 60_000));
    await used(h, scanned.id, 'DOCUMENT_ISSUED', invoiceAt);

    const body = await read(await get(h, `${LIST}?pilot=1`, op.token));
    expect(body.data.map((a: Loose) => a.id)).toEqual([quiet.id, scanned.id]);
    expect(body.data[1]).toMatchObject({
      pilot: { cohort: 'dec-2026', startedAt: grant.createdAt, endsAt: grant.expiresAt, referredBy: { id: accountant.id, email: accountant.email, displayName: 'Basel Sader' } },
      milestones: { firstScanAt: scanAt.toISOString(), firstInvoiceAt: invoiceAt.toISOString() },
    });
    expect(body.data[0]).toMatchObject({ pilot: { referredBy: null }, milestones: { firstScanAt: null, firstInvoiceAt: null } });
  });

  it('without the filter every row has `pilot` (null for most) and no ticks', async () => {
    const h = harness();
    const op = await operator(h);
    const tester = await person(h);
    await pilotFor(h, tester.id);
    const body = await read(await get(h, LIST, op.token));
    const row = body.data.find((a: Loose) => a.id === tester.id);
    expect(row.pilot).toMatchObject({ cohort: 'dec-2026' });
    expect(row).not.toHaveProperty('milestones');
    expect(body.data.find((a: Loose) => a.id === op.id).pilot).toBeNull();
  });

  it('an ended pilot stays in the list with its end; the cursor continues exactly', async () => {
    const h = harness();
    const op = await operator(h);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      minutes(h, 1);
      const p = await person(h);
      ids.push(p.id);
      await pilotFor(h, p.id, { expiresAt: new Date(h.clock.now.getTime() + (i + 1) * DAY).toISOString() });
    }
    const first = await read(await get(h, `${LIST}?pilot=1&limit=2`, op.token));
    const second = await read(await get(h, `${LIST}?pilot=1&limit=2&cursor=${first.nextCursor}`, op.token));
    expect([...first.data, ...second.data].map((a: Loose) => a.id)).toEqual([...ids].reverse());
    expect(second.nextCursor).toBeNull();
    expect(second.data[0].milestones).toEqual({ firstScanAt: null, firstInvoiceAt: null });
  });

  it('refuses a filter value it does not know (422)', async () => {
    const h = harness();
    const op = await operator(h);
    expect((await get(h, `${LIST}?pilot=yes`, op.token)).status).toBe(422);
  });
});
