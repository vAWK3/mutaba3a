import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp, API_VERSION } from '../app.js';
import { MemoryAttachmentStorage } from '../attachments/storage.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;
const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };

interface Harness {
  app: ReturnType<typeof createApp>;
  store: MemoryLedgerStore;
  storage: MemoryAttachmentStorage;
  clock: { now: Date };
}

function harness(opts: { attachments?: boolean } = {}): Harness {
  const store = new MemoryLedgerStore();
  const storage = new MemoryAttachmentStorage();
  const clock = { now: new Date('2026-10-20T10:00:00Z') };
  const app = createApp({ store, logger: pino({ level: 'silent' }), rateLimiter: new SlidingWindowRateLimiter(100_000), adminToken: ADMIN_TOKEN, keyEnvironment: 'test', version: '0.6.0-test', now: () => clock.now, attachments: opts.attachments === false ? null : storage, attachmentUrlTtlSeconds: 600 });
  return { app, store, storage, clock };
}

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({ method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
let ik = 0;
const idem = () => ({ 'idempotency-key': `key-${++ik}-${Math.random().toString(36).slice(2, 8)}` });

interface Firm {
  org: { id: string };
  auth: Record<string, string>;
  customer: Loose;
  project: Loose;
}

async function firm(h: Harness, opts: { scopes?: readonly string[] } = {}): Promise<Firm> {
  const org = (await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))) as { id: string };
  const key = (await read(await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: opts.scopes ?? SCOPES }, admin)))) as { secret: string };
  const auth = { authorization: `Bearer ${key.secret}` };
  await h.app.request('/v1/settings/vat', json({ rateBasisPoints: 1800, effectiveFrom: '2025-01-01' }, auth, 'PUT'));
  const customer = await read(await h.app.request('/v1/customers', json({ name: 'Haddad' }, { ...auth, ...idem() })));
  const project = await read(await h.app.request('/v1/projects', json({ customerId: customer.id, name: 'Property sale', currency: 'ILS' }, { ...auth, ...idem() })));
  return { org, auth, customer, project };
}

/** A fixed agreement, exempt, with IMMEDIATE installments due on the given dates. */
async function fixedAgreement(h: Harness, f: Firm, projectId: string, items: Array<{ amount: string; dueDate?: string; manual?: boolean }>) {
  const body = {
    projectId,
    amount: items.reduce((s, i) => s + Number(i.amount), 0).toFixed(2),
    pricingBasis: 'VAT_EXCLUSIVE',
    vatTreatment: 'EXEMPT',
    agreementDate: '2026-10-01',
    paymentTerms: 'EOM',
    installments: items.map((i, n) => ({ label: `I${n + 1}`, amount: i.amount, trigger: { type: i.manual ? 'MANUAL' : 'IMMEDIATE' }, ...(i.dueDate ? { dueDate: i.dueDate } : {}) })),
  };
  const preview = await read(await h.app.request('/v1/agreements/preview', json(body, f.auth)));
  return read(await h.app.request('/v1/agreements', json({ ...body, previewToken: preview.previewToken }, { ...f.auth, ...idem() })));
}

async function pay(h: Harness, f: Firm, customerId: string, amount: string, allocations: Array<{ receivableId: string; amount: string }>, currency = 'ILS') {
  const p = await read(await h.app.request('/v1/allocations/preview', json({ customerId, currency, amount, allocations }, f.auth)));
  return read(await h.app.request('/v1/payments', json({ customerId, currency, amount, receivedOn: '2026-10-15', method: 'BANK', allocations, previewToken: p.previewToken }, { ...f.auth, ...idem() })));
}

