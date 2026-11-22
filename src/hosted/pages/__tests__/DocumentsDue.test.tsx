import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ORG_A, emptyProfileRoutes, fail, me, ok, profile, renderPortal, stubApi, type Handler } from '../../__tests__/harness';
import type { DocumentsDue, DueItem } from '../../api/client';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { CUSTOMERS, C1, C2, page, payment } from './fixtures';

/**
 * MUT-660: Documents › To issue (grouped by client, Issue all, bulk not for invoice, older than) and Home's To issue
 * group. The server derives what is due; the portal reads it, issues and marks.
 */

const OWN = profile({ writerOfRecord: null, owned: true, type: 'BUSINESS', access: { payments: 'read-write', capture: 'read-write', expenses: 'read-write' }, income: { received: true, owed: true, customer: 'optional' } });
const TO_ISSUE = `/p/${ORG_A}/documents/to-issue`;

const item = (id: string, over: Partial<DueItem> = {}): DueItem => ({
  kind: 'TAX_INVOICE_RECEIPT',
  entry: { kind: 'received', id, number: `PAY-2026-${id.slice(-4)}` },
  customerId: C1,
  amount: '700.00',
  currency: 'ILS',
  date: '2026-11-19',
  issuable: true,
  reason: null,
  appliesToDocumentId: null,
  ...over,
});

const E1 = 'e0000000-0000-4000-8000-000000000001';
const E2 = 'e0000000-0000-4000-8000-000000000002';
const E3 = 'e0000000-0000-4000-8000-000000000003';
const E4 = 'e0000000-0000-4000-8000-000000000004';

const DUE: DocumentsDue = {
  view: 'to-issue',
  groups: [
    { customerId: null, items: [item(E4, { customerId: null, amount: '450.00', date: '2026-03-12' })] },
    { customerId: C2, items: [item(E3, { customerId: C2, kind: 'PAYMENT_REQUEST', entry: { kind: 'owed', id: E3, number: 'CHG-2026-0009' }, issuable: false, reason: 'PAYMENT_REQUEST_PENDING', amount: '5000.00' })] },
    { customerId: C1, items: [item(E1, { kind: 'TAX_INVOICE', entry: { kind: 'owed', id: E1, number: 'CHG-2026-0001' }, amount: '3400.00' }), item(E2)] },
  ],
  counts: { total: 4, byKind: { TAX_INVOICE: 1, TAX_INVOICE_RECEIPT: 2, PAYMENT_REQUEST: 1 } },
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
});
afterEach(() => vi.unstubAllGlobals());

function portal(path: string, routes: Record<string, Handler> = {}) {
  const api = stubApi({
    'GET /v1/me': () => ok(me([OWN])),
    ...emptyProfileRoutes(),
    'GET /v1/customers': () => ok(page(CUSTOMERS)),
    'GET /v1/issuing/setup': () => ok({ issuer: null, logoId: null, numberingAnswered: true, introSeen: true, defaultsSaved: true, missing: [] }),
    'GET /v1/documents-due': () => ok(DUE),
    'GET /v1/documents-due/count': () => ok({ total: 4 }),
    ...routes,
  });
  return { ...renderPortal(path), api, user: userEvent.setup() };
}

