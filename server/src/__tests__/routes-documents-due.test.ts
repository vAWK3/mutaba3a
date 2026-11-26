import { describe, expect, it } from 'vitest';
import { ADMIN, accountantHarness, businessOf, idem, json, person, read, shared, type AccountantHarness, type Person } from './helpers/accountants.js';

/**
 * MUT-660 (ADR-270): /v1/documents-due*, the not-for-invoice marks and a client's documents preference. Today is
 * 2026-11-06 in this harness. Same gate as every issuing route: the owner's `invoicing` feature on a business profile.
 */
const grantInvoicing = (h: AccountantHarness, p: Person) => h.app.request(`/admin/v1/users/${p.userId}/features/invoicing`, { method: 'PUT', headers: ADMIN });

async function invoicing(h: AccountantHarness) {
  const owner = await person(h);
  expect((await grantInvoicing(h, owner)).status).toBe(200);
  const profileId = await businessOf(h, owner, 'Barmajiyat');
  const on = owner.on(profileId);
  expect((await h.app.request('/v1/issuer', json({ legalName: 'Barmajiyat Ltd.', vatId: '123456782', dealerType: 'COMPANY' }, on, 'PUT'))).status).toBe(200);
  expect((await h.app.request('/v1/issuing/numbering', json({ alreadyIssuing: false }, on, 'PUT'))).status).toBe(200);
  const client = async (name: string) => (await read(await h.app.request('/v1/customers', json({ name }, { ...on, ...idem() })))) as { id: string; version: number };
  const rami = await client('Rami Haddad');
  const nour = await client('Nour Design');
  return { owner, profileId, on, rami, nour };
}

type World = Awaited<ReturnType<typeof invoicing>>;

const income = async (h: AccountantHarness, w: World, kind: 'owed' | 'received', amount: string, customerId: string | null, occurredOn = '2026-11-04') =>
  (await read(await h.app.request('/v1/income', json({ kind, amount, currency: 'ILS', occurredOn, ...(customerId ? { customerId } : {}) }, { ...w.on, ...idem() })))) as { id: string; version: number };
const prefer = async (h: AccountantHarness, w: World, customer: { id: string; version: number }, documentsPreference: string | null) => {
  const res = await h.app.request(`/v1/customers/${customer.id}`, json({ documentsPreference }, { ...w.on, 'if-match': String(customer.version) }, 'PATCH'));
  expect(res.status, await res.clone().text()).toBe(200);
  return read(res);
};
const due = async (h: AccountantHarness, w: World, query = '') => read(await h.app.request(`/v1/documents-due${query}`, { headers: w.on }));
const count = async (h: AccountantHarness, w: World) => (await read(await h.app.request('/v1/documents-due/count', { headers: w.on }))).total as number;
const issueAll = (h: AccountantHarness, w: World, customerId: string | null, items: Array<{ kind: string; id: string }>, key = idem()) =>
  h.app.request('/v1/documents-due/issue', json({ customerId, items }, { ...w.on, ...key }));
const items = (body: { groups: Array<{ items: Array<{ kind: string | null; entry: { kind: string; id: string }; amount: string; issuable: boolean; reason: string | null }> }> }) => body.groups.flatMap((g) => g.items);

