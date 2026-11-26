import { describe, expect, it } from 'vitest';
import { MemoryAttachmentStorage } from '../attachments/storage.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import type { UsageMeter } from '../usage/kinds.js';
import { usageMonthOf } from '../usage/month.js';
import { ADMIN, businessOf, idem, issuingHarness, json, person, read, type AccountantHarness, type Person } from './helpers/accountants.js';

/**
 * MUT-731 (ADR-284, brief §3.3): Starter's limits are hard caps at their one door each, refused with 409 PLAN_LIMIT
 * (limit, used, cap, resetsOn, nextPlan, canUpgrade). Every document counts, but a receipt for a payment on an issued
 * document is never refused (Basel 2026-11-25). Nothing is refused with STARTER_PLAN off.
 */

const ISSUER = { legalName: 'Barmajiyat Ltd.', vatId: '123456789', dealerType: 'COMPANY', city: 'Nazareth' };
const FILE = { filename: 'cafe.jpg', mimeType: 'image/jpeg', sizeBytes: 2048 };

function starterHarness(options: { starter?: boolean; planCheckout?: boolean } = {}) {
  const storage = new MemoryAttachmentStorage();
  const h = issuingHarness({
    store: new MemoryLedgerStore({ starterPlan: options.starter ?? true }),
    attachments: storage,
    attachmentUrlTtlSeconds: 600,
    receiptUploadLimiter: new SlidingWindowRateLimiter(1_000),
    receiptsLibrary: true,
    invoicingForAll: true,
    planCheckout: options.planCheckout ?? true,
  });
  return { ...h, storage };
}
type StarterHarness = ReturnType<typeof starterHarness>;

async function issuing(h: AccountantHarness, owner?: Person) {
  const who = owner ?? (await person(h));
  const profileId = await businessOf(h, who, 'Barmajiyat');
  const on = who.on(profileId);
  expect((await h.app.request('/v1/issuer', json(ISSUER, on, 'PUT'))).status).toBe(200);
  expect((await h.app.request('/v1/issuing/numbering', json({ alreadyIssuing: false }, on, 'PUT'))).status).toBe(200);
  const customer = await read(await h.app.request('/v1/customers', json({ name: 'Acme Digital Ltd.' }, { ...on, ...idem() })));
  return { owner: who, profileId, on, customerId: customer.id as string };
}

const invoice = (customerId: string, over: Record<string, unknown> = {}) => ({
  docType: 'TAX_INVOICE',
  documentDate: '2026-11-05',
  currency: 'ILS',
  language: 'he',
  customerId,
  lines: [{ description: 'Sprint 3', kind: 'SERVICE', quantity: '1', unitPrice: '1000.00' }],
  ...over,
});

const store = (h: AccountantHarness) => h.store as MemoryLedgerStore;

/** Counts `n` events on the person's meter this month, as if they had happened (the counter is what a cap reads). */
async function seed(h: AccountantHarness, userId: string, meter: UsageMeter, n: number) {
  const at = h.now();
  for (let i = 0; i < n; i++) {
    await store(h).usage.record(
      {
        subjectKey: `user:${userId}`,
        plan: 'starter',
        door: 'PORTAL',
        actorUserId: userId,
        occurredAt: at,
        month: usageMonthOf(at),
        organizationId: null,
        kind: meter === 'DOCUMENTS' ? 'DOCUMENT_ISSUED' : 'SCAN',
        detail: meter === 'DOCUMENTS' ? 'TAX_INVOICE' : 'LIBRARY',
        entityKey: `seed-${meter}-${i}-${Math.random()}`,
      },
      null,
    );
  }
}

const countOf = async (h: AccountantHarness, userId: string, meter: UsageMeter) =>
  (await store(h).usage.countersFor(`user:${userId}`, [usageMonthOf(h.now())])).find((c) => c.meter === meter)!.count;

