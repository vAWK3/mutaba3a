/**
 * @vitest-environment jsdom
 *
 * MUT-3: the client profile is one page with three sections -- Owed Now,
 * Work and billing, Payments -- answering the product's three questions with
 * no tab clicks. The MUT-6 (Record payment), MUT-13 (invoices, retainers) and
 * MUT-16 (projects switch) behaviours are re-asserted on the new sections.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClientDetailPage } from '../ClientDetailPage';
import * as useQueries from '../../../hooks/useQueries';
import * as useIncomeQueries from '../../../hooks/useIncomeQueries';
import { formatDate } from '../../../lib/utils';
import { MIGRATED_PAYMENT_NOTE } from '../../../db/database';
import type { IncomeFilters } from '../../../hooks/useIncomeQueries';
import type { PaymentByClientRow, TransactionDisplay } from '../../../types';

// Mock router
const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ clientId: 'client-1' }),
  useNavigate: () => mockNavigate,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

// Advanced-feature switches: off unless a test turns one on; projects starts on
const featureFlags: Record<string, boolean> = { invoices: false, retainers: false, projects: true };
vi.mock('../../../lib/features/useFeatures', () => ({
  useFeatureEnabled: (key: string) => featureFlags[key] ?? false,
}));

// i18n: real interpolation so rendered sentences can be asserted
vi.mock('../../../lib/i18n', () => {
  const translations: Record<string, string> = {
    'common.loading': 'Loading...',
    'common.edit': 'Edit',
    'common.markPaid': 'Mark Paid',
    'common.duplicate': 'Duplicate',
    'nav.clients': 'Clients',
    'clients.notFound': 'Client not found',
    'clients.notFoundHint': 'This client may have been deleted',
    'clients.profile.owedNow': 'Owed now',
    'clients.profile.nothingOwed': 'Nothing owed',
    'clients.profile.overdueAmount': '{amount} overdue',
    'clients.profile.nothingOverdue': 'Nothing overdue',
    'clients.profile.work.title': 'Work and billing',
    'clients.profile.work.add': 'Add income',
    'clients.profile.work.what': 'What',
    'clients.profile.work.untitled': 'Untitled',
    'clients.profile.work.emptyTitle': 'No work recorded for this client yet',
    'clients.profile.work.emptyHint': 'Add what you did and what it is worth.',
    'clients.profile.work.noMatches': 'No entries match these filters',
    'clients.profile.work.clearFilters': 'Clear filters',
    'clients.profile.payments.title': 'Payments',
    'clients.profile.payments.for': 'For',
    'clients.profile.payments.recordedOnEntry': 'Recorded on the entry',
    'clients.profile.payments.openEntry': 'Open income entry',
    'projects.addProject': 'Add Project',
    'transactions.columns.date': 'Date',
    'transactions.columns.amount': 'Amount',
    'transactions.columns.status': 'Status',
    'transactions.status.paid': 'Paid',
    'transactions.status.unpaid': 'Unpaid',
    'transactions.status.partial': 'Partial ({percent}%)',
    'transactions.status.overdue': '{days}d overdue',
    'transactions.status.dueIn': 'Due in {days}d',
    'transactions.status.dueToday': 'Due today',
    'transactions.partialPayment.recordPayment': 'Record Payment',
    'transactions.partialPayment.remaining': 'Remaining',
    'transactions.partialPayment.noPayments': 'No payments recorded yet',
    'transactions.partialPayment.editPayment': 'Edit Payment',
    'transactions.partialPayment.notes': 'Notes',
    'transactions.partialPayment.migratedNote': 'Carried over from the old total',
    'transactions.generateInvoice': 'Generate invoice',
    'transactions.viewInvoice': 'View invoice',
    'filters.status.all': 'All',
    'filters.status.paid': 'Paid',
    'filters.status.unpaid': 'Unpaid',
    'filters.status.overdue': 'Overdue',
  };
  const t = (key: string, vars?: Record<string, string | number>) =>
    (translations[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(vars?.[name] ?? ''));
  return {
    useT: () => t,
    useLanguage: () => ({ language: 'en' }),
    useDirection: () => 'ltr',
    getLocale: () => 'en-US',
  };
});

// Drawer store
const mockOpenClientDrawer = vi.fn();
const mockOpenProjectDrawer = vi.fn();
const mockOpenIncomeDrawer = vi.fn();
const mockOpenDocumentDrawer = vi.fn();
const mockOpenRetainerDrawer = vi.fn();
const mockOpenPartialPaymentDrawer = vi.fn();
const mockEditPaymentRecord = vi.fn();
vi.mock('../../../lib/stores', () => ({
  useDrawerStore: () => ({
    openClientDrawer: mockOpenClientDrawer,
    openProjectDrawer: mockOpenProjectDrawer,
    openIncomeDrawer: mockOpenIncomeDrawer,
    openDocumentDrawer: mockOpenDocumentDrawer,
    openRetainerDrawer: mockOpenRetainerDrawer,
    openPartialPaymentDrawer: mockOpenPartialPaymentDrawer,
    editPaymentRecord: mockEditPaymentRecord,
  }),
}));

// Retainers card data (MUT-13): the card itself renders for real
vi.mock('../../../hooks/useRetainerQueries', () => ({
  useRetainers: () => ({ data: [], isLoading: false }),
}));

const mockClient = {
  id: 'client-1',
  name: 'Acme Corp',
  email: 'contact@acme.com',
  phone: '+1234567890',
  notes: 'Great client',
};

const base = { createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', clientId: 'client-1' };

// Today is pinned to 2026-10-11 below.
const txOverdue: TransactionDisplay = {
  ...base,
  id: 'tx-overdue',
  kind: 'income',
  status: 'unpaid',
  title: 'Design sprint',
  amountMinor: 100000,
  currency: 'USD',
  occurredAt: '2026-10-01',
  dueDate: '2026-10-08',
  paymentStatus: 'unpaid',
  remainingAmountMinor: 100000,
  projectId: 'project-1',
  projectName: 'Website Redesign',
};
const txPartial: TransactionDisplay = {
  ...base,
  id: 'tx-partial',
  kind: 'income',
  status: 'unpaid',
  title: 'Homepage',
  amountMinor: 50000,
  currency: 'USD',
  occurredAt: '2026-09-20',
  dueDate: '2026-10-20',
  receivedAmountMinor: 20000,
  paymentStatus: 'partial',
  remainingAmountMinor: 30000,
  projectId: 'project-2',
  projectName: 'Mobile App',
};
const txPaid: TransactionDisplay = {
  ...base,
  id: 'tx-paid',
  kind: 'income',
  status: 'paid',
  title: 'Logo',
  amountMinor: 70000,
  currency: 'USD',
  occurredAt: '2026-09-12',
  paidAt: '2026-09-14',
  receivedAmountMinor: 70000,
  paymentStatus: 'paid',
  remainingAmountMinor: 0,
  linkedDocumentId: 'doc-9',
};
const txUntitledIls: TransactionDisplay = {
  ...base,
  id: 'tx-ils',
  kind: 'income',
  status: 'unpaid',
  amountMinor: 420000,
  currency: 'ILS',
  occurredAt: '2026-09-05',
  paymentStatus: 'unpaid',
  remainingAmountMinor: 420000,
};

const workRows = [txOverdue, txPartial, txPaid, txUntitledIls];
const receivables = [txOverdue, txPartial, txUntitledIls];

const payments: PaymentByClientRow[] = [
  {
    id: 'pay-1',
    transactionId: 'tx-partial',
    transactionTitle: 'Homepage',
    amountMinor: 20000,
    currency: 'USD',
    paidAt: '2026-10-05',
    notes: 'wire',
    source: 'record',
  },
  {
    id: 'entry:tx-paid',
    transactionId: 'tx-paid',
    transactionTitle: 'Logo',
    amountMinor: 70000,
    currency: 'USD',
    paidAt: '2026-09-14',
    source: 'entry',
  },
];

const mockMarkPaid = vi.fn();
let useIncomeSpy: ReturnType<typeof vi.spyOn>;
let useProjectsSpy: ReturnType<typeof vi.spyOn>;

function mockWork(rowsFor: (filters: IncomeFilters) => TransactionDisplay[]) {
  useIncomeSpy = vi.spyOn(useIncomeQueries, 'useIncome').mockImplementation(
    (filters?: IncomeFilters) =>
      ({ data: rowsFor(filters ?? {}), isLoading: false }) as unknown as ReturnType<
        typeof useIncomeQueries.useIncome
      >
  );
}

function mockReceivables(rows: TransactionDisplay[]) {
  vi.spyOn(useIncomeQueries, 'useReceivables').mockReturnValue({
    data: rows,
    isLoading: false,
  } as unknown as ReturnType<typeof useIncomeQueries.useReceivables>);
}

function mockPayments(rows: PaymentByClientRow[]) {
  vi.spyOn(useQueries, 'usePaymentsByClient').mockReturnValue({
    data: rows,
    isLoading: false,
  } as unknown as ReturnType<typeof useQueries.usePaymentsByClient>);
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ClientDetailPage />
    </QueryClientProvider>
  );
}

const workSection = () => screen.getByRole('region', { name: 'Work and billing' });
const paymentsSection = () => screen.getByRole('region', { name: 'Payments' });
const rowOf = (scope: HTMLElement, text: string) => within(scope).getByText(text).closest('tr')!;
const stripIsolates = (text: string | null) => (text ?? '').replace(/[⁦-⁩]/g, '');

describe('ClientDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-10-11T12:00:00'));
    featureFlags.invoices = false;
    featureFlags.retainers = false;
    featureFlags.projects = true;

    vi.spyOn(useQueries, 'useClient').mockReturnValue({
      data: mockClient,
      isLoading: false,
    } as ReturnType<typeof useQueries.useClient>);
    useProjectsSpy = vi.spyOn(useQueries, 'useProjects');
    vi.spyOn(useIncomeQueries, 'useMarkIncomePaid').mockReturnValue({
      mutate: mockMarkPaid,
    } as unknown as ReturnType<typeof useIncomeQueries.useMarkIncomePaid>);
    mockWork(() => workRows);
    mockReceivables(receivables);
    mockPayments(payments);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('one page, no tabs', () => {
    it('renders Owed Now, Work and billing and Payments together with no tab buttons', () => {
      renderPage();

      expect(screen.getByRole('region', { name: 'Owed now' })).toBeInTheDocument();
      expect(workSection()).toBeInTheDocument();
      expect(paymentsSection()).toBeInTheDocument();
      for (const tab of ['Summary', 'Receivables', 'Transactions', 'Projects']) {
        expect(screen.queryByRole('button', { name: tab })).toBeNull();
      }
    });

    it('shows the client contact details in the header', () => {
      renderPage();

      expect(screen.getByText('contact@acme.com')).toBeInTheDocument();
      expect(screen.getByText('+1234567890')).toBeInTheDocument();
      expect(screen.getByText('Great client')).toBeInTheDocument();
    });

    it('does not fetch the projects list it never used (MUT-23)', () => {
      renderPage();
      expect(useProjectsSpy).not.toHaveBeenCalled();
    });

    it('shows the not-found state for a missing client', () => {
      vi.spyOn(useQueries, 'useClient').mockReturnValue({
        data: null,
        isLoading: false,
      } as unknown as ReturnType<typeof useQueries.useClient>);
      renderPage();
      expect(screen.getAllByText('Client not found').length).toBeGreaterThan(0);
    });
  });

  describe('Owed now (question 2)', () => {
    it('shows each currency separately from the client receivables', () => {
      renderPage();

      // USD: 1,000 unpaid + 300 remaining on the partial. ILS: 4,200.
      const amounts = screen.getAllByTestId('owed-now-amount').map((el) => el.textContent);
      expect(amounts).toEqual(['$1,300', '₪4,200']);
    });

    it('distinguishes the overdue part', () => {
      renderPage();

      const hero = screen.getByRole('region', { name: 'Owed now' });
      const overdue = hero.querySelector('.owed-now-overdue');
      expect(stripIsolates(overdue?.textContent ?? null)).toBe('$1,000 overdue');
      expect(within(hero).getByText('Nothing overdue')).toBeInTheDocument();
    });

    it('reads "Nothing owed" when the client owes nothing', () => {
      mockReceivables([]);
      renderPage();

      expect(screen.getByText('Nothing owed')).toBeInTheDocument();
    });

    it('is computed from the unfiltered receivables, so the work-list filters never change it', () => {
      renderPage();
      fireEvent.click(within(workSection()).getByRole('button', { name: 'Paid' }));

      expect(screen.getAllByTestId('owed-now-amount').map((el) => el.textContent)).toEqual(['$1,300', '₪4,200']);
      expect(useIncomeQueries.useReceivables).toHaveBeenLastCalledWith({ clientId: 'client-1' });
    });
  });

  describe('Work and billing (question 1)', () => {
    it('shows date, title, amount and status on each row', () => {
      renderPage();

      const row = rowOf(workSection(), 'Design sprint');
      expect(row).toHaveTextContent(formatDate('2026-10-01', 'en-US'));
      expect(row).toHaveTextContent('$1,000');
      expect(row).toHaveTextContent('Unpaid');
      expect(row).toHaveTextContent('3d overdue');
    });

    it('shows the remaining amount on a partially paid row only', () => {
      renderPage();

      const partial = rowOf(workSection(), 'Homepage');
      expect(partial).toHaveTextContent('Partial (40%)');
      expect(within(partial).getByText(/^Remaining/)).toHaveTextContent('Remaining: $300');
      expect(partial).toHaveTextContent('Due in 9d');

      expect(within(rowOf(workSection(), 'Design sprint')).queryByText(/^Remaining/)).toBeNull();
    });

    it('shows the project as a link while projects is on, and nothing for an entry without one', () => {
      renderPage();

      const tag = within(rowOf(workSection(), 'Homepage')).getByText('Mobile App');
      expect(tag.tagName).toBe('A');
      expect(rowOf(workSection(), 'Logo').querySelector('.project-tag')).toBeNull();
    });

    it('keeps the project as plain text while projects is off (MUT-16)', () => {
      featureFlags.projects = false;
      renderPage();

      const tag = within(rowOf(workSection(), 'Homepage')).getByText('Mobile App');
      expect(tag.tagName).not.toBe('A');
    });

    it('labels an entry saved without a title', () => {
      renderPage();
      expect(within(workSection()).getByText('Untitled')).toBeInTheDocument();
    });

    it('opens the income drawer for the clicked row', () => {
      renderPage();
      fireEvent.click(rowOf(workSection(), 'Homepage'));
      expect(mockOpenIncomeDrawer).toHaveBeenCalledWith({ mode: 'edit', transactionId: 'tx-partial' });
    });

    it('passes date range, status and search to the query as one filter object', () => {
      renderPage();
      expect(useIncomeSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ clientId: 'client-1', status: undefined, search: undefined })
      );

      fireEvent.click(within(workSection()).getByRole('button', { name: 'Unpaid' }));

      expect(useIncomeSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ clientId: 'client-1', status: 'unpaid' })
      );
    });

    it('offers one primary action, Add income for this client, when the client has no work', () => {
      mockWork(() => []);
      renderPage();

      const section = workSection();
      expect(within(section).getByText('No work recorded for this client yet')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Add income' })).toHaveLength(1);
      expect(within(section).queryByRole('button', { name: 'Unpaid' })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Add income' }));
      expect(mockOpenIncomeDrawer).toHaveBeenCalledWith({ mode: 'create', defaultClientId: 'client-1' });
    });

    it('says nothing matches, with Clear filters and no add action, when filters hide every row', () => {
      mockWork((filters) => (filters.status === 'overdue' ? [] : workRows));
      renderPage();

      fireEvent.click(within(workSection()).getByRole('button', { name: 'Overdue' }));

      const section = workSection();
      expect(within(section).getByText('No entries match these filters')).toBeInTheDocument();
      expect(within(section).queryByText('No work recorded for this client yet')).toBeNull();

      fireEvent.click(within(section).getByRole('button', { name: 'Clear filters' }));
      expect(useIncomeSpy).toHaveBeenLastCalledWith(expect.objectContaining({ status: undefined }));
      expect(within(workSection()).getByText('Homepage')).toBeInTheDocument();
    });

    // MUT-6: Record payment is a primary row button, gated by RecordPaymentButton
    it('offers Record payment on unpaid and partial rows only, showing the remaining balance', () => {
      renderPage();

      const section = workSection();
      expect(within(section).getAllByRole('button', { name: /record payment/i })).toHaveLength(3);
      expect(within(rowOf(section, 'Logo')).queryByRole('button', { name: /record payment/i })).toBeNull();
      expect(within(rowOf(section, 'Homepage')).getByRole('button', { name: /record payment/i })).toHaveTextContent(
        '$300'
      );
    });

    it('opens the payment drawer, not the row, from Record payment', () => {
      renderPage();

      fireEvent.click(within(rowOf(workSection(), 'Homepage')).getByRole('button', { name: /record payment/i }));

      expect(mockOpenPartialPaymentDrawer).toHaveBeenCalledWith({ transactionId: 'tx-partial' });
      expect(mockOpenIncomeDrawer).not.toHaveBeenCalled();
    });

    it('offers Mark paid in the row menu of a receivable, not of a paid entry', () => {
      renderPage();

      fireEvent.click(within(rowOf(workSection(), 'Logo')).getByLabelText('Actions'));
      expect(screen.queryByText('Mark Paid')).toBeNull();
      fireEvent.keyDown(document, { key: 'Escape' });

      fireEvent.click(within(rowOf(workSection(), 'Homepage')).getByLabelText('Actions'));
      fireEvent.click(screen.getByText('Mark Paid'));
      expect(mockMarkPaid).toHaveBeenCalledWith('tx-partial');
    });
  });

  describe('Payments (question 3)', () => {
    it('lists each payment with date, amount, what it was for and notes', () => {
      renderPage();

      const row = rowOf(paymentsSection(), 'wire');
      expect(row).toHaveTextContent(formatDate('2026-10-05', 'en-US'));
      expect(row).toHaveTextContent('$200');
      expect(row).toHaveTextContent('Homepage');
    });

    it('fetches the full history, not the work-list period', () => {
      renderPage();
      expect(useQueries.usePaymentsByClient).toHaveBeenCalledWith('client-1');
    });

    it('opens a recorded payment in the payment drawer for editing', () => {
      renderPage();
      fireEvent.click(rowOf(paymentsSection(), 'wire'));
      expect(mockEditPaymentRecord).toHaveBeenCalledWith({ transactionId: 'tx-partial', paymentRecordId: 'pay-1' });
    });

    it('marks a payment saved on the entry itself and opens that entry', () => {
      renderPage();

      const row = rowOf(paymentsSection(), 'Recorded on the entry');
      expect(row).toHaveTextContent('Logo');
      fireEvent.click(row);

      expect(mockOpenIncomeDrawer).toHaveBeenCalledWith({ mode: 'edit', transactionId: 'tx-paid' });
      expect(mockEditPaymentRecord).not.toHaveBeenCalled();
    });

    it('opens the income entry behind a recorded payment from its row menu', () => {
      renderPage();

      fireEvent.click(within(rowOf(paymentsSection(), 'wire')).getByLabelText('Actions'));
      fireEvent.click(screen.getByText('Open income entry'));

      expect(mockOpenIncomeDrawer).toHaveBeenCalledWith({ mode: 'edit', transactionId: 'tx-partial' });
    });

    it('translates the note the v18 migration wrote', () => {
      mockPayments([{ ...payments[0], notes: MIGRATED_PAYMENT_NOTE }]);
      renderPage();

      expect(within(paymentsSection()).getByText('Carried over from the old total')).toBeInTheDocument();
    });

    it('says so when no payment has been recorded', () => {
      mockPayments([]);
      renderPage();

      expect(within(paymentsSection()).getByText('No payments recorded yet')).toBeInTheDocument();
    });
  });

  describe('Advanced-feature entry points (MUT-13, MUT-16)', () => {
    it('offers no invoice actions while invoices is off', () => {
      renderPage();
      fireEvent.click(within(rowOf(workSection(), 'Design sprint')).getByLabelText('Actions'));
      expect(screen.queryByText('Generate invoice')).toBeNull();
      expect(screen.queryByText('View invoice')).toBeNull();
    });

    it('offers Generate invoice on an entry without a document when invoices is on', () => {
      featureFlags.invoices = true;
      renderPage();

      fireEvent.click(within(rowOf(workSection(), 'Design sprint')).getByLabelText('Actions'));
      fireEvent.click(screen.getByText('Generate invoice'));

      expect(mockOpenDocumentDrawer).toHaveBeenCalledWith({
        mode: 'create',
        defaultType: 'invoice',
        defaultClientId: 'client-1',
        linkTransactionId: 'tx-overdue',
      });
    });

    it('offers View invoice on an entry linked to a document when invoices is on', () => {
      featureFlags.invoices = true;
      renderPage();

      fireEvent.click(within(rowOf(workSection(), 'Logo')).getByLabelText('Actions'));
      fireEvent.click(screen.getByText('View invoice'));

      expect(mockNavigate).toHaveBeenCalledWith({ to: '/documents/$documentId', params: { documentId: 'doc-9' } });
    });

    it('shows no retainers card while retainers is off', () => {
      renderPage();
      expect(screen.queryByTestId('client-retainers-card')).toBeNull();
    });

    it('shows the retainers card with its entry points when retainers is on', () => {
      featureFlags.retainers = true;
      renderPage();

      const card = screen.getByTestId('client-retainers-card');
      expect(card).toHaveTextContent('clients.detail.retainers.empty');
      fireEvent.click(within(card).getByText('clients.detail.retainers.new'));
      expect(mockOpenRetainerDrawer).toHaveBeenCalledWith({ mode: 'create', defaultClientId: 'client-1' });
    });

    it('offers + Project for this client while projects is on', () => {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Add Project' }));
      expect(mockOpenProjectDrawer).toHaveBeenCalledWith({ mode: 'create', defaultClientId: 'client-1' });
    });

    it('hides + Project while projects is off', () => {
      featureFlags.projects = false;
      renderPage();
      expect(screen.queryByRole('button', { name: 'Add Project' })).toBeNull();
    });
  });
});