describe('summaries', () => {
  it('organization summary: buckets per currency, per-customer rows with status, unallocated and last payment; scope required', async () => {
    const h = harness();
    const f = await firm(h);
    // customer 1 / project 1: 1000 overdue (due 10-19), 500 due today (10-20), 2000 not yet due (10-31); one pending manual installment of 300
    const a1 = await fixedAgreement(h, f, f.project.id, [{ amount: '1000.00', dueDate: '2026-10-19' }, { amount: '500.00', dueDate: '2026-10-20' }, { amount: '2000.00', dueDate: '2026-10-31' }, { amount: '300.00', manual: true }]);
    const recs = (await read(await h.app.request(`/v1/receivables?projectId=${f.project.id}`, { headers: f.auth }))).items as Loose[];
    const overdueRec = recs.find((r) => r.dueDate === '2026-10-19');
    // pay 400 of the overdue one, with 100 unallocated on the payment
    await pay(h, f, f.customer.id, '500.00', [{ receivableId: overdueRec.id, amount: '400.00' }]);
    // customer 2 in USD, fully paid
    const c2 = await read(await h.app.request('/v1/customers', json({ name: 'Mansour' }, { ...f.auth, ...idem() })));
    const p2 = await read(await h.app.request('/v1/projects', json({ customerId: c2.id, name: 'Trademark', currency: 'USD' }, { ...f.auth, ...idem() })));
    await fixedAgreement(h, f, p2.id, [{ amount: '700.00', dueDate: '2026-10-25' }]);
    const usd = (await read(await h.app.request(`/v1/receivables?projectId=${p2.id}`, { headers: f.auth }))).items[0];
    await pay(h, f, c2.id, '700.00', [{ receivableId: usd.id, amount: '700.00' }], 'USD');

    const res = await h.app.request('/v1/summaries/organization', { headers: f.auth });
    expect(res.status).toBe(200);
    const summary = await read(res);
    expect(summary.asOf).toBe('2026-10-20');
    expect(summary.currencies.map((c: Loose) => c.currency)).toEqual(['ILS', 'USD']);
    const ils = summary.currencies[0];
    expect(ils).toMatchObject({ outstanding: '3100.00', overdue: '600.00', dueToday: '500.00', notYetDue: '2000.00', unallocated: '100.00', counts: { customers: 1, overdueCustomers: 1, unallocatedPayments: 1 } });
    expect(ils.customers[0]).toMatchObject({ customerId: f.customer.id, outstanding: '3100.00', overdue: '600.00', unallocated: '100.00', lastPaymentOn: '2026-10-15', status: 'OVERDUE' });
    const usdBlock = summary.currencies[1];
    expect(usdBlock).toMatchObject({ outstanding: '0.00', unallocated: '0.00', counts: { customers: 1, overdueCustomers: 0, unallocatedPayments: 0 } });
    expect(usdBlock.customers[0]).toMatchObject({ customerId: c2.id, status: 'SETTLED', lastPaymentOn: '2026-10-15' });
    const only = await read(await h.app.request('/v1/summaries/organization?currency=USD', { headers: f.auth }));
    expect(only.currencies).toHaveLength(1);

    const customer = await read(await h.app.request(`/v1/summaries/customers/${f.customer.id}`, { headers: f.auth }));
    expect(customer).toMatchObject({ customerId: f.customer.id, lastPaymentOn: '2026-10-15' });
    expect(customer.currencies[0]).toMatchObject({ currency: 'ILS', outstanding: '3100.00', unallocated: '100.00', status: 'OVERDUE' });
    expect(customer.currencies[0].projects[0]).toMatchObject({ projectId: f.project.id, kind: 'FIXED', agreed: a1.agreement.gross, posted: '3500.00', paid: '400.00', credited: '0.00', outstanding: '3100.00', pending: { count: 1, amount: '300.00' }, status: 'OVERDUE' });

    const project = await read(await h.app.request(`/v1/summaries/projects/${p2.id}`, { headers: f.auth }));
    expect(project).toMatchObject({ projectId: p2.id, currency: 'USD', kind: 'FIXED', agreed: '700.00', paid: '700.00', outstanding: '0.00', pending: { count: 0, amount: '0.00' }, status: 'PAID_IN_FULL', asOf: '2026-10-20' });
    expect((await h.app.request('/v1/summaries/projects/00000000-0000-4000-8000-000000000000', { headers: f.auth })).status).toBe(404);

    const noScope = await firm(h, { scopes: ['payments:read', 'customers:write', 'projects:write', 'agreements:read', 'agreements:write'] });
    expect((await h.app.request('/v1/summaries/organization', { headers: noScope.auth })).status).toBe(403);
    // another organization sees nothing of this one
    const other = await firm(h);
    expect((await read(await h.app.request('/v1/summaries/organization', { headers: other.auth }))).currencies).toEqual([]);
  });

  it('retainer project: monthly from the terms in force, UP_TO_DATE / CANCELLED / SETTLED; a project without agreements is NONE', async () => {
    const h = harness();
    const f = await firm(h);
    const body = { projectId: f.project.id, monthlyAmount: '2000.00', pricingBasis: 'VAT_EXCLUSIVE', startMonth: '2026-10', billingDay: 1, paymentTerms: 'EOM_30' };
    const preview = await read(await h.app.request('/v1/retainers/preview', json(body, f.auth)));
    const created = await read(await h.app.request('/v1/retainers', json({ ...body, previewToken: preview.previewToken }, { ...f.auth, ...idem() })));
    let s = await read(await h.app.request(`/v1/summaries/projects/${f.project.id}`, { headers: f.auth }));
    expect(s).toMatchObject({ kind: 'RETAINER', agreed: null, monthly: '2360.00', posted: '2360.00', outstanding: '2360.00', notYetDue: '2360.00', status: 'UP_TO_DATE' });
    const cp = await read(await h.app.request(`/v1/retainers/${created.agreement.id}/cancel/preview`, json({ effectiveDate: '2026-10-20', finalMonth: 'FULL' }, f.auth)));
    await h.app.request(`/v1/retainers/${created.agreement.id}/cancel`, json({ effectiveDate: '2026-10-20', finalMonth: 'FULL', previewToken: cp.previewToken }, { ...f.auth, ...idem() }));
    s = await read(await h.app.request(`/v1/summaries/projects/${f.project.id}`, { headers: f.auth }));
    expect(s.status).toBe('CANCELLED');
    const rec = (await read(await h.app.request(`/v1/receivables?projectId=${f.project.id}`, { headers: f.auth }))).items[0];
    await pay(h, f, f.customer.id, '2360.00', [{ receivableId: rec.id, amount: '2360.00' }]);
    s = await read(await h.app.request(`/v1/summaries/projects/${f.project.id}`, { headers: f.auth }));
    expect(s).toMatchObject({ status: 'SETTLED', paid: '2360.00', outstanding: '0.00' });
    const empty = await read(await h.app.request('/v1/projects', json({ customerId: f.customer.id, name: 'Empty', currency: 'ILS' }, { ...f.auth, ...idem() })));
    expect((await read(await h.app.request(`/v1/summaries/projects/${empty.id}`, { headers: f.auth }))).status).toBe('NONE');
  });
});

