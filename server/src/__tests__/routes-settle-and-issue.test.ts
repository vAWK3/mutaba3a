import { describe, expect, it } from 'vitest';
import { ADMIN, accountantHarness, businessOf, idem, json, person, read, type AccountantHarness } from './helpers/accountants.js';

/**
 * MUT-661 (ADR-279): POST /v1/receivables/{id}/settle-and-issue. A payment against an Owed and the document it is
 * due, in one step under one Idempotency-Key. Today is 2026-11-06 in this harness.
 */
async function world(h: AccountantHarness, opts: { numbering?: boolean } = {}) {
  const owner = await person(h);
  expect((await h.app.request(`/admin/v1/users/${owner.userId}/features/invoicing`, { method: 'PUT', headers: ADMIN })).status).toBe(200);
  const profileId = await businessOf(h, owner, 'Barmajiyat');
  const on = owner.on(profileId);
  expect((await h.app.request('/v1/issuer', json({ legalName: 'Barmajiyat Ltd.', vatId: '123456782', dealerType: 'COMPANY' }, on, 'PUT'))).status).toBe(200);
  if (opts.numbering !== false) expect((await h.app.request('/v1/issuing/numbering', json({ alreadyIssuing: false }, on, 'PUT'))).status).toBe(200);
  const client = async (name: string) => (await read(await h.app.request('/v1/customers', json({ name }, { ...on, ...idem() })))) as { id: string; version: number };
  return { profileId, on, rami: await client('Rami Haddad'), nour: await client('Nour Design') };
}
type World = Awaited<ReturnType<typeof world>>;

const owedOf = async (h: AccountantHarness, w: World, amount: string, customerId: string | null) =>
  (await read(await h.app.request('/v1/income', json({ kind: 'owed', amount, currency: 'ILS', occurredOn: '2026-11-04', ...(customerId ? { customerId } : {}) }, { ...w.on, ...idem() })))) as { id: string };
const prefer = async (h: AccountantHarness, w: World, c: { id: string; version: number }, documentsPreference: string) => {
  const res = await h.app.request(`/v1/customers/${c.id}`, json({ documentsPreference }, { ...w.on, 'if-match': String(c.version) }, 'PATCH'));
  expect(res.status).toBe(200);
};
const pay = (h: AccountantHarness, w: World, receivableId: string, body: Record<string, unknown>, key = idem()) =>
  h.app.request(`/v1/receivables/${receivableId}/settle-and-issue`, json(body, { ...w.on, ...key }));
const issueTaxInvoice = async (h: AccountantHarness, w: World, owedId: string, customerId: string, amount: string) =>
  read(
    await h.app.request(
      '/v1/issued-documents',
      json(
        {
          docType: 'TAX_INVOICE', documentDate: '2026-11-04', currency: 'ILS', language: 'en', customerId, fromEntry: { kind: 'owed', id: owedId }, pricesIncludeVat: true,
          lines: [{ description: 'Work', kind: 'SERVICE', quantity: '1', unitPrice: amount, pricesIncludeVat: true }],
        },
        { ...w.on, ...idem() },
      ),
    ),
  );

