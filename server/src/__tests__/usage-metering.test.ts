import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { MemoryAttachmentStorage } from '../attachments/storage.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { usageMonthOf } from '../usage/month.js';
import { ADMIN, businessOf, idem, issuingHarness, json, person, read, type AccountantHarness, type Person } from './helpers/accountants.js';
import { provisionUser } from './helpers/provision.js';

/**
 * MUT-735 (ADR-281): issued documents and finished scans are metered, in their own transactions, once each. Nothing is
 * ever refused here (caps are MUT-731's).
 */

const ISSUER = { legalName: 'Barmajiyat Ltd.', vatId: '123456789', dealerType: 'COMPANY', city: 'Nazareth' };

async function invoicing(h: AccountantHarness, owner?: Person) {
  const who = owner ?? (await person(h));
  expect((await h.app.request(`/admin/v1/users/${who.userId}/features/invoicing`, { method: 'PUT', headers: ADMIN })).status).toBe(200);
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

const usageOf = (h: AccountantHarness) => (h.store as MemoryLedgerStore).usage;
const documentsOf = async (h: AccountantHarness, userId: string) => (await usageOf(h).countersFor(`user:${userId}`, [usageMonthOf(h.now())])).find((c) => c.meter === 'DOCUMENTS')!.count;

describe('issued documents are metered (MUT-735)', () => {
  it('a tax invoice records DOCUMENT_ISSUED and counts 1; a replay with the same key counts nothing', async () => {
    const h = issuingHarness();
    const w = await invoicing(h);
    const key = idem();
    const res = await h.app.request('/v1/issued-documents', json(invoice(w.customerId), { ...w.on, ...key }));
    expect(res.status, await res.clone().text()).toBe(201);
    const doc = await read(res);
    expect((await h.app.request('/v1/issued-documents', json(invoice(w.customerId), { ...w.on, ...key }))).status).toBe(201);
    expect(await documentsOf(h, w.owner.userId)).toBe(1);
    // The harness signs in with a device token, so the door is PHONE (a cookie session is PORTAL, below).
    const events = usageOf(h).allEvents();
    expect(events).toEqual([
      expect.objectContaining({ kind: 'DOCUMENT_ISSUED', detail: 'TAX_INVOICE', door: 'PHONE', entityKey: doc.id, organizationId: w.profileId, subjectKey: `user:${w.owner.userId}`, actorUserId: w.owner.userId, month: usageMonthOf(h.now()) }),
    ]);
  });

  it('every document type counts (Basel 2026-11-25): a credit note and a receipt move the meter too', async () => {
    const h = issuingHarness();
    const w = await invoicing(h);
    const first = await read(await h.app.request('/v1/issued-documents', json(invoice(w.customerId), { ...w.on, ...idem() })));
    const credit = { docType: 'CREDIT_NOTE', documentDate: '2026-11-05', currency: 'ILS', language: 'he', customerId: w.customerId, originalId: first.id, lines: [{ description: 'Discount', kind: 'SERVICE', quantity: '1', unitPrice: '100.00' }] };
    expect((await h.app.request('/v1/issued-documents', json(credit, { ...w.on, ...idem() }))).status).toBe(201);
    const receipt = { docType: 'RECEIPT', documentDate: '2026-11-05', currency: 'ILS', language: 'he', customerId: w.customerId, appliesToDocumentId: first.id, payment: { method: 'BANK', receivedOn: '2026-11-05' }, lines: [{ description: 'Payment', kind: 'SERVICE', quantity: '1', unitPrice: '500.00' }] };
    const paid = await h.app.request('/v1/issued-documents', json(receipt, { ...w.on, ...idem() }));
    expect(paid.status, await paid.clone().text()).toBe(201);
    expect(await documentsOf(h, w.owner.userId)).toBe(3);
    expect(usageOf(h).allEvents().map((e) => e.detail)).toEqual(['TAX_INVOICE', 'CREDIT_NOTE', 'RECEIPT']);
  });

  it('a co-owner’s document counts to the creator’s meter; the event keeps the co-owner as the actor', async () => {
    const h = issuingHarness();
    const w = await invoicing(h);
    const partner = await person(h);
    const granted = await h.store.memberships.grantOwner(partner.userId, w.profileId, h.now(), 3, { organizationId: w.profileId, actorType: 'ADMIN', actorId: null, action: 'membership.owner_granted', entityType: 'membership', entityId: partner.userId, requestId: 'test' });
    expect(granted.kind).not.toBe('not_found');
    const res = await h.app.request('/v1/issued-documents', json(invoice(w.customerId), { ...partner.on(w.profileId), ...idem() }));
    expect(res.status, await res.clone().text()).toBe(201);
    expect(await documentsOf(h, w.owner.userId)).toBe(1);
    expect(await documentsOf(h, partner.userId)).toBe(0);
    expect(usageOf(h).allEvents()[0]).toMatchObject({ subjectKey: `user:${w.owner.userId}`, actorUserId: partner.userId });
  });
});

/** The receipts harness (routes-receipts.test.ts): an operator firm, a member signed in by cookie. */
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };
const FILE = { filename: 'cafe.jpg', mimeType: 'image/jpeg', sizeBytes: 2048 };