describe('Documents › To issue (MUT-660)', () => {
  it('groups by client name with No client last; a row that can’t be issued says why and offers Attach and Not for invoice', async () => {
    portal(TO_ISSUE);
    const groups = await screen.findAllByTestId(/^due-group-/);
    expect(groups.map((g) => within(g).getByRole('heading', { level: 3 }).textContent)).toEqual(['Al-Quds Bakery', 'Nablus Trading', 'No client']);
    const nablus = screen.getByTestId(`due-group-${C2}`);
    expect(within(nablus).getByText(/Payment requests can't be issued here yet/)).toBeInTheDocument();
    expect(within(nablus).getByRole('button', { name: 'Attach' })).toBeInTheDocument();
    expect(within(nablus).getByTestId(`due-nfi-${E3}`)).toBeInTheDocument();
    expect(within(nablus).queryByTestId(`due-issue-all-${C2}`)).toBeNull();
    expect(screen.getByRole('link', { name: 'To issue' })).toHaveAttribute('aria-current', 'page');
  });

  it('AC7: Issue all confirms in place with the count, then issues the client’s items in one call', async () => {
    const { api, user } = portal(TO_ISSUE, {
      'POST /v1/documents-due/issue': (req) => {
        const body = req.body as { items: unknown[] };
        return ok({ results: body.items.map((entry) => ({ entry, status: 'issued', reason: null, document: null })), issued: body.items.length });
      },
    });
    await user.click(await screen.findByTestId(`due-issue-all-${C1}`));
    expect(screen.getByText('Issue 2 documents for Al-Quds Bakery? Issuing is final.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Issue 2' }));
    expect(await screen.findByText('2 documents issued for Al-Quds Bakery.')).toBeInTheDocument();
    const post = api.calls.find((c) => c.method === 'POST' && c.url.pathname === '/v1/documents-due/issue');
    expect(post?.body).toEqual({ customerId: C1, items: [{ kind: 'owed', id: E1 }, { kind: 'received', id: E2 }] });
    expect(post?.headers.get('Idempotency-Key')).toBeTruthy();
  });

  it('AC8: bulk not for invoice: select all shown, one confirmation with the count, then Undo sends them back', async () => {
    const { api, user } = portal(TO_ISSUE, { 'POST /v1/documents-due/not-for-invoice': (req) => ok({ changed: (req.body as { items: unknown[] }).items.length }) });
    await user.click(await screen.findByTestId('due-select-all'));
    expect(within(screen.getByTestId('due-bulk')).getByText('4 selected')).toBeInTheDocument();
    await user.click(screen.getByTestId('due-bulk-action'));
    expect(screen.getByText('Mark 4 entries not for invoice?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark 4' }));
    expect(await screen.findByText('4 marked not for invoice')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(api.count('POST /v1/documents-due/not-for-invoice')).toBe(2));
    const [mark, undo] = api.calls.filter((c) => c.url.pathname === '/v1/documents-due/not-for-invoice');
    expect(mark!.body).toMatchObject({ value: true });
    expect((mark!.body as { items: unknown[] }).items).toHaveLength(4);
    expect(undo!.body).toMatchObject({ value: false });
  });

  it('AC5: a refused mark says a credit note comes first', async () => {
    const { user } = portal(TO_ISSUE, { 'POST /v1/documents-due/not-for-invoice': () => fail(409, 'CONFLICT', { reason: 'HAS_TAX_DOCUMENT' }) });
    await user.click(await screen.findByTestId(`due-nfi-${E3}`));
    expect(await screen.findByText(/Issue a credit note first/)).toBeInTheDocument();
  });

  it('AC8 (D21): older than offers 1, 3, 6 and 12 months and asks the server for that window', async () => {
    const { api, user } = portal(TO_ISSUE);
    const select = await screen.findByTestId('due-older');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Any date', '1 month', '3 months', '6 months', '12 months']);
    await user.selectOptions(select, '6');
    await waitFor(() => expect(api.calls.some((c) => c.url.pathname === '/v1/documents-due' && c.url.searchParams.get('olderThanMonths') === '6')).toBe(true));
  });

  it('is hidden where invoicing is off (the setup answers 404)', async () => {
    portal(TO_ISSUE, { 'GET /v1/issuing/setup': () => fail(404, 'NOT_FOUND') });
    await waitFor(() => expect(screen.queryByTestId(/^due-group-/)).toBeNull());
    expect(screen.queryByText('Nothing to issue.')).toBeNull();
  });
});