describe('documents due routes (MUT-660)', () => {
  it('is switched off (404) without the owner’s invoicing feature and on personal profiles', async () => {
    const h = accountantHarness();
    const owner = await person(h);
    const profileId = await businessOf(h, owner);
    expect((await h.app.request('/v1/documents-due', { headers: owner.on(profileId) })).status).toBe(404);
    expect((await h.app.request('/v1/documents-due/count', { headers: owner.on(profileId) })).status).toBe(404);
    expect((await grantInvoicing(h, owner)).status).toBe(200);
    expect(await read(await h.app.request('/v1/documents-due', { headers: owner.on(profileId) }))).toEqual({ view: 'to-issue', groups: [], counts: { total: 0, byKind: {} } });
    expect((await h.app.request('/v1/documents-due', { headers: owner.on(owner.personalId) })).status).toBe(404);
  });

  it('AC1: a client’s preference is set on an invoicing profile only; with none it follows the profile default', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    expect(await prefer(h, w, w.rami, 'TAX_INVOICE_FIRST')).toMatchObject({ documentsPreference: 'TAX_INVOICE_FIRST' });
    expect((await read(await h.app.request(`/v1/customers/${w.nour.id}`, { headers: w.on }))).documentsPreference).toBeNull();
    const other = await person(h);
    const plain = await businessOf(h, other);
    const c = await read(await h.app.request('/v1/customers', json({ name: 'X' }, { ...other.on(plain), ...idem() })));
    expect((await h.app.request(`/v1/customers/${c.id}`, json({ documentsPreference: 'NO_DOCUMENT' }, { ...other.on(plain), 'if-match': String(c.version) }, 'PATCH'))).status).toBe(404);
    // The profile default is the issuer's defaults step.
    const issuer = await read(await h.app.request('/v1/issuer', { headers: w.on }));
    expect(issuer.defaultDocumentsPreference).toBe('ON_PAYMENT');
  });

  it('AC2: tax invoice first: 3,400 owed is due a tax invoice; after Issue all, each payment is due its own receipt', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    await prefer(h, w, w.rami, 'TAX_INVOICE_FIRST');
    const owed = await income(h, w, 'owed', '3400.00', w.rami.id);
    expect(items(await due(h, w))).toMatchObject([{ kind: 'TAX_INVOICE', entry: { kind: 'owed', id: owed.id }, amount: '3400.00', issuable: true }]);
    expect(await count(h, w)).toBe(1);
    const issued = await read(await issueAll(h, w, w.rami.id, [{ kind: 'owed', id: owed.id }]));
    expect(issued).toMatchObject({ issued: 1, results: [{ status: 'issued', document: { docType: 'TAX_INVOICE', gross: '3400.00', receivableId: owed.id } }] });
    expect(await count(h, w)).toBe(0);
    const first = await income(h, w, 'received', '1000.00', w.rami.id, '2026-11-05');
    const second = await income(h, w, 'received', '500.00', w.rami.id, '2026-11-06');
    const list = items(await due(h, w));
    expect(list.map((i) => [i.entry.id, i.kind, i.amount])).toEqual([[first.id, 'RECEIPT', '1000.00'], [second.id, 'RECEIPT', '500.00']]);
    const receipts = await read(await issueAll(h, w, w.rami.id, list.map((i) => i.entry)));
    expect(receipts.results.map((r: { status: string; document: { docType: string; gross: string; originalId: string } }) => [r.status, r.document.docType, r.document.gross, r.document.originalId])).toEqual([
      ['issued', 'RECEIPT', '1000.00', issued.results[0].document.id],
      ['issued', 'RECEIPT', '500.00', issued.results[0].document.id],
    ]);
    expect(await count(h, w)).toBe(0);
  });

  it('AC3: on payment (the default), each payment, partial ones included, is due and issued its own invoice-receipt', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    const owed = await income(h, w, 'owed', '3400.00', w.nour.id);
    expect(await count(h, w)).toBe(0);
    const partial = await income(h, w, 'received', '700.00', w.nour.id);
    await h.store.payments.allocate(w.profileId, partial.id, [{ receivableId: owed.id, amountMinor: 70_000n }], new Date('2026-11-06T10:00:00Z'));
    const loose = await income(h, w, 'received', '250.00', w.nour.id);
    const result = await read(await issueAll(h, w, w.nour.id, [{ kind: 'received', id: partial.id }, { kind: 'received', id: loose.id }]));
    expect(result.results.map((r: { document: { docType: string; gross: string; paymentId: string } }) => [r.document.docType, r.document.gross, r.document.paymentId])).toEqual([
      ['TAX_INVOICE_RECEIPT', '700.00', partial.id],
      ['TAX_INVOICE_RECEIPT', '250.00', loose.id],
    ]);
    // Linked only: the partial payment's Owed keeps its 3,400.
    expect(await h.store.receivables.getById(w.profileId, owed.id)).toMatchObject({ grossMinor: 340_000n, paidMinor: 70_000n, origin: 'ADJUSTMENT' });
    expect(await count(h, w)).toBe(0);
  });

  it('N1: money received with no client is due an invoice-receipt, issued linked to it', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    const cash = await income(h, w, 'received', '450.00', null);
    expect(items(await due(h, w))).toMatchObject([{ kind: 'TAX_INVOICE_RECEIPT', entry: { id: cash.id } }]);
    const result = await read(await issueAll(h, w, null, [{ kind: 'received', id: cash.id }]));
    expect(result.results[0]).toMatchObject({ status: 'issued', document: { docType: 'TAX_INVOICE_RECEIPT', customerId: null, paymentId: cash.id } });
  });

  it('Issue all refuses what isn’t due, another client’s item and what can’t be issued here, and a replay issues nothing new', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    const quds = await read(await h.app.request('/v1/customers', json({ name: 'Al-Quds Legal' }, { ...w.on, ...idem() })));
    await prefer(h, w, quds, 'PAYMENT_REQUEST_FIRST');
    const request = await income(h, w, 'owed', '5000.00', quds.id);
    const paid = await income(h, w, 'received', '300.00', w.nour.id);
    const key = idem();
    const result = await read(await issueAll(h, w, quds.id, [{ kind: 'owed', id: request.id }, { kind: 'received', id: paid.id }, { kind: 'owed', id: '00000000-0000-4000-8000-000000000000' }], key));
    // MUT-662: a payment request is issued now (linked to its Owed), no longer PAYMENT_REQUEST_PENDING.
    expect(result.results.map((r: { status: string; reason: string }) => [r.status, r.reason])).toEqual([['issued', null], ['refused', 'OTHER_CLIENT'], ['refused', 'NOT_DUE']]);
    expect(result.results[0].document).toMatchObject({ docType: 'PAYMENT_REQUEST', displayNumber: 'PR-0001', receivableId: request.id });
    const ok = idem();
    const first = await read(await issueAll(h, w, w.nour.id, [{ kind: 'received', id: paid.id }], ok));
    const replay = await read(await issueAll(h, w, w.nour.id, [{ kind: 'received', id: paid.id }], ok));
    expect(replay.results[0].document.id).toBe(first.results[0].document.id);
    expect((await read(await h.app.request('/v1/issued-documents', { headers: w.on }))).items).toHaveLength(2);
  });

  it('AC6/AC8: bulk not for invoice and back, in one action, idempotent; the count follows', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    const a = await income(h, w, 'received', '100.00', w.nour.id);
    const b = await income(h, w, 'received', '200.00', null);
    expect(await count(h, w)).toBe(2);
    const body = { items: [{ kind: 'received', id: a.id }, { kind: 'received', id: b.id }], value: true };
    const key = idem();
    const mark = await h.app.request('/v1/documents-due/not-for-invoice', json(body, { ...w.on, ...key }));
    expect(await read(mark)).toEqual({ changed: 2 });
    expect(await read(await h.app.request('/v1/documents-due/not-for-invoice', json(body, { ...w.on, ...key })))).toEqual({ changed: 2 });
    expect(await read(await h.app.request('/v1/documents-due/not-for-invoice', json(body, { ...w.on, ...idem() })))).toEqual({ changed: 0 });
    expect(await count(h, w)).toBe(0);
    expect(items(await due(h, w, '?view=not-for-invoice')).map((i) => [i.kind, i.entry.id])).toEqual([[null, a.id], [null, b.id]]);
    expect(await read(await h.app.request('/v1/documents-due/not-for-invoice', json({ ...body, value: false }, { ...w.on, ...idem() })))).toEqual({ changed: 2 });
    expect(await count(h, w)).toBe(2);
  });

  it('AC5: an entry with a tax document can’t be marked; the single mark checks If-Match and is idempotent', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    await prefer(h, w, w.rami, 'TAX_INVOICE_FIRST');
    const owed = await income(h, w, 'owed', '1180.00', w.rami.id);
    await issueAll(h, w, w.rami.id, [{ kind: 'owed', id: owed.id }]);
    const current = await h.store.receivables.getById(w.profileId, owed.id);
    const refused = await h.app.request(`/v1/receivables/${owed.id}/not-for-invoice`, json({ value: true }, { ...w.on, 'if-match': String(current!.version) }, 'PUT'));
    expect(refused.status).toBe(409);
    expect((await read(refused)).error.details.reason).toBe('HAS_TAX_DOCUMENT');
    const paid = await income(h, w, 'received', '90.00', w.nour.id);
    const stale = await h.app.request(`/v1/payments/${paid.id}/not-for-invoice`, json({ value: true }, { ...w.on, 'if-match': String(paid.version + 5) }, 'PUT'));
    expect((await read(stale)).error.details.reason).toBe('VERSION_MISMATCH');
    const set = await read(await h.app.request(`/v1/payments/${paid.id}/not-for-invoice`, json({ value: true }, { ...w.on, 'if-match': String(paid.version) }, 'PUT')));
    expect(set).toEqual({ kind: 'received', id: paid.id, notForInvoice: true, version: paid.version + 1 });
    // A retry with the version it first read: already set, so 200 unchanged.
    expect(await read(await h.app.request(`/v1/payments/${paid.id}/not-for-invoice`, json({ value: true }, { ...w.on, 'if-match': String(paid.version) }, 'PUT')))).toEqual(set);
  });

  it('AC8: older than N months keeps only items dated before today minus N months', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    const old = await income(h, w, 'received', '10.00', w.nour.id, '2026-04-30');
    await income(h, w, 'received', '20.00', w.nour.id, '2026-05-06');
    await income(h, w, 'received', '30.00', w.nour.id, '2026-10-01');
    expect(items(await due(h, w, '?olderThanMonths=6')).map((i) => i.entry.id)).toEqual([old.id]);
    expect((await due(h, w, '?olderThanMonths=0')).counts.total).toBe(3);
  });

  it('an accountant reads the list but marks and issues nothing', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    const paid = await income(h, w, 'received', '100.00', w.nour.id);
    const acc = await shared(h, w.owner, w.profileId);
    expect((await h.app.request('/v1/documents-due', { headers: acc.on(w.profileId) })).status).toBe(200);
    expect((await h.app.request('/v1/documents-due/not-for-invoice', json({ items: [{ kind: 'received', id: paid.id }], value: true }, { ...acc.on(w.profileId), ...idem() }))).status).toBe(403);
    expect((await issueAll(h, { ...w, on: acc.on(w.profileId) }, w.nour.id, [{ kind: 'received', id: paid.id }])).status).toBe(403);
  });
});