describe('audit listing', () => {
  it('lists the organization’s events by entity with pagination; needs audit:read; other organizations see nothing', async () => {
    const h = harness();
    const f = await firm(h);
    await fixedAgreement(h, f, f.project.id, [{ amount: '100.00' }]);
    const rec = (await read(await h.app.request(`/v1/receivables?projectId=${f.project.id}`, { headers: f.auth }))).items[0];
    const payment = await pay(h, f, f.customer.id, '100.00', [{ receivableId: rec.id, amount: '100.00' }]);
    await h.app.request(`/v1/payments/${payment.id}/reverse`, json({ reason: 'wrong client' }, { ...f.auth, ...idem() }));
    const page = await read(await h.app.request(`/v1/audit?entityType=payment&entityId=${payment.id}&limit=1`, { headers: f.auth }));
    expect(page.items).toHaveLength(1);
    expect(page.items[0].action).toBe('payment.recorded');
    expect(page.nextCursor).toBeTruthy();
    const next = await read(await h.app.request(`/v1/audit?entityType=payment&entityId=${payment.id}&limit=5&cursor=${encodeURIComponent(page.nextCursor)}`, { headers: f.auth }));
    expect(next.items.map((e: Loose) => e.action)).toEqual(['payment.reversed']);
    expect(next.nextCursor).toBeNull();
    const byAction = await read(await h.app.request('/v1/audit?action=receivable.settled', { headers: f.auth }));
    expect(byAction.items.length).toBeGreaterThanOrEqual(1);
    const noScope = await firm(h, { scopes: ['payments:read'] });
    expect((await h.app.request('/v1/audit', { headers: noScope.auth })).status).toBe(403);
    const other = await firm(h);
    expect((await read(await h.app.request(`/v1/audit?entityType=payment&entityId=${payment.id}`, { headers: other.auth }))).items).toEqual([]);
  });
});

