/**
 * @vitest-environment jsdom
 *
 * MUT-8: Home answers how much am I owed, who is late, and what came in --
 * Owed now, Needs attention (overdue + due within 7 days, oldest first) and
 * the last 10 payments. Every row opens its client; a brand-new install gets
 * one primary action instead of zeroes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OverviewPage } from '../OverviewPage';
import * as useQueries from '../../../hooks/useQueries';
import * as useIncomeQueries from '../../../hooks/useIncomeQueries';
import { formatDate } from '../../../lib/utils';
import type { RecentPaymentRow, TransactionDisplay } from '../../../types';

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

vi.mock('../../../lib/i18n', () => {
  const translations: Record<string, string> = {
    'overview.title': 'Home',
    'overview.needsAttention': 'Needs Attention',
    'overview.noAttention': 'No overdue or upcoming receivables',
    'overview.recentPayments': 'Recent Payments',
    'overview.noPayments': 'No payments recorded yet',
    'overview.noClient': 'No client',
    'overview.empty.title': 'Nothing to track yet',
    'overview.empty.description': 'Add what you did for a client.',
    'overview.empty.action': 'Add income',
    'clients.profile.owedNow': 'Owed now',
    'clients.profile.nothingOwed': 'Nothing owed',
    'clients.profile.overdueAmount': '{amount} overdue',
    'clients.profile.nothingOverdue': 'Nothing overdue',
    'clients.profile.work.untitled': 'Untitled',
    'transactions.status.overdue': '{days}d overdue',
    'transactions.status.dueIn': 'Due in {days}d',
    'transactions.status.dueToday': 'Due today',
  };
  const t = (key: string, vars?: Record<string, string | number>) =>
    (translations[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(vars?.[name] ?? ''));
  return { useT: () => t, useLanguage: () => ({ language: 'en' }), useDirection: () => 'ltr', getLocale: () => 'en-US' };
});

const mockOpenIncomeDrawer = vi.fn();
vi.mock('../../../lib/stores', () => ({
  useDrawerStore: () => ({ openIncomeDrawer: mockOpenIncomeDrawer }),
}));

const onboarding = { skipped: true, complete: false };
vi.mock('../../../lib/onboardingStore', () => ({
  useOnboardingStore: () => ({ skipped: onboarding.skipped, isOnboardingComplete: () => onboarding.complete }),
}));
vi.mock('../../../components/onboarding', () => ({
  OnboardingOverlay: () => <div data-testid="onboarding-overlay" />,
}));
vi.mock('../../../hooks/useActiveProfile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../hooks/useActiveProfile')>()),
  useProfileFilter: () => 'p1',
}));

// Today is pinned to 2026-10-11 below.
const base = { createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', occurredAt: '2026-09-01' };
const receivable = (overrides: Partial<TransactionDisplay>): TransactionDisplay => ({
  ...base,
  id: 'tx',
  kind: 'income',
  status: 'unpaid',
  amountMinor: 10000,
  currency: 'USD',
  paymentStatus: 'unpaid',
  remainingAmountMinor: 10000,
  ...overrides,
});

const overdue = receivable({
  id: 'tx-overdue',
  clientId: 'acme',
  clientName: 'Acme',
  title: 'Design sprint',
  amountMinor: 100000,
  remainingAmountMinor: 100000,
  dueDate: '2026-10-08',
});
const dueToday = receivable({
  id: 'tx-today',
  clientId: 'gamma',
  clientName: 'Gamma',
  title: 'Brand book',
  currency: 'ILS',
  amountMinor: 400000,
  remainingAmountMinor: 400000,
  dueDate: '2026-10-11',
});
const dueInSeven = receivable({
  id: 'tx-seven',
  title: 'Walk-in job',
  currency: 'EUR',
  amountMinor: 50000,
  receivedAmountMinor: 20000,
  paymentStatus: 'partial',
  remainingAmountMinor: 30000,
  dueDate: '2026-10-18',
});
const notDueSoon = receivable({ id: 'tx-later', clientId: 'beta', clientName: 'Beta', amountMinor: 90000, remainingAmountMinor: 90000, dueDate: '2026-11-30' });

const payments: RecentPaymentRow[] = [
  { id: 'pay-1', transactionId: 'tx-a', transactionTitle: 'Homepage', amountMinor: 20000, currency: 'USD', paidAt: '2026-10-05', notes: 'wire', source: 'record', clientId: 'acme', clientName: 'Acme' },
  { id: 'entry:tx-b', transactionId: 'tx-b', transactionTitle: 'Cash job', amountMinor: 5000, currency: 'ILS', paidAt: '2026-09-14', source: 'entry' },
];

function mockData({
  clients = [{ id: 'acme', name: 'Acme' }],
  anyTransaction = true,
  receivables = [overdue, dueToday, dueInSeven, notDueSoon],
  attention = [overdue, dueToday, dueInSeven],
  recent = payments,
}: Partial<{
  clients: { id: string; name: string }[];
  anyTransaction: boolean;
  receivables: TransactionDisplay[];
  attention: TransactionDisplay[];
  recent: RecentPaymentRow[];
}> = {}) {
  vi.spyOn(useQueries, 'useClients').mockReturnValue({ data: clients } as unknown as ReturnType<typeof useQueries.useClients>);
  vi.spyOn(useQueries, 'useTransactions').mockReturnValue({
    data: anyTransaction ? [overdue] : [],
  } as unknown as ReturnType<typeof useQueries.useTransactions>);
  vi.spyOn(useIncomeQueries, 'useReceivables').mockReturnValue({
    data: receivables,
    isLoading: false,
  } as unknown as ReturnType<typeof useIncomeQueries.useReceivables>);
  vi.spyOn(useIncomeQueries, 'useAttentionReceivables').mockReturnValue({
    data: attention,
    isLoading: false,
  } as unknown as ReturnType<typeof useIncomeQueries.useAttentionReceivables>);
  vi.spyOn(useQueries, 'useRecentPayments').mockReturnValue({
    data: recent,
    isLoading: false,
  } as unknown as ReturnType<typeof useQueries.useRecentPayments>);
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OverviewPage />
    </QueryClientProvider>
  );
}

const attentionSection = () => screen.getByRole('region', { name: 'Needs Attention' });
const paymentsSection = () => screen.getByRole('region', { name: 'Recent Payments' });
const rowWith = (scope: HTMLElement, text: string) => within(scope).getByText(text).closest('tr')!;
const stripIsolates = (text: string | null | undefined) => (text ?? '').replace(/[⁦-⁩]/g, '');

describe('OverviewPage (Home)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-10-11T12:00:00'));
    onboarding.skipped = true;
    onboarding.complete = false;
    mockData();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('populated', () => {
    it('shows Owed now first, then Needs attention, then Recent payments', () => {
      renderPage();
      const regions = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label') ?? r.getAttribute('aria-labelledby'));
      expect(regions[0]).toBe('Owed now');
      const owed = screen.getByRole('region', { name: 'Owed now' });
      expect(owed.compareDocumentPosition(attentionSection()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(attentionSection().compareDocumentPosition(paymentsSection()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('shows owed now per currency from every receivable, overdue part called out, nothing summed', () => {
      renderPage();
      const owed = screen.getByRole('region', { name: 'Owed now' });
      // USD 1,000 + 900; ILS 4,000; EUR 300 remaining on the partial
      expect(within(owed).getAllByTestId('owed-now-amount').map((e) => e.textContent)).toEqual(['$1,900', '₪4,000', '€300']);
      expect(stripIsolates(owed.querySelector('.owed-now-overdue')?.textContent)).toBe('$1,000 overdue');
    });

    it('asks for the active profile\'s receivables, attention list and recent payments', () => {
      renderPage();
      expect(useIncomeQueries.useReceivables).toHaveBeenCalledWith({ profileId: 'p1' });
      expect(useIncomeQueries.useAttentionReceivables).toHaveBeenCalledWith(undefined, 'p1');
      expect(useQueries.useRecentPayments).toHaveBeenCalledWith('p1');
    });

    it('does not show the old forecast, month actuals or recent-activity blocks', () => {
      renderPage();
      expect(screen.queryByText('home.forecast.willMakeIt')).toBeNull();
      expect(screen.queryByText('home.actuals.title')).toBeNull();
      expect(screen.queryByText('overview.recentActivity')).toBeNull();
    });
  });

  describe('Needs attention', () => {
    it('lists items in the order given (oldest due first), with client, what for and the remaining amount', () => {
      renderPage();
      const rows = within(attentionSection()).getAllByRole('row');
      expect(rows.map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual([
        'AcmeDesign sprint',
        'GammaBrand book',
        'No clientWalk-in job',
      ]);
      expect(rowWith(attentionSection(), 'Walk-in job')).toHaveTextContent('€300');
    });

    it('buckets with the shared helper: due before today is overdue, due today is not', () => {
      renderPage();
      expect(rowWith(attentionSection(), 'Design sprint')).toHaveTextContent('3d overdue');
      expect(rowWith(attentionSection(), 'Brand book')).toHaveTextContent('Due today');
      expect(rowWith(attentionSection(), 'Brand book')).not.toHaveTextContent('overdue');
    });

    it('labels the last day of the 7-day window as due in 7 days', () => {
      renderPage();
      expect(rowWith(attentionSection(), 'Walk-in job')).toHaveTextContent('Due in 7d');
    });

    it('opens the client profile from a row, or the entry when it has no client', () => {
      renderPage();
      fireEvent.click(rowWith(attentionSection(), 'Design sprint'));
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/clients/$clientId', params: { clientId: 'acme' } });

      fireEvent.click(rowWith(attentionSection(), 'Walk-in job'));
      expect(mockOpenIncomeDrawer).toHaveBeenCalledWith({ mode: 'edit', transactionId: 'tx-seven' });
    });

    it('says there is nothing to chase when the list is empty', () => {
      mockData({ attention: [] });
      renderPage();
      expect(within(attentionSection()).getByText('No overdue or upcoming receivables')).toBeInTheDocument();
    });
  });

  describe('Recent payments', () => {
    it('shows date, amount, client and what it was for', () => {
      renderPage();
      const row = rowWith(paymentsSection(), 'Homepage');
      expect(row).toHaveTextContent(formatDate('2026-10-05', 'en-US'));
      expect(row).toHaveTextContent('$200');
      expect(row).toHaveTextContent('Acme');
      expect(rowWith(paymentsSection(), 'Cash job')).toHaveTextContent('No client');
    });

    it('opens the client profile from a row, or the entry when it has no client', () => {
      renderPage();
      fireEvent.click(rowWith(paymentsSection(), 'Homepage'));
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/clients/$clientId', params: { clientId: 'acme' } });

      fireEvent.click(rowWith(paymentsSection(), 'Cash job'));
      expect(mockOpenIncomeDrawer).toHaveBeenCalledWith({ mode: 'edit', transactionId: 'tx-b' });
    });

    it('says so when nothing has been paid yet', () => {
      mockData({ recent: [] });
      renderPage();
      expect(within(paymentsSection()).getByText('No payments recorded yet')).toBeInTheDocument();
    });
  });

  describe('brand-new install', () => {
    it('offers one primary action instead of zeroes and empty tables', () => {
      mockData({ clients: [], anyTransaction: false, receivables: [], attention: [], recent: [] });
      const { container } = renderPage();

      expect(screen.getByText('Nothing to track yet')).toBeInTheDocument();
      // The top bar's global + Add is chrome; the page itself offers one action
      expect(within(container.querySelector('.page-content') as HTMLElement).getAllByRole('button')).toHaveLength(1);
      expect(screen.queryByRole('region', { name: 'Owed now' })).toBeNull();
      expect(screen.queryByRole('table')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Add income' }));
      expect(mockOpenIncomeDrawer).toHaveBeenCalledWith({ mode: 'create' });
    });

    it('decides nothing while the profile is still loading: no empty state, no onboarding flash', () => {
      onboarding.skipped = false;
      mockData({ clients: [], anyTransaction: false, receivables: [], attention: [], recent: [] });
      vi.spyOn(useQueries, 'useClients').mockReturnValue({ data: undefined, isLoading: true } as unknown as ReturnType<
        typeof useQueries.useClients
      >);
      const { container } = renderPage();

      expect(screen.queryByTestId('onboarding-overlay')).toBeNull();
      expect(screen.queryByText('Nothing to track yet')).toBeNull();
      expect(screen.queryByRole('region', { name: 'Owed now' })).toBeNull();
      expect(container.querySelector('.spinner')).toBeInTheDocument();
    });

    it('still shows onboarding to a new user who has not skipped it', () => {
      onboarding.skipped = false;
      mockData({ clients: [], anyTransaction: false, receivables: [], attention: [], recent: [] });
      renderPage();
      expect(screen.getByTestId('onboarding-overlay')).toBeInTheDocument();
    });
  });
});
