import { describe, expect, it } from 'vitest';
import { MemoryLedgerStore } from '../repositories/memory.js';
import type { UsageMeter } from '../usage/kinds.js';
import { usageMonthOf } from '../usage/month.js';
import { ADMIN, businessOf, idem, issuingHarness, json, person, read, type AccountantHarness, type Person } from './helpers/accountants.js';

/**
 * MUT-733 (ADR-292): with PAID_HARD_CAPS on, Solo's and Business's monthly meters refuse at the cap; the first refusal
 * offers the account's once-ever gift (`gift: 'available'`), POST /v1/billing/over-cap-gift takes it and the same
 * request then goes through; later refusals (another month, or the other meter) are hard caps. Firm stays soft.
 */
const ISSUER = { legalName: 'Barmajiyat Ltd.', vatId: '123456782', dealerType: 'COMPANY', city: 'Nazareth' };

function harness(options: { paidHardCaps?: boolean } = {}) {
  return issuingHarness({ store: new MemoryLedgerStore({ starterPlan: true, paidHardCaps: options.paidHardCaps ?? true }), invoicingForAll: true, planCheckout: true });
}

async function onPlan(h: AccountantHarness, tier: 'SOLO' | 'BUSINESS' | 'FIRM') {
  const who = await person(h);
  expect((await h.app.request('/admin/v1/billing/grants', json({ userId: who.userId, tier, reason: 'MUT-733 test' }, ADMIN))).status).toBe(201);
  const profileId = await businessOf(h, who, 'Barmajiyat');
  const on = who.on(profileId);
  expect((await h.app.request('/v1/issuer', json(ISSUER, on, 'PUT'))).status).toBe(200);
  expect((await h.app.request('/v1/issuing/numbering', json({ alreadyIssuing: false }, on, 'PUT'))).status).toBe(200);
  const customer = await read(await h.app.request('/v1/customers', json({ name: 'Acme Digital Ltd.' }, { ...on, ...idem() })));
  return { who, profileId, on, customerId: customer.id as string };
}

const invoice = (customerId: string) => ({ docType: 'TAX_INVOICE', documentDate: '2026-11-05', currency: 'ILS', language: 'he', customerId, lines: [{ description: 'Sprint 3', kind: 'SERVICE', quantity: '1', unitPrice: '1000.00' }] });

async function seed(h: AccountantHarness, userId: string, meter: UsageMeter, n: number, plan = 'solo') {
  const at = h.now();
  for (let i = 0; i < n; i++) {
    await (h.store as MemoryLedgerStore).usage.record(
      { subjectKey: `user:${userId}`, plan: plan as 'solo', door: 'PORTAL', actorUserId: userId, occurredAt: at, month: usageMonthOf(at), organizationId: null, kind: meter === 'DOCUMENTS' ? 'DOCUMENT_ISSUED' : 'SCAN', detail: meter === 'DOCUMENTS' ? 'TAX_INVOICE' : 'LIBRARY', entityKey: `seed-${meter}-${i}-${Math.random()}` },
      null,
    );
  }
}

const issue = (h: AccountantHarness, w: { on: Record<string, string>; customerId: string }) => h.app.request('/v1/issued-documents', json(invoice(w.customerId), { ...w.on, ...idem() }));
const takeGift = (h: AccountantHarness, who: Person, body: Record<string, unknown>) => h.app.request('/v1/billing/over-cap-gift', json(body, who.auth));

describe('MUT-733 paid hard caps and the over-cap gift', () => {
  it('Solo at 50/50: refused with gift available; the gift taken, the same invoice and more go through; usage says graceUntil', async () => {
    const h = harness();
    const w = await onPlan(h, 'SOLO');
    await seed(h, w.who.userId, 'DOCUMENTS', 50);
    const refused = await issue(h, w);
    expect(refused.status).toBe(409);
    expect((await read(refused)).error).toMatchObject({ code: 'PLAN_LIMIT', details: { limit: 'documents', plan: 'solo', used: 50, cap: 50, nextPlan: 'business', gift: 'available' } });
    const taken = await takeGift(h, w.who, { meter: 'documents' });
    expect(taken.status).toBe(200);
    expect(await read(taken)).toEqual({ meter: 'documents', until: '2026-11-30T22:00:00.000Z' });
    for (let i = 0; i < 3; i++) expect((await issue(h, w)).status).toBe(201);
    const usage = (await read(await h.app.request('/v1/billing', { headers: w.who.auth }))).usage;
    expect(usage.gift).toEqual({ available: false });
    expect(usage.meters.find((m: { meter: string }) => m.meter === 'documents')).toMatchObject({ limit: 50, graceUntil: '2026-11-30T22:00:00.000Z' });
    // A retry after a lost answer is fine; the other meter has no second gift.
    expect((await takeGift(h, w.who, { meter: 'documents' })).status).toBe(200);
    expect((await read(await takeGift(h, w.who, { meter: 'scans' }))).error.code).toBe('GIFT_USED');
  });

  it('next month the cap is hard: no gift on the refusal', async () => {
    const h = harness();
    const w = await onPlan(h, 'SOLO');
    await seed(h, w.who.userId, 'DOCUMENTS', 50);
    expect((await takeGift(h, w.who, { meter: 'documents' })).status).toBe(200);
    h.setNow(new Date('2026-12-05T09:00:00Z'));
    await seed(h, w.who.userId, 'DOCUMENTS', 50);
    const refused = await read(await issue(h, w));
    expect(refused.error.code).toBe('PLAN_LIMIT');
    expect(refused.error.details.gift).toBeUndefined();
  });

  it('the gift can’t be taken early, on Firm (soft), on Starter, or with the flag off', async () => {
    const h = harness();
    const solo = await onPlan(h, 'SOLO');
    await seed(h, solo.who.userId, 'DOCUMENTS', 49);
    expect((await read(await takeGift(h, solo.who, { meter: 'documents' }))).error.code).toBe('GIFT_NOT_AVAILABLE');
    const firm = await onPlan(h, 'FIRM');
    await seed(h, firm.who.userId, 'DOCUMENTS', 1000, 'firm');
    expect((await issue(h, firm)).status).toBe(201);
    expect((await read(await takeGift(h, firm.who, { meter: 'documents' }))).error.code).toBe('GIFT_NOT_AVAILABLE');

    const off = harness({ paidHardCaps: false });
    const w = await onPlan(off, 'SOLO');
    await seed(off, w.who.userId, 'DOCUMENTS', 50);
    expect((await issue(off, w)).status).toBe(201);
    expect((await read(await takeGift(off, w.who, { meter: 'documents' }))).error.code).toBe('GIFT_NOT_AVAILABLE');
  });

  it('an upgrade lifts the cap at once', async () => {
    const h = harness();
    const w = await onPlan(h, 'SOLO');
    await seed(h, w.who.userId, 'DOCUMENTS', 50);
    expect((await issue(h, w)).status).toBe(409);
    expect((await h.app.request('/admin/v1/billing/grants', json({ userId: w.who.userId, tier: 'BUSINESS', reason: 'upgrade' }, ADMIN))).status).toBe(201);
    expect((await issue(h, w)).status).toBe(201);
  });
});