describe('documents: 3 a month on Starter', () => {
  it('the 4th document is 409 PLAN_LIMIT naming the limit, the counts, the reset day and Solo; nothing is issued', async () => {
    const h = starterHarness();
    const w = await issuing(h);
    for (let i = 0; i < 3; i++) expect((await h.app.request('/v1/issued-documents', json(invoice(w.customerId), { ...w.on, ...idem() }))).status).toBe(201);
    const refused = await h.app.request('/v1/issued-documents', json(invoice(w.customerId), { ...w.on, ...idem() }));
    expect(refused.status).toBe(409);
    expect((await read(refused)).error).toMatchObject({
      code: 'PLAN_LIMIT',
      details: { limit: 'documents', plan: 'starter', used: 3, cap: 3, resetsOn: '2026-12-01', nextPlan: 'solo', canUpgrade: true },
    });
    expect(await countOf(h, w.owner.userId, 'DOCUMENTS')).toBe(3);
    const list = await read(await h.app.request('/v1/issued-documents', { headers: w.on }));
    expect(list.items ?? list.documents ?? list).toHaveLength(3);
  });

  it('canUpgrade is false where no paid plan can be bought', async () => {
    const h = starterHarness({ planCheckout: false });
    const w = await issuing(h);
    await seed(h, w.owner.userId, 'DOCUMENTS', 3);
    const refused = await h.app.request('/v1/issued-documents', json(invoice(w.customerId), { ...w.on, ...idem() }));
    expect((await read(refused)).error.details.canUpgrade).toBe(false);
  });

  it('at 3/3 a receipt for a payment on an issued invoice is never refused, and still counts', async () => {
    const h = starterHarness();
    const w = await issuing(h);
    const first = await read(await h.app.request('/v1/issued-documents', json(invoice(w.customerId), { ...w.on, ...idem() })));
    await seed(h, w.owner.userId, 'DOCUMENTS', 2);
    const receipt = { docType: 'RECEIPT', documentDate: '2026-11-05', currency: 'ILS', language: 'he', customerId: w.customerId, appliesToDocumentId: first.id, payment: { method: 'BANK', receivedOn: '2026-11-05' }, lines: [{ description: 'Payment', kind: 'SERVICE', quantity: '1', unitPrice: '500.00' }] };
    const paid = await h.app.request('/v1/issued-documents', json(receipt, { ...w.on, ...idem() }));
    expect(paid.status, await paid.clone().text()).toBe(201);
    expect(await countOf(h, w.owner.userId, 'DOCUMENTS')).toBe(4);
  });

  it('a credit note is a new document: refused at 3/3', async () => {
    const h = starterHarness();
    const w = await issuing(h);
    const first = await read(await h.app.request('/v1/issued-documents', json(invoice(w.customerId), { ...w.on, ...idem() })));
    await seed(h, w.owner.userId, 'DOCUMENTS', 2);
    const credit = { docType: 'CREDIT_NOTE', documentDate: '2026-11-05', currency: 'ILS', language: 'he', customerId: w.customerId, originalId: first.id, lines: [{ description: 'Discount', kind: 'SERVICE', quantity: '1', unitPrice: '100.00' }] };
    expect((await h.app.request('/v1/issued-documents', json(credit, { ...w.on, ...idem() }))).status).toBe(409);
  });

  it('the next Jerusalem month opens again (22:00 UTC on the last day is already the 1st there)', async () => {
    const h = starterHarness();
    const w = await issuing(h);
    await seed(h, w.owner.userId, 'DOCUMENTS', 3);
    h.setNow(new Date('2026-11-30T22:30:00Z'));
    const res = await h.app.request('/v1/issued-documents', json(invoice(w.customerId, { documentDate: '2026-12-01' }), { ...w.on, ...idem() }));
    expect(res.status, await res.clone().text()).toBe(201);
  });

  it('refused at 3/3 → upgraded (an operator grant of Solo) → the same Idempotency-Key issues (the key was released, TD-340)', async () => {
    const h = starterHarness();
    const w = await issuing(h);
    await seed(h, w.owner.userId, 'DOCUMENTS', 3);
    const key = idem();
    expect((await h.app.request('/v1/issued-documents', json(invoice(w.customerId), { ...w.on, ...key }))).status).toBe(409);
    expect((await h.app.request('/admin/v1/billing/grants', json({ userId: w.owner.userId, tier: 'SOLO', reason: 'test upgrade' }, ADMIN))).status).toBe(201);
    const res = await h.app.request('/v1/issued-documents', json(invoice(w.customerId), { ...w.on, ...key }));
    expect(res.status, await res.clone().text()).toBe(201);
  });

  it('a replay of an issued document at 3/3 answers the original 201, never a refusal', async () => {
    const h = starterHarness();
    const w = await issuing(h);
    await seed(h, w.owner.userId, 'DOCUMENTS', 2);
    const key = idem();
    const first = await h.app.request('/v1/issued-documents', json(invoice(w.customerId), { ...w.on, ...key }));
    expect(first.status).toBe(201);
    const again = await h.app.request('/v1/issued-documents', json(invoice(w.customerId), { ...w.on, ...key }));
    expect(again.status).toBe(201);
    expect((await read(again)).id).toBe((await read(first)).id);
  });

  it('a co-owner’s document is capped by the creator’s counter', async () => {
    const h = starterHarness();
    const w = await issuing(h);
    const partner = await person(h);
    await h.store.memberships.grantOwner(partner.userId, w.profileId, h.now(), 3, { organizationId: w.profileId, actorType: 'ADMIN', actorId: null, action: 'membership.owner_granted', entityType: 'membership', entityId: partner.userId, requestId: 'test' });
    await seed(h, w.owner.userId, 'DOCUMENTS', 3);
    const res = await h.app.request('/v1/issued-documents', json(invoice(w.customerId), { ...partner.on(w.profileId), ...idem() }));
    expect(res.status).toBe(409);
  });

  it('with STARTER_PLAN off nothing is refused (the counter still counts)', async () => {
    const h = starterHarness({ starter: false });
    const w = await issuing(h);
    await seed(h, w.owner.userId, 'DOCUMENTS', 3);
    expect((await h.app.request('/v1/issued-documents', json(invoice(w.customerId), { ...w.on, ...idem() }))).status).toBe(201);
    expect(await countOf(h, w.owner.userId, 'DOCUMENTS')).toBe(4);
  });
});