describe('settle and issue (MUT-661)', () => {
  it('AC3: 1,000 against a 3,400 tax invoice records the payment and issues a receipt on the invoice; 2,400 stays owed', async () => {
    const h = accountantHarness();
    const w = await world(h);
    await prefer(h, w, w.rami, 'TAX_INVOICE_FIRST');
    const owed = await owedOf(h, w, '3400.00', w.rami.id);
    const invoice = await issueTaxInvoice(h, w, owed.id, w.rami.id, '3400.00');
    // The tax invoice took the recorded Owed over: its own Owed is the one to pay now.
    const res = await pay(h, w, invoice.receivableId, { amount: '1000.00', paidAt: '2026-11-05' });
    expect(res.status, await res.clone().text()).toBe(201);
    const body = await read(res);
    expect(body.payment).toMatchObject({ amount: '1000.00' });
    expect(body.receivable).toMatchObject({ outstanding: '2400.00' });
    expect(body.issue).toMatchObject({ status: 'issued', reason: null, document: { docType: 'RECEIPT', gross: '1000.00', originalId: invoice.id, paymentId: body.payment.id } });
  });

  it('AC4: the same on an On payment client issues an invoice-receipt for 1,000', async () => {
    const h = accountantHarness();
    const w = await world(h);
    const owed = await owedOf(h, w, '3400.00', w.nour.id);
    const body = await read(await pay(h, w, owed.id, { amount: '1000.00' }));
    expect(body.issue).toMatchObject({ status: 'issued', document: { docType: 'TAX_INVOICE_RECEIPT', gross: '1000.00', paymentId: body.payment.id } });
    expect(body.receivable).toMatchObject({ outstanding: '2400.00' });
    // The next payment gets its own document.
    const next = await read(await pay(h, w, owed.id, { amount: '400.00' }));
    expect(next.issue).toMatchObject({ status: 'issued', document: { docType: 'TAX_INVOICE_RECEIPT', gross: '400.00' } });
    expect(next.issue.document.id).not.toBe(body.issue.document.id);
  });

  it('AC5: issue false records the payment only, and its document is due in To issue', async () => {
    const h = accountantHarness();
    const w = await world(h);
    const owed = await owedOf(h, w, '3400.00', w.nour.id);
    const body = await read(await pay(h, w, owed.id, { amount: '1000.00', issue: false }));
    expect(body.issue).toEqual({ status: 'not_requested', reason: null, document: null });
    const due = await read(await h.app.request('/v1/documents-due', { headers: w.on }));
    expect(due.groups.flatMap((g: { items: unknown[] }) => g.items)).toMatchObject([{ kind: 'TAX_INVOICE_RECEIPT', entry: { kind: 'received', id: body.payment.id }, amount: '1000.00' }]);
  });

  it('AC6: a No document client, and an entry marked not for invoice, are due nothing', async () => {
    const h = accountantHarness();
    const w = await world(h);
    await prefer(h, w, w.rami, 'NO_DOCUMENT');
    const none = await owedOf(h, w, '500.00', w.rami.id);
    expect((await read(await pay(h, w, none.id, {}))).issue).toEqual({ status: 'not_due', reason: 'NOT_DUE', document: null });
    // A payment's mark is applied after the payment exists, so the marked Owed is the case here.
    const marked = await owedOf(h, w, '700.00', w.nour.id);
    const version = (await read(await h.app.request(`/v1/receivables/${marked.id}`, { headers: w.on }))).version;
    expect((await h.app.request(`/v1/receivables/${marked.id}/not-for-invoice`, json({ value: true }, { ...w.on, 'if-match': String(version) }, 'PUT'))).status).toBe(200);
    expect((await read(await pay(h, w, marked.id, {}))).issue.status).toBe('not_due');
  });

  it('AC7: when issuing is refused the payment is still recorded and the document stays due', async () => {
    const h = accountantHarness();
    const w = await world(h);
    // A client with a VAT number and an amount over the threshold needs an allocation number; the Tax Authority is off here.
    const big = await read(await h.app.request('/v1/customers', json({ name: 'Big Co', taxId: '516123452' }, { ...w.on, ...idem() })));
    expect(big.id, JSON.stringify(big)).toBeTruthy();
    const owed = await owedOf(h, w, '30000.00', big.id);
    console.log('OWED', JSON.stringify(owed), JSON.stringify(big));
    const res = await pay(h, w, owed.id, { amount: '30000.00' });
    expect(res.status, await res.clone().text()).toBe(201);
    const body = await read(res);
    expect(body.payment).toMatchObject({ amount: '30000.00' });
    expect(body.receivable).toMatchObject({ outstanding: '0.00' });
    expect(body.issue.status).toBe('failed');
    expect(body.issue.reason).toBe('ALLOCATION_NUMBER_REQUIRED');
    const due = await read(await h.app.request('/v1/documents-due', { headers: w.on }));
    expect(due.groups.flatMap((g: { items: unknown[] }) => g.items)).toMatchObject([{ entry: { id: body.payment.id } }]);
  });

  it('a retry with the same Idempotency-Key returns the same payment and document, never a second of either', async () => {
    const h = accountantHarness();
    const w = await world(h);
    const owed = await owedOf(h, w, '3400.00', w.nour.id);
    const key = idem();
    const first = await read(await pay(h, w, owed.id, { amount: '1000.00' }, key));
    const again = await read(await pay(h, w, owed.id, { amount: '1000.00' }, key));
    expect(again.payment.id).toBe(first.payment.id);
    expect(again.issue.document.id).toBe(first.issue.document.id);
    // A different key: a second payment, a second document; the same one on the payment alone after a lost response.
    const replay = await read(await pay(h, w, owed.id, { amount: '1000.00' }, idem()));
    expect(replay.payment.id).not.toBe(first.payment.id);
    expect((await read(await h.app.request('/v1/issued-documents', { headers: w.on }))).items).toHaveLength(2);
  });

  it('an unfinished setup records the payment and says the setup is incomplete', async () => {
    const h = accountantHarness();
    const w = await world(h, { numbering: false });
    const owed = await owedOf(h, w, '900.00', w.nour.id);
    const body = await read(await pay(h, w, owed.id, {}));
    expect(body.payment).toMatchObject({ amount: '900.00' });
    expect(body.issue).toMatchObject({ status: 'failed', reason: 'ISSUING_SETUP_INCOMPLETE' });
  });

  it('is 404 without invoicing, and the settle rules still hold (over the outstanding is 422)', async () => {
    const h = accountantHarness();
    const owner = await person(h);
    const plain = await businessOf(h, owner);
    expect((await h.app.request(`/v1/receivables/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}/settle-and-issue`, json({}, { ...owner.on(plain), ...idem() }))).status).toBe(404);
    const w = await world(h);
    const owed = await owedOf(h, w, '100.00', w.nour.id);
    expect((await pay(h, w, owed.id, { amount: '200.00' })).status).toBe(422);
  });
});