describe('Home’s To issue group (MUT-660, AC6)', () => {
  it('shows the count of documents due, the clients with the most, and links to the list', async () => {
    portal(`/p/${ORG_A}`, { 'GET /v1/summaries/organization': () => ok({ asOf: '2026-11-22', currencies: [] }), 'GET /v1/receipts/counts': () => ok({ toReview: 0, filed: 0 }) });
    const group = await screen.findByRole('region', { name: 'To issue' });
    expect(within(group).getByText('4 documents to issue')).toBeInTheDocument();
    expect(within(group).getByRole('link', { name: 'See all documents to issue' })).toHaveAttribute('href', TO_ISSUE);
    await waitFor(() => expect(within(group).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Al-Quds Bakery2 documents to issue', 'Nablus Trading1 document to issue', 'No client1 document to issue']));
  });

  it('is absent where invoicing is off', async () => {
    portal(`/p/${ORG_A}`, { 'GET /v1/documents-due/count': () => fail(404, 'NOT_FOUND'), 'GET /v1/summaries/organization': () => ok({ asOf: '2026-11-22', currencies: [] }), 'GET /v1/receipts/counts': () => ok({ toReview: 0, filed: 0 }) });
    expect(await screen.findByText('Nothing needs you right now.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'To issue' })).toBeNull();
  });
});

describe('the not-for-invoice mark on a Paid row (MUT-660, wireframe screen 3)', () => {
  const PAY = 'f0000000-0000-4000-8000-000000000001';
  const paid = (notForInvoice: boolean) => ({ ...payment(PAY, 'PAY-2026-0001'), origin: 'capture', version: 3, notForInvoice });

  it('marks a row with the version it read; a tax document refuses with the credit-note message', async () => {
    let refuse = false;
    const { api, user } = portal(`/p/${ORG_A}/payments`, {
      'GET /v1/payments': () => ok(page([paid(false)])),
      'GET /v1/issuing/external-invoices': () => ok({ items: [] }),
      [`PUT /v1/payments/${PAY}/not-for-invoice`]: () => (refuse ? fail(409, 'CONFLICT', { reason: 'HAS_TAX_DOCUMENT' }) : ok({ kind: 'received', id: PAY, notForInvoice: true, version: 4 })),
    });
    await user.click(await screen.findByTestId(`nfi-mark-${PAY}`));
    expect(await screen.findByText('Marked not for invoice')).toBeInTheDocument();
    const put = api.calls.find((c) => c.method === 'PUT');
    expect(put?.headers.get('If-Match')).toBe('3');
    expect(put?.body).toEqual({ value: true });
    refuse = true;
    await user.click(screen.getByTestId(`nfi-mark-${PAY}`));
    expect(await screen.findByText(/Issue a credit note first/)).toBeInTheDocument();
  });

  it('a marked row shows the badge and Back to invoice', async () => {
    portal(`/p/${ORG_A}/payments`, { 'GET /v1/payments': () => ok(page([paid(true)])), 'GET /v1/issuing/external-invoices': () => ok({ items: [] }) });
    expect(await screen.findByTestId(`nfi-back-${PAY}`)).toHaveTextContent('Back to invoice');
  });
});

describe('a client’s documents preference (MUT-660, AC1, wireframe screen 4)', () => {
  const client = { ...CUSTOMERS[0]!, taxId: null, address: null, documentsPreference: null, version: 2 };

  it('shows the profile default and what is due; a change saves with If-Match and says what is due now', async () => {
    const { api, user } = portal(`/p/${ORG_A}/clients/${C1}?tab=details`, {
      [`GET /v1/customers/${C1}`]: () => ok(client),
      'GET /v1/issuer': () => ok({ legalName: 'Studio', vatId: '123456789', dealerType: 'LICENSED', defaultDocumentsPreference: 'ON_PAYMENT', version: 1 }),
      [`PATCH /v1/customers/${C1}`]: (req) => ok({ ...client, ...(req.body as object), version: 3 }),
    });
    const field = await screen.findByTestId('client-documents-preference');
    const select = within(field).getByRole('combobox', { name: 'Documents' });
    expect(select).toHaveValue('DEFAULT');
    expect(within(field).getByRole('option', { name: 'Profile default (On payment)' })).toBeInTheDocument();
    expect(field).toHaveTextContent('a tax invoice-receipt for each payment, partial ones included.');
    await user.selectOptions(select, 'TAX_INVOICE_FIRST');
    await waitFor(() => expect(api.calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = api.calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toEqual({ documentsPreference: 'TAX_INVOICE_FIRST' });
    expect(patch?.headers.get('If-Match')).toBe('2');
  });

  it('is hidden where invoicing is off', async () => {
    portal(`/p/${ORG_A}/clients/${C1}`, { [`GET /v1/customers/${C1}`]: () => ok(client), 'GET /v1/issuing/setup': () => fail(404, 'NOT_FOUND') });
    expect(await screen.findByRole('heading', { name: 'Al-Quds Bakery' })).toBeInTheDocument();
    expect(screen.queryByTestId('client-documents-preference')).toBeNull();
  });
});

describe('Reports’ income split (MUT-660, AC9, wireframe screen 6)', () => {
  it('shows invoice income, not for invoice and all income per currency', async () => {
    const { render } = await import('@testing-library/react');
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const { HostedLanguageProvider } = await import('../../i18n/HostedLanguageProvider');
    const { InvoiceSplitCard } = await import('../views/InvoiceSplitCard');
    render(
      <QueryClientProvider client={new QueryClient()}>
        <HostedLanguageProvider>
          <InvoiceSplitCard rows={[{ currency: 'ILS', invoiceIncome: '14200.00', notForInvoice: '3260.00', all: '17460.00' }, { currency: 'USD', invoiceIncome: '0.00', notForInvoice: '0.00', all: '0.00' }]} />
        </HostedLanguageProvider>
      </QueryClientProvider>,
    );
    const card = screen.getByTestId('invoice-split');
    expect(within(card).getByRole('heading', { name: 'Income and invoices' })).toBeInTheDocument();
    expect(within(card).getAllByRole('definition').map((d) => d.textContent)).toEqual(['₪14,200.00', '₪3,260.00', '₪17,460.00']);
  });
});