describe('the books split (MUT-660, AC4/AC9/AC10)', () => {
  it('Reports: invoice income + not for invoice = all income, per currency; a profile without invoicing gets no split', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    const zaid = await read(await h.app.request('/v1/customers', json({ name: 'Zaid' }, { ...w.on, ...idem() })));
    await prefer(h, w, zaid, 'NO_DOCUMENT');
    await income(h, w, 'received', '300.00', w.nour.id);
    const marked = await income(h, w, 'received', '200.00', w.nour.id);
    await income(h, w, 'received', '50.00', zaid.id);
    await h.app.request('/v1/documents-due/not-for-invoice', json({ items: [{ kind: 'received', id: marked.id }], value: true }, { ...w.on, ...idem() }));
    const activity = await read(await h.app.request('/v1/summaries/activity?from=2026-11-01&to=2026-11-30', { headers: w.on }));
    expect(activity.invoiceSplit).toEqual([{ currency: 'ILS', invoiceIncome: '300.00', notForInvoice: '250.00', all: '550.00' }]);
    expect(activity.currencies[0].received).toBe('550.00');
    const other = await person(h);
    const plain = await businessOf(h, other);
    const plainActivity = await read(await h.app.request('/v1/summaries/activity?from=2026-11-01&to=2026-11-30', { headers: other.on(plain) }));
    expect(plainActivity).not.toHaveProperty('invoiceSplit');
  });

  it('exports: the Income sheet carries an invoice_status code on invoicing profiles only', async () => {
    const { collectRows } = await import('../period-pack/rows.js');
    const h = accountantHarness();
    const w = await invoicing(h);
    const due = await income(h, w, 'received', '300.00', w.nour.id);
    const marked = await income(h, w, 'received', '200.00', w.nour.id);
    await h.app.request('/v1/documents-due/not-for-invoice', json({ items: [{ kind: 'received', id: marked.id }], value: true }, { ...w.on, ...idem() }));
    const issued = await income(h, w, 'received', '100.00', w.nour.id);
    await issueAll(h, w, w.nour.id, [{ kind: 'received', id: issued.id }]);
    const org = (await h.store.organizations.getById(w.profileId))!;
    const rows = await collectRows(h.store, org, { from: '2026-11-01', to: '2026-11-30' }, new Date('2026-11-06T12:00:00Z'), 'en', { scope: 'report', forLink: false, invoicingForAll: false });
    expect(rows.invoicing).toBe(true);
    expect(Object.fromEntries(rows.income.map((l) => [l.record.id, l.invoiceStatus]))).toEqual({ [due.id]: 'due', [marked.id]: 'not_for_invoice', [issued.id]: 'issued' });
    const other = await person(h);
    const plain = await businessOf(h, other);
    await h.app.request('/v1/income', json({ kind: 'received', amount: '10.00', currency: 'ILS', occurredOn: '2026-11-04' }, { ...other.on(plain), ...idem() }));
    const plainRows = await collectRows(h.store, (await h.store.organizations.getById(plain))!, { from: '2026-11-01', to: '2026-11-30' }, new Date('2026-11-06T12:00:00Z'), 'en', { scope: 'report', forLink: false, invoicingForAll: false });
    expect(plainRows).not.toHaveProperty('invoicing');
    expect(plainRows.income[0]).not.toHaveProperty('invoiceStatus');
  });
});