describe('attachments', () => {
  const upload = (over: Record<string, unknown> = {}) => ({ kind: 'RECEIPT', filename: 'receipt-oct.pdf', mimeType: 'application/pdf', sizeBytes: 2048, ...over });

  it('start → PUT (storage) → complete → list → download → delete, with every refusal named', async () => {
    const h = harness();
    const f = await firm(h);
    await fixedAgreement(h, f, f.project.id, [{ amount: '100.00' }]);
    const rec = (await read(await h.app.request(`/v1/receivables?projectId=${f.project.id}`, { headers: f.auth }))).items[0];
    const payment = await pay(h, f, f.customer.id, '100.00', [{ receivableId: rec.id, amount: '100.00' }]);

    const started = await h.app.request('/v1/attachments/uploads', json(upload({ paymentId: payment.id }), f.auth));
    expect(started.status).toBe(201);
    const { attachment, upload: signed } = await read(started);
    expect(attachment).toMatchObject({ kind: 'RECEIPT', filename: 'receipt-oct.pdf', status: 'PENDING_UPLOAD', paymentId: payment.id, customerId: null, projectId: null });
    expect(signed.method).toBe('PUT');
    expect(signed.url).toContain(`org/${f.org.id}/${attachment.id}`);
    expect(signed.url).not.toContain('receipt-oct');
    expect(signed.headers['Content-Type']).toBe('application/pdf');
    expect(new Date(signed.expiresAt).getTime() - h.clock.now.getTime()).toBe(600_000);

    // not uploaded yet
    const incomplete = await h.app.request(`/v1/attachments/${attachment.id}/complete`, json({}, f.auth));
    expect((await read(incomplete)).error.details.reason).toBe('UPLOAD_INCOMPLETE');
    expect((await read(await h.app.request(`/v1/attachments/${attachment.id}/download`, { headers: f.auth }))).error.details.reason).toBe('ATTACHMENT_NOT_READY');
    // wrong size
    h.storage.put(`org/${f.org.id}/${attachment.id}`, { sizeBytes: 999, contentType: 'application/pdf' });
    expect((await read(await h.app.request(`/v1/attachments/${attachment.id}/complete`, json({}, f.auth)))).error.details.reason).toBe('UPLOAD_MISMATCH');
    h.storage.put(`org/${f.org.id}/${attachment.id}`, { sizeBytes: 2048, contentType: 'application/pdf' });
    const completed = await h.app.request(`/v1/attachments/${attachment.id}/complete`, json({}, f.auth));
    expect(completed.status).toBe(200);
    expect((await read(completed)).status).toBe('READY');
    expect((await read(await h.app.request(`/v1/attachments/${attachment.id}/complete`, json({}, f.auth)))).status).toBe('READY');

    const list = await read(await h.app.request(`/v1/attachments?paymentId=${payment.id}`, { headers: f.auth }));
    expect(list.items.map((x: Loose) => x.id)).toEqual([attachment.id]);
    expect((await read(await h.app.request(`/v1/attachments?customerId=${f.customer.id}`, { headers: f.auth }))).items).toEqual([]);
    const download = await read(await h.app.request(`/v1/attachments/${attachment.id}/download`, { headers: f.auth }));
    expect(download).toMatchObject({ filename: 'receipt-oct.pdf', mimeType: 'application/pdf' });
    expect(download.url).toContain('memory://download/');

    // refusals
    const reason = async (body: Record<string, unknown>) => (await read(await h.app.request('/v1/attachments/uploads', json(body, f.auth)))).error;
    expect((await reason(upload({ paymentId: payment.id, customerId: f.customer.id }))).details.reason).toBe('ATTACHMENT_TARGET_AMBIGUOUS');
    expect((await reason(upload())).details.reason).toBe('ATTACHMENT_TARGET_REQUIRED');
    expect((await h.app.request('/v1/attachments/uploads', json(upload({ paymentId: payment.id, mimeType: 'application/zip' }), f.auth))).status).toBe(422);
    expect((await h.app.request('/v1/attachments/uploads', json(upload({ paymentId: payment.id, sizeBytes: 11 * 1024 * 1024 }), f.auth))).status).toBe(422);
    expect((await h.app.request('/v1/attachments/uploads', json(upload({ paymentId: '00000000-0000-4000-8000-000000000000' }), f.auth))).status).toBe(404);
    const other = await firm(h);
    expect((await h.app.request(`/v1/attachments/${attachment.id}/download`, { headers: other.auth })).status).toBe(404);
    const readOnly = await firm(h, { scopes: ['attachments:read'] });
    expect((await h.app.request('/v1/attachments/uploads', json(upload({ paymentId: payment.id }), readOnly.auth))).status).toBe(403);

    // customer- and project-level attachments
    const inv = await read(await h.app.request('/v1/attachments/uploads', json(upload({ kind: 'INVOICE', filename: 'INV-117.pdf', projectId: f.project.id, invoiceNumber: 'INV-117', invoiceDate: '2026-10-02' }), f.auth)));
    h.storage.put(inv.attachment.storageKey ?? `org/${f.org.id}/${inv.attachment.id}`, { sizeBytes: 2048, contentType: 'application/pdf' });
    await h.app.request(`/v1/attachments/${inv.attachment.id}/complete`, json({}, f.auth));
    expect((await read(await h.app.request(`/v1/attachments?projectId=${f.project.id}&kind=INVOICE`, { headers: f.auth }))).items[0]).toMatchObject({ invoiceNumber: 'INV-117', invoiceDate: '2026-10-02' });

    // delete
    const del = await h.app.request(`/v1/attachments/${attachment.id}`, { method: 'DELETE', headers: f.auth });
    expect(del.status).toBe(204);
    expect(h.storage.removed).toContain(`org/${f.org.id}/${attachment.id}`);
    expect((await read(await h.app.request(`/v1/attachments?paymentId=${payment.id}`, { headers: f.auth }))).items).toEqual([]);
    expect((await h.app.request(`/v1/attachments/${attachment.id}`, { method: 'DELETE', headers: f.auth })).status).toBe(204);
    expect((await h.app.request('/v1/attachments/00000000-0000-4000-8000-000000000000', { method: 'DELETE', headers: f.auth })).status).toBe(404);
    const actions = ((await read(await h.app.request(`/admin/v1/organizations/${f.org.id}/audit`, { headers: admin }))).events as Loose[]).map((e) => e.action);
    expect(actions).toContain('attachment.uploaded');
    expect(actions).toContain('attachment.deleted');
  });

  it('answers 503 ATTACHMENTS_NOT_CONFIGURED when no bucket is configured', async () => {
    const h = harness({ attachments: false });
    const f = await firm(h);
    const res = await h.app.request('/v1/attachments/uploads', json({ kind: 'OTHER', filename: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 10, customerId: f.customer.id }, f.auth));
    expect(res.status).toBe(503);
    expect((await read(res)).error.code).toBe('ATTACHMENTS_NOT_CONFIGURED');
    expect((await h.app.request(`/v1/attachments?customerId=${f.customer.id}`, { headers: f.auth })).status).toBe(503);
  });
});

describe('contract', () => {
  it('publishes the M6 paths, components and version', async () => {
    const h = harness();
    const doc = await read(await h.app.request('/openapi.json'));
    expect(doc.info.version).toBe('1.6.0-m7');
    expect(API_VERSION).toBe('1.6.0-m7');
    for (const path of ['/v1/summaries/organization', '/v1/summaries/customers/{customerId}', '/v1/summaries/projects/{projectId}', '/v1/audit', '/v1/attachments/uploads', '/v1/attachments/{attachmentId}/complete', '/v1/attachments', '/v1/attachments/{attachmentId}/download', '/v1/attachments/{attachmentId}']) {
      expect(doc.paths[path], path).toBeDefined();
    }
    for (const name of ['OrganizationSummary', 'CustomerSummary', 'ProjectSummaryResponse', 'AuditPage', 'Attachment', 'CreateUploadResponse', 'AttachmentDownload']) expect(doc.components.schemas[name], name).toBeDefined();
    expect(doc.info.description).toContain('ATTACHMENTS_NOT_CONFIGURED');
    for (const reason of ['UPLOAD_INCOMPLETE', 'UPLOAD_MISMATCH', 'FILE_TOO_LARGE']) expect(doc.info.description).toContain(reason);
  });
});