async function receipts() {
  const store = new MemoryLedgerStore();
  const storage = new MemoryAttachmentStorage();
  const now = new Date('2026-10-22T21:30:00Z');
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN['x-admin-token'],
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => now,
    attachments: storage,
    attachmentUrlTtlSeconds: 600,
    receiptUploadLimiter: new SlidingWindowRateLimiter(1_000),
    receiptsLibrary: true,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1 },
  });
  const org = await read(await app.request('/admin/v1/organizations', json({ name: 'Firm', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, ADMIN)));
  const email = `scan${Math.random().toString(36).slice(2, 8)}@firm.ps`;
  const created = await provisionUser(app, { email, displayName: 'Nour Haddad', organizationId: org.id, locale: 'en' });
  const res = await app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const as = { cookie: `${COOKIE}=${token}`, 'x-mutaba3a-profile': org.id as string, ...SAME_ORIGIN };
  const keyOf = (url: string) => new URL(url).pathname.replace(/^\/+/, '').replace(/^upload\//, '');
  const scans = async () => (await store.usage.countersFor(`org:${org.id}`, [usageMonthOf(now)])).find((c) => c.meter === 'SCANS')!.count;
  return { app, store, storage, as, keyOf, scans, orgId: org.id as string };
}

describe('scans are metered when the upload finishes (MUT-735, Basel 2026-11-25)', () => {
  it('starting counts nothing; completing counts one; completing again counts nothing; an abandoned upload never counts', async () => {
    const r = await receipts();
    const start = async () => read(await r.app.request('/v1/receipts/uploads', json(FILE, { ...r.as, ...idem() })));
    const started = await start();
    const abandoned = await start();
    expect(await r.scans()).toBe(0);
    r.storage.put(r.keyOf(started.upload.url), { sizeBytes: FILE.sizeBytes, contentType: FILE.mimeType });
    expect((await r.app.request(`/v1/receipts/${started.receipt.id}/complete`, { method: 'POST', headers: r.as })).status).toBe(200);
    expect((await r.app.request(`/v1/receipts/${started.receipt.id}/complete`, { method: 'POST', headers: r.as })).status).toBe(200);
    expect(await r.scans()).toBe(1);
    expect(r.store.usage.allEvents()).toEqual([expect.objectContaining({ kind: 'SCAN', detail: 'LIBRARY', entityKey: started.receipt.id, door: 'PORTAL', subjectKey: `org:${r.orgId}` })]);
    expect(abandoned.receipt.id).not.toBe(started.receipt.id);
  });

  it('a receipt finished on an expense counts as an EXPENSE scan', async () => {
    const r = await receipts();
    const expense = await read(await r.app.request('/v1/expenses', json({ amount: '12.00', currency: 'ILS', occurredOn: '2026-10-20', title: 'Coffee' }, { ...r.as, ...idem() })));
    const started = await read(await r.app.request(`/v1/expenses/${expense.id}/receipts`, json(FILE, { ...r.as, ...idem() })));
    r.storage.put(r.keyOf(started.upload.url), { sizeBytes: FILE.sizeBytes, contentType: FILE.mimeType });
    const done = await r.app.request(`/v1/expenses/${expense.id}/receipts/${started.receipt.id}/complete`, { method: 'POST', headers: r.as });
    expect(done.status, await done.clone().text()).toBe(200);
    expect(await r.scans()).toBe(1);
    expect(r.store.usage.allEvents()[0]).toMatchObject({ kind: 'SCAN', detail: 'EXPENSE', entityKey: started.receipt.id });
  });
});
