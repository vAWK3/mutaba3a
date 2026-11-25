import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Receivable } from '../../api/client';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { profile } from '../../__tests__/harness';
import { CUSTOMERS, PROJECTS, receivable } from '../../pages/__tests__/fixtures';
import { ToastProvider } from '../Toast';
import { RecordPaymentDrawer } from '../RecordPaymentDrawer';

const issuing = vi.hoisted(() => ({ value: { canIssue: true, defaultPreference: 'ON_PAYMENT' as string } }));
vi.mock('../../data/issuedQueries', () => ({ useIssueWithPayment: () => issuing.value }));
vi.mock('../../analytics/portalAnalytics', () => ({ trackPortal: vi.fn(async () => {}) }));

const R = 'b1111111-1111-4111-8111-111111111111';
const BUSINESS = profile({ writerOfRecord: null, owned: true, type: 'BUSINESS', access: { payments: 'read-write', capture: 'read-write', expenses: 'read-write' }, income: { received: true, owed: true, customer: 'optional' }, timezone: 'Asia/Jerusalem' });
const owed = (overrides: Partial<Receivable> = {}): Receivable => ({ ...receivable(R, CUSTOMERS[0].id, PROJECTS[0].id, '3400.00', 'DUE', '2026-10-15'), origin: 'ADJUSTMENT', currency: 'ILS', ...overrides });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stub(current: Receivable, issue: unknown, pref: string | null = null) {
  const calls: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), 'http://portal.test');
      const method = (init.method ?? 'GET').toUpperCase();
      calls.push({ method, path: url.pathname, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
      if (url.pathname === '/v1/customers') return json({ items: CUSTOMERS.map((c, i) => (i === 0 ? { ...c, documentsPreference: pref } : c)), nextCursor: null });
      if (url.pathname === '/v1/projects') return json({ items: PROJECTS, nextCursor: null });
      if (method === 'GET' && url.pathname === `/v1/receivables/${R}`) return json(current);
      if (method === 'POST') return json({ receivable: owed({ status: 'DUE', outstanding: '2400.00' }), payment: {}, issue }, 201);
      return json({ error: { code: 'NOT_FOUND', message: 'x', requestId: 'r' } }, 404);
    }),
  );
  return calls;
}

function open() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <HostedLanguageProvider>
        <ToastProvider>
          <RecordPaymentDrawer profile={BUSINESS} receivableId={R} onClose={vi.fn()} onSettled={vi.fn()} />
        </ToastProvider>
      </HostedLanguageProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  issuing.value = { canIssue: true, defaultPreference: 'ON_PAYMENT' };
});
afterEach(() => vi.unstubAllGlobals());

describe('Record payment with its document (MUT-661)', () => {
  it('shows the control on by default and records the payment and its invoice-receipt in one request', async () => {
    const calls = stub(owed(), { status: 'issued', reason: null, document: { number: 12 } });
    const user = open();
    const box = await screen.findByTestId('settle-issue');
    expect(box).toBeChecked();
    expect(screen.getByText('Issue a tax invoice-receipt for this payment')).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/Amount/));
    await user.type(screen.getByLabelText(/Amount/), '1000');
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.path).toBe(`/v1/receivables/${R}/settle-and-issue`));
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ amount: '1000.00', issue: true });
    expect(await screen.findByText(/Document 12 issued/)).toBeInTheDocument();
  });

  it('control off records the payment only (issue false)', async () => {
    const calls = stub(owed(), { status: 'not_requested', reason: null, document: null });
    const user = open();
    await user.click(await screen.findByTestId('settle-issue'));
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ issue: false });
  });

  it('says the payment is recorded and the document waits in To issue when issuing failed', async () => {
    stub(owed(), { status: 'failed', reason: 'ALLOCATION_NUMBER_REQUIRED', document: null });
    const user = open();
    await user.click(await screen.findByRole('button', { name: 'Record payment' }));
    expect(await screen.findByText(/waiting in To issue/)).toBeInTheDocument();
  });

  it('has no control for a No document client, a not-for-invoice entry, or where the setup can not issue', async () => {
    stub(owed(), null, 'NO_DOCUMENT');
    open();
    await screen.findByRole('button', { name: 'Record payment' });
    await waitFor(() => expect(screen.queryByTestId('settle-issue')).toBeNull());
  });

  it('on a tax invoice\'s own Owed the receipt is the payment: shown on and locked', async () => {
    stub(owed({ origin: 'ISSUED_DOCUMENT' }), { status: 'issued', reason: null, document: { number: 3 } }, 'TAX_INVOICE_FIRST');
    open();
    const box = await screen.findByTestId('settle-issue');
    expect(box).toBeChecked();
    expect(box).toBeDisabled();
    expect(screen.getByText('Issue a receipt for this payment')).toBeInTheDocument();
  });
});