describe('scans: 12 a month on Starter, counted when the upload finishes', () => {
  async function uploader(h: StarterHarness) {
    const who = await person(h);
    const as = who.on(who.personalId);
    const keyOf = (url: string) => new URL(url).pathname.replace(/^\/+/, '').replace(/^upload\//, '');
    const start = async () => h.app.request('/v1/receipts/uploads', json(FILE, { ...as, ...idem() }));
    const finish = async (started: { receipt: { id: string }; upload: { url: string } }) => {
      h.storage.put(keyOf(started.upload.url), { sizeBytes: FILE.sizeBytes, contentType: FILE.mimeType });
      return h.app.request(`/v1/receipts/${started.receipt.id}/complete`, { method: 'POST', headers: as });
    };
    return { who, as, start, finish };
  }

  it('at 12/12 the 13th start is refused before anything is uploaded', async () => {
    const h = starterHarness();
    const u = await uploader(h);
    await seed(h, u.who.userId, 'SCANS', 12);
    const refused = await u.start();
    expect(refused.status).toBe(409);
    expect((await read(refused)).error.details).toMatchObject({ limit: 'scans', used: 12, cap: 12, nextPlan: 'solo' });
  });

  it('two uploads racing at 11/12 both start; the second complete is refused and the receipt stays unfinished', async () => {
    const h = starterHarness();
    const u = await uploader(h);
    await seed(h, u.who.userId, 'SCANS', 11);
    const a = await read(await u.start());
    const b = await read(await u.start());
    expect((await u.finish(a)).status).toBe(200);
    const second = await u.finish(b);
    expect(second.status).toBe(409);
    expect((await read(second)).error.details.limit).toBe('scans');
    expect(await countOf(h, u.who.userId, 'SCANS')).toBe(12);
    expect((await store(h).expenseReceipts.getById(u.who.personalId, b.receipt.id))!.status).toBe('PENDING_UPLOAD');
  });

  it('a receipt finished on an expense counts against the same 12', async () => {
    const h = starterHarness();
    const u = await uploader(h);
    await seed(h, u.who.userId, 'SCANS', 12);
    const expense = await read(await h.app.request('/v1/expenses', json({ amount: '12.00', currency: 'ILS', occurredOn: '2026-11-05', title: 'Coffee' }, { ...u.as, ...idem() })));
    expect((await h.app.request(`/v1/expenses/${expense.id}/receipts`, json(FILE, { ...u.as, ...idem() }))).status).toBe(409);
  });
});

describe('businesses: one beside the personal profile on Starter', () => {
  const business = (name: string, extra: Record<string, unknown> = {}) => json({ name, type: 'BUSINESS', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', ...extra });

  it('a second business is 409 PLAN_LIMIT (businesses); a carried-over one is created', async () => {
    const h = starterHarness();
    const who = await person(h);
    expect((await h.app.request('/v1/profiles', { ...business('First'), headers: { ...(business('First').headers as Record<string, string>), ...who.auth, ...idem() } })).status).toBe(201);
    const second = await h.app.request('/v1/profiles', { ...business('Second'), headers: { ...(business('Second').headers as Record<string, string>), ...who.auth, ...idem() } });
    expect(second.status).toBe(409);
    expect((await read(second)).error).toMatchObject({ code: 'PLAN_LIMIT', details: { limit: 'businesses', cap: 1, used: 1, nextPlan: 'solo' } });
    const carried = await h.app.request('/v1/profiles', { ...business('Carried', { carriedOver: true }), headers: { 'content-type': 'application/json', ...who.auth, ...idem() } });
    expect(carried.status).toBe(201);
  });

  it('/v1/me publishes Starter’s cap (personal + 1) as maxOwnedProfiles', async () => {
    const h = starterHarness();
    const who = await person(h);
    expect((await read(await h.app.request('/v1/me', { headers: who.auth }))).limits.maxOwnedProfiles).toBe(2);
  });

  it('off, the 6-profile limit only', async () => {
    const h = starterHarness({ starter: false });
    const who = await person(h);
    for (const name of ['A', 'B']) expect((await h.app.request('/v1/profiles', { ...business(name), headers: { 'content-type': 'application/json', ...who.auth, ...idem() } })).status).toBe(201);
    expect((await read(await h.app.request('/v1/me', { headers: who.auth }))).limits.maxOwnedProfiles).toBe(6);
  });
});

describe('partners: none on Starter (Basel Q3)', () => {
  it('the operator’s grant-owner on a Starter creator’s business is CONFLICT, reason PLAN_LIMIT, limit partners', async () => {
    const h = starterHarness();
    const owner = await person(h);
    const profileId = await businessOf(h, owner);
    const partner = await person(h);
    const res = await h.app.request(`/admin/v1/users/${partner.userId}/memberships`, json({ organizationId: profileId, role: 'OWNER' }, ADMIN));
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toMatchObject({ reason: 'PLAN_LIMIT', limit: 'partners', plan: 'starter' });
  });
});

describe('Issue all stops at the first PLAN_LIMIT (eng review #15)', () => {
  it('at 1/3, three due payments: two are issued, the third is refused with the limit; nothing issued is undone', async () => {
    const h = starterHarness();
    const w = await issuing(h);
    await seed(h, w.owner.userId, 'DOCUMENTS', 1);
    const received = async (amount: string) => (await read(await h.app.request('/v1/income', json({ kind: 'received', amount, currency: 'ILS', occurredOn: '2026-11-04', customerId: w.customerId }, { ...w.on, ...idem() })))) as { id: string };
    const payments = [await received('100.00'), await received('200.00'), await received('300.00')];
    const res = await h.app.request('/v1/documents-due/issue', json({ customerId: w.customerId, items: payments.map((p) => ({ kind: 'received', id: p.id })) }, { ...w.on, ...idem() }));
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await read(res);
    expect(body.results.map((r: { status: string; reason: string | null }) => [r.status, r.reason])).toEqual([
      ['issued', null],
      ['issued', null],
      ['refused', 'PLAN_LIMIT'],
    ]);
    expect(body).toMatchObject({ issued: 2, limit: { limit: 'documents', used: 3, cap: 3 } });
  });
});
