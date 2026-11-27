import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../../../../lib/theme';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';
import { ok, stubApi } from '../../../__tests__/harness';
import { formatBalance, formatMonth } from '../../../format/ledger';
import { LedgerCard } from '../LedgerCard';

vi.mock('@tanstack/react-router', () => ({ Link: ({ to, children, ...rest }: { to: string; children: unknown }) => <a href={to} {...(rest as object)}>{children as never}</a> }));

/** MUT-664: the ledger card (layout A), newest first, D14 and D15. */
const P = 'p1111111-1111-4111-8111-111111111111';
const C = 'c1111111-1111-4111-8111-111111111111';
const line = (o: Record<string, unknown>) => ({ projectId: null, debit: '0.00', credit: '0.00', documents: [], due: null, number: null, ...o });
const page = (lines: unknown[], o: Record<string, unknown> = {}) => ({ customerId: C, currency: 'ILS', projectId: null, from: null, to: null, asOf: '2026-11-22', openingBalance: '0.00', totals: { debit: '0.00', credit: '0.00' }, closingBalance: '4500.00', lines, nextCursor: null, ...o });

function renderCard(props: Partial<Parameters<typeof LedgerCard>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <HostedLanguageProvider>
          <LedgerCard profileId={P} customerId={C} currencies={['ILS', 'USD']} currency={undefined} period="all" writable openLine={() => null} onChange={onChange} {...props} />
        </HostedLanguageProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onChange, user: userEvent.setup() };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
});
afterEach(() => vi.unstubAllGlobals());

describe('LedgerCard with no movements (MUT-774)', () => {
  it('a client with no movements shows the ledger-empty scene and one line', async () => {
    stubApi({ [`GET /v1/customers/${C}/statement`]: () => ok(page([], { closingBalance: '0.00' })) });
    renderCard();
    const empty = await screen.findByTestId('ledger-empty');
    expect(empty.querySelector('[data-scene="ledger-empty"]')).not.toBeNull();
    expect(empty).toHaveTextContent('No movements yet');
  });

  it('no currency at all (a client never charged) is the same empty state', async () => {
    stubApi({});
    renderCard({ currencies: [] });
    expect((await screen.findByTestId('ledger-empty')).querySelector('[data-scene="ledger-empty"]')).not.toBeNull();
  });
});

describe('LedgerCard (MUT-664)', () => {
  it('asks for the first currency newest first, shows each line with its tags and what is due, and a month row', async () => {
    const api = stubApi({
      [`GET /v1/customers/${C}/statement`]: () =>
        ok(page([
          line({ id: 'p1', kind: 'PAYMENT', date: '2026-11-22', credit: '1000.00', runningBalance: '4500.00', paymentId: 'p1', number: 'PAY-9', due: 'RECEIPT' }),
          line({ id: 'r1', kind: 'CHARGE', date: '2026-11-01', debit: '6000.00', runningBalance: '5500.00', receivableId: 'r1', outstanding: '5000.00', documents: [{ id: 'd1', source: 'ISSUED', docType: 'TAX_INVOICE', number: '1044' }] }),
        ])),
    });
    renderCard();
    expect(await screen.findAllByTestId('ledger-line')).toHaveLength(2);
    expect(screen.getByTestId('ledger-closing')).toHaveTextContent('4,500.00');
    expect(screen.getByTestId('ledger-due')).toHaveTextContent('Receipt due');
    expect(screen.getByRole('link', { name: 'Tax invoice 1044' })).toHaveAttribute('href', `/p/${P}/documents/issued/d1`);
    expect(screen.getByText('November 2026')).toBeInTheDocument();
    const asked = api.calls.find((c) => c.url.pathname.endsWith('/statement'))!;
    expect(asked.url.searchParams.get('order')).toBe('desc');
    expect(asked.url.searchParams.get('currency')).toBe('ILS');
    expect(asked.url.searchParams.get('limit')).toBe('50');
  });

  it('a balance below zero reads Client in credit, never a minus (D15); view only shows its chip', async () => {
    stubApi({ [`GET /v1/customers/${C}/statement`]: () => ok(page([line({ id: 'p1', kind: 'PAYMENT', date: '2026-11-22', credit: '200.00', runningBalance: '-200.00', paymentId: 'p1' })], { closingBalance: '-200.00' })) });
    renderCard({ writable: false });
    expect(await screen.findByTestId('ledger-closing')).toHaveTextContent('Client in credit · ');
    expect(screen.getByTestId('ledger-closing')).not.toHaveTextContent('-');
    expect(screen.getByText('View only')).toBeInTheDocument();
  });

  it('Show earlier asks for the next page with the cursor', async () => {
    const api = stubApi({
      [`GET /v1/customers/${C}/statement`]: (r) =>
        r.url.searchParams.get('cursor') ? ok(page([line({ id: 'old', kind: 'CHARGE', date: '2026-01-02', debit: '1.00', runningBalance: '1.00', receivableId: 'old', outstanding: '1.00' })])) : ok(page([line({ id: 'new', kind: 'CHARGE', date: '2026-11-02', debit: '1.00', runningBalance: '2.00', receivableId: 'new', outstanding: '1.00' })], { nextCursor: 'next-1' })),
    });
    const { user } = renderCard();
    await user.click(await screen.findByTestId('ledger-earlier'));
    await waitFor(() => expect(screen.getAllByTestId('ledger-line')).toHaveLength(2));
    expect(api.calls.some((c) => c.url.searchParams.get('cursor') === 'next-1')).toBe(true);
  });

  it('formats a credit balance without its sign, and months in Levantine Arabic', () => {
    expect(formatBalance('-200.00', 'ILS', 'en')).toMatchObject({ inCredit: true });
    expect(formatBalance('-200.00', 'ILS', 'en').text).not.toContain('-');
    expect(formatBalance('0.00', 'ILS', 'en').inCredit).toBe(false);
    expect(formatMonth('2026-11-22', 'ar')).toContain('تشرين الثاني');
    expect(formatMonth('2026-01-05', 'ar')).toContain('كانون الثاني');
  });
});
