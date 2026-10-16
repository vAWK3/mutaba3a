import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { db } from '../../db/database';
import {
  transactionRepo,
  clientRepo,
  projectRepo,
  businessProfileRepo,
  settingsRepo,
  paymentRecordRepo,
  PaymentRecordError,
} from '../../db/repository';
import { useToastStore } from '../../lib/toastStore';
import { useSavedFlashStore } from '../../lib/savedFlashStore';
import { useDrawerStore } from '../../lib/stores';
import { IncomeDrawer } from '../drawers/IncomeDrawer';
import { LanguageProvider } from '../../lib/i18n';
import { formatAmount, formatDate, todayISO } from '../../lib/utils';
import { useProfileStore, useOwedScreenStore } from '../../lib/profileStore';
import { SLOW_UNDER_COVERAGE } from '../../test/timeouts';

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function TestWrapper({ children }: { children: ReactNode }) {
  const queryClient = createTestQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>{children}</LanguageProvider>
    </QueryClientProvider>
  );
}

function renderDrawer() {
  return render(
    <TestWrapper>
      <IncomeDrawer />
    </TestWrapper>
  );
}

const CLIENT_PLACEHOLDER = 'Search or create client...';
const PROJECT_PLACEHOLDER = 'Select project...';

const amountInput = () => screen.getByLabelText(/^Amount/) as HTMLInputElement;
const titleInput = () => screen.getByLabelText('What did you do?') as HTMLInputElement;
const moreDetailsToggle = () => screen.getByRole('button', { name: /More details|Fewer details/ });
const saveButton = () => screen.getByRole('button', { name: /save/i });
const statusButton = (name: 'Earned' | 'Invoiced' | 'Received') =>
  screen.getByRole('button', { name: new RegExp(`^${name}`) });

async function openMoreDetails(user: ReturnType<typeof userEvent.setup>) {
  const toggle = await screen.findByRole('button', { name: /More details/ });
  await user.click(toggle);
  await waitFor(() => expect(moreDetailsToggle()).toHaveAttribute('aria-expanded', 'true'));
}

async function openEdit(id: string) {
  useDrawerStore.setState({ incomeDrawer: { isOpen: true, mode: 'edit', transactionId: id } });
  renderDrawer();
  await screen.findByText('Edit Income');
}

describe('IncomeDrawer', () => {
  let testProfileId: string;

  beforeEach(async () => {
    await db.transactions.clear();
    await db.paymentRecords.clear();
    await db.clients.clear();
    await db.projects.clear();
    await db.businessProfiles.clear();
    await db.settings.clear();

    // Create a test profile since IncomeDrawer requires one
    const profile = await businessProfileRepo.create({
      name: 'Test Profile',
      defaultCurrency: 'USD',
    });
    testProfileId = profile.id;

    useDrawerStore.setState({
      incomeDrawer: {
        isOpen: true,
        mode: 'create',
        defaultProfileId: testProfileId,
      },
    });
  });

  afterEach(async () => {
    await db.transactions.clear();
    await db.paymentRecords.clear();
    await db.clients.clear();
    await db.projects.clear();
    await db.businessProfiles.clear();
    await db.settings.clear();
    useDrawerStore.setState({
      incomeDrawer: { isOpen: false, mode: 'create' },
    });
  });

  describe('fast path (MUT-5)', () => {
    it('shows title, amount and client up front, and everything else behind More details', async () => {
      renderDrawer();

      await screen.findByText('New Income');
      expect(titleInput()).toBeInTheDocument();
      expect(amountInput()).toBeInTheDocument();
      expect(screen.getByPlaceholderText(CLIENT_PLACEHOLDER)).toBeInTheDocument();

      const toggle = await screen.findByRole('button', { name: /More details/ });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('group', { name: 'Status' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Currency')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Date')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Due Date')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Business Profile/)).not.toBeInTheDocument();
    });

    it('reveals status, due date, currency, date, project, notes and profile under More details', async () => {
      const user = userEvent.setup();
      await settingsRepo.update({ features: { projects: true } });
      renderDrawer();

      await openMoreDetails(user);

      expect(screen.getByRole('group', { name: 'Status' })).toBeInTheDocument();
      expect(screen.getByLabelText('Due Date')).toBeInTheDocument();
      expect(screen.getByLabelText('Currency')).toBeInTheDocument();
      expect(screen.getByLabelText('Date')).toBeInTheDocument();
      expect(await screen.findByPlaceholderText(PROJECT_PLACEHOLDER)).toBeInTheDocument();
      expect(screen.getByLabelText('Notes')).toBeInTheDocument();
      expect(screen.getByLabelText(/Business Profile/)).toBeInTheDocument();
    });

    it('saves with exactly title, amount and client, filling the rest from defaults', async () => {
      const user = userEvent.setup();
      const client = await clientRepo.create({ name: 'Acme' });
      renderDrawer();

      await user.type(await screen.findByLabelText('What did you do?'), 'Logo redesign');
      await user.type(amountInput(), '1,200');
      const clientInput = screen.getByPlaceholderText(CLIENT_PLACEHOLDER);
      await user.click(clientInput);
      await user.type(clientInput, 'Acm');
      await user.keyboard('{Enter}');
      await waitFor(() => expect(clientInput).toHaveValue('Acme'));

      await user.click(saveButton());

      await waitFor(async () => {
        const transactions = await transactionRepo.list({});
        expect(transactions).toHaveLength(1);
        const [tx] = transactions;
        expect(tx).toMatchObject({
          kind: 'income',
          status: 'unpaid',
          title: 'Logo redesign',
          amountMinor: 120000,
          currency: 'USD',
          clientId: client.id,
          profileId: testProfileId,
        });
        expect(tx.occurredAt.slice(0, 10)).toBe(new Date(todayISO()).toISOString().slice(0, 10));
        expect(tx.projectId).toBeUndefined();
      });
      expect(useDrawerStore.getState().incomeDrawer.isOpen).toBe(false);
    });

    it('MUT-81: captures the saved entry for the after-save flash, with the client name resolved at save time', async () => {
      const user = userEvent.setup();
      const client = await clientRepo.create({ name: 'Acme' });
      useSavedFlashStore.getState().clear();
      renderDrawer();

      await user.type(await screen.findByLabelText('What did you do?'), 'Logo redesign');
      await user.type(amountInput(), '1,200');
      const clientInput = screen.getByPlaceholderText(CLIENT_PLACEHOLDER);
      await user.click(clientInput);
      await user.type(clientInput, 'Acm');
      await user.keyboard('{Enter}');
      await waitFor(() => expect(clientInput).toHaveValue('Acme'));

      await user.click(saveButton());

      await waitFor(async () => {
        const [tx] = await transactionRepo.list({});
        const pending = useSavedFlashStore.getState().pending;
        expect(pending).toMatchObject({
          kind: 'income',
          ids: [tx.id],
          clientId: client.id,
          clientName: 'Acme',
          profileId: testProfileId,
        });
      });
    });

    it('names the defaults it applies: status, currency and today', async () => {
      renderDrawer();

      const summary = await screen.findByTestId('income-defaults');
      await waitFor(() => {
        expect(summary).toHaveTextContent('Earned');
        expect(summary).toHaveTextContent('USD');
        expect(summary).toHaveTextContent(formatDate(`${todayISO()}T00:00:00`, 'en-US'));
      });
    });

    it('names the profile in the defaults when there is more than one', async () => {
      await businessProfileRepo.create({ name: 'Second Studio', defaultCurrency: 'ILS' });
      renderDrawer();

      await waitFor(() => expect(screen.getByTestId('income-defaults')).toHaveTextContent('Test Profile'));
    });

    it('starts in the profile currency and saves it', async () => {
      const user = userEvent.setup();
      const ilsProfile = await businessProfileRepo.create({ name: 'Shekel Studio', defaultCurrency: 'ILS' });
      useDrawerStore.setState({
        incomeDrawer: { isOpen: true, mode: 'create', defaultProfileId: ilsProfile.id },
      });
      renderDrawer();

      await waitFor(() => expect(screen.getByTestId('income-amount-group')).toHaveTextContent('ILS'));
      await user.type(amountInput(), '500');
      await user.click(saveButton());

      await waitFor(async () => {
        const [tx] = await transactionRepo.list({});
        expect(tx?.currency).toBe('ILS');
        expect(tx?.profileId).toBe(ilsProfile.id);
      });
    });

    it('moves an untouched currency with the profile, but never a currency the user picked', async () => {
      const user = userEvent.setup();
      const ilsProfile = await businessProfileRepo.create({ name: 'Shekel Studio', defaultCurrency: 'ILS' });
      renderDrawer();
      await openMoreDetails(user);
      const prefix = screen.getByTestId('income-amount-group');

      await waitFor(() => expect(screen.getByRole('option', { name: 'Shekel Studio' })).toBeInTheDocument());
      await user.selectOptions(screen.getByLabelText(/Business Profile/), ilsProfile.id);
      await waitFor(() => expect(prefix).toHaveTextContent('ILS'));

      await user.selectOptions(screen.getByLabelText('Currency'), 'EUR');
      await user.selectOptions(screen.getByLabelText(/Business Profile/), testProfileId);
      await waitFor(() => expect(prefix).toHaveTextContent('EUR'));
    });

    it('offers EUR and saves it', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openMoreDetails(user);

      await user.selectOptions(screen.getByLabelText('Currency'), 'EUR');
      await user.type(amountInput(), '75');
      await user.click(saveButton());

      await waitFor(async () => {
        const [tx] = await transactionRepo.list({});
        expect(tx?.currency).toBe('EUR');
      });
    });

    it('keeps the amount left-to-right with the currency in front, in any language', async () => {
      renderDrawer();
      const group = await screen.findByTestId('income-amount-group');
      expect(group).toHaveAttribute('dir', 'ltr');
      expect(group.firstElementChild).toHaveTextContent('USD');
    });

    it('prefills the client when opened from a client profile', async () => {
      const client = await clientRepo.create({ name: 'Prefilled Client' });
      useDrawerStore.setState({
        incomeDrawer: { isOpen: true, mode: 'create', defaultProfileId: testProfileId, defaultClientId: client.id },
      });
      renderDrawer();

      await waitFor(() => expect(screen.getByPlaceholderText(CLIENT_PLACEHOLDER)).toHaveValue('Prefilled Client'));
    });

    it('leaves the client empty when opened without one (sidebar, + Add)', async () => {
      await clientRepo.create({ name: 'Some Client' });
      renderDrawer();

      const clientInput = await screen.findByPlaceholderText(CLIENT_PLACEHOLDER);
      // the clients query has answered once its option is listed
      await userEvent.setup().click(clientInput);
      expect(await screen.findByRole('option', { name: 'Some Client' })).toBeInTheDocument();
      expect(clientInput).toHaveValue('');
    });
  });

  // MUT-92 F1: a new entry for a client starts in the currency that client
  // last paid in, not the profile's, until the user picks one.
  describe('currency follows the client (MUT-92)', () => {
    const prefix = () => screen.getByTestId('income-amount-group');

    async function income(clientId: string, currency: 'USD' | 'ILS' | 'EUR', occurredAt: string, kind: 'income' | 'expense' = 'income') {
      return transactionRepo.create({
        kind,
        status: 'paid',
        profileId: testProfileId,
        clientId,
        amountMinor: 10000,
        currency,
        occurredAt,
      });
    }

    function openFor(clientId: string) {
      useDrawerStore.setState({
        incomeDrawer: { isOpen: true, mode: 'create', defaultProfileId: testProfileId, defaultClientId: clientId },
      });
      renderDrawer();
    }

    async function pickClient(user: ReturnType<typeof userEvent.setup>, name: string) {
      await user.click(await screen.findByPlaceholderText(CLIENT_PLACEHOLDER));
      await user.click(await screen.findByRole('option', { name }));
    }

    it('opens in the currency of the client\'s newest income, and saves it', async () => {
      const user = userEvent.setup();
      const client = await clientRepo.create({ name: 'Shekel Client' });
      await income(client.id, 'USD', '2026-08-01');
      await income(client.id, 'ILS', '2026-09-01');
      openFor(client.id);

      await waitFor(() => expect(prefix()).toHaveTextContent('ILS'));
      await user.type(amountInput(), '500');
      await user.click(saveButton());

      await waitFor(async () => {
        const created = (await transactionRepo.list({})).filter((tx) => tx.amountMinor === 50000);
        expect(created).toHaveLength(1);
        expect(created[0].currency).toBe('ILS');
      });
    });

    it('keeps the profile currency for a client with no income yet', async () => {
      const client = await clientRepo.create({ name: 'New Client' });
      openFor(client.id);

      await waitFor(() => expect(screen.getByPlaceholderText(CLIENT_PLACEHOLDER)).toHaveValue('New Client'));
      expect(prefix()).toHaveTextContent('USD');
    });

    it('switches when the client is picked in the drawer', async () => {
      const user = userEvent.setup();
      const client = await clientRepo.create({ name: 'Shekel Client' });
      await income(client.id, 'ILS', '2026-09-01');
      renderDrawer();
      await waitFor(() => expect(prefix()).toHaveTextContent('USD'));

      await pickClient(user, 'Shekel Client');

      await waitFor(() => expect(prefix()).toHaveTextContent('ILS'));
    });

    it('never overrides a currency the user picked', async () => {
      const user = userEvent.setup();
      const client = await clientRepo.create({ name: 'Shekel Client' });
      await income(client.id, 'ILS', '2026-09-01');
      renderDrawer();
      await openMoreDetails(user);

      await user.selectOptions(screen.getByLabelText('Currency'), 'EUR');
      await pickClient(user, 'Shekel Client');

      // give the client's history time to arrive before asserting it changed nothing
      await waitFor(() => expect(screen.getByPlaceholderText(CLIENT_PLACEHOLDER)).toHaveValue('Shekel Client'));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(prefix()).toHaveTextContent('EUR');
    });

    it('goes by date, skips deleted entries and expenses, and counts archived ones', async () => {
      const client = await clientRepo.create({ name: 'Mixed Client' });
      const archived = await income(client.id, 'ILS', '2026-09-01');
      await transactionRepo.archive(archived.id);
      // Recorded later, but dated earlier: the date decides
      await income(client.id, 'USD', '2026-08-01');
      const deleted = await income(client.id, 'EUR', '2026-09-20');
      await transactionRepo.softDelete(deleted.id);
      await income(client.id, 'EUR', '2026-09-25', 'expense');
      openFor(client.id);

      await waitFor(() => expect(prefix()).toHaveTextContent('ILS'));
    });

    it('leaves an edited entry in its own currency', async () => {
      const client = await clientRepo.create({ name: 'Shekel Client' });
      await income(client.id, 'ILS', '2026-09-01');
      const older = await income(client.id, 'EUR', '2026-08-01');

      await openEdit(older.id);

      await waitFor(() => expect(amountInput().value).toBe('100'));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(prefix()).toHaveTextContent('EUR');
    });

    it('leaves a duplicate in its source\'s currency', async () => {
      const client = await clientRepo.create({ name: 'Shekel Client' });
      await income(client.id, 'ILS', '2026-09-01');
      const source = await income(client.id, 'EUR', '2026-08-01');
      useDrawerStore.setState({ incomeDrawer: { isOpen: true, mode: 'create', duplicateFromId: source.id } });
      renderDrawer();

      await waitFor(() => expect(amountInput().value).toBe('100'));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(prefix()).toHaveTextContent('EUR');
    });
  });

  describe('amount validation', () => {
    it('shows a field error, not an exception, for a title with no amount', async () => {
      const user = userEvent.setup();
      renderDrawer();

      await user.type(await screen.findByLabelText('What did you do?'), 'Logo redesign');
      await user.click(saveButton());

      expect(await screen.findByText('Amount is required')).toBeInTheDocument();
      expect(await transactionRepo.list({})).toHaveLength(0);
      expect(useDrawerStore.getState().incomeDrawer.isOpen).toBe(true);
    });

    it('refuses an ambiguous amount instead of guessing', async () => {
      const user = userEvent.setup();
      renderDrawer();

      await user.type(await screen.findByLabelText(/^Amount/), '12,5');
      await user.click(saveButton());

      expect(await screen.findByText('Enter an amount like 1200 or 1,200.50')).toBeInTheDocument();
      expect(await transactionRepo.list({})).toHaveLength(0);
    });

    it('refuses a zero amount', async () => {
      const user = userEvent.setup();
      renderDrawer();

      await user.type(await screen.findByLabelText(/^Amount/), '0');
      await user.click(saveButton());

      expect(await screen.findByText('Amount must be more than zero')).toBeInTheDocument();
    });

    it('refuses an amount whose symbol names another currency, and shows the currency', async () => {
      const user = userEvent.setup();
      renderDrawer();

      await user.type(await screen.findByLabelText(/^Amount/), '\u20AC100');
      await user.click(saveButton());

      expect(await screen.findByText('The amount is in EUR, but this entry is in USD')).toBeInTheDocument();
      expect(moreDetailsToggle()).toHaveAttribute('aria-expanded', 'true');
      expect(await transactionRepo.list({})).toHaveLength(0);
    });

    it('saves once the currency is switched to the one the amount names', async () => {
      const user = userEvent.setup();
      renderDrawer();

      await user.type(await screen.findByLabelText(/^Amount/), '\u20AC100');
      await user.click(saveButton());
      await screen.findByText('The amount is in EUR, but this entry is in USD');

      await user.selectOptions(screen.getByLabelText('Currency'), 'EUR');
      expect(screen.queryByText('The amount is in EUR, but this entry is in USD')).not.toBeInTheDocument();
      await user.click(saveButton());

      await waitFor(async () => {
        const [tx] = await transactionRepo.list({});
        expect(tx?.amountMinor).toBe(10000);
        expect(tx?.currency).toBe('EUR');
      });
    });

    it('accepts a symbol or code that matches the entry currency', async () => {
      const user = userEvent.setup();
      renderDrawer();

      await user.type(await screen.findByLabelText(/^Amount/), '$1,200');
      await user.click(saveButton());

      await waitFor(async () => {
        const [tx] = await transactionRepo.list({});
        expect(tx?.amountMinor).toBe(120000);
        expect(tx?.currency).toBe('USD');
      });
    });

    it('reads Arabic-Indic digits and separators', async () => {
      const user = userEvent.setup();
      renderDrawer();

      await user.type(await screen.findByLabelText(/^Amount/), '١٬٢٠٠٫٥٠');
      await user.click(saveButton());

      await waitFor(async () => {
        const [tx] = await transactionRepo.list({});
        expect(tx?.amountMinor).toBe(120050);
      });
    });
  });

  describe('client typed but not picked (MUT-5)', () => {
    it('refuses to save while unpicked text sits in the client box', async () => {
      const user = userEvent.setup();
      await clientRepo.create({ name: 'Acme Corp' });
      renderDrawer();

      await user.type(await screen.findByLabelText(/^Amount/), '100');
      await user.type(screen.getByPlaceholderText(CLIENT_PLACEHOLDER), 'Acm');
      await user.click(saveButton());

      expect(
        await screen.findByText('Pick a client from the list, or press Enter to create it')
      ).toBeInTheDocument();
      expect(await transactionRepo.list({})).toHaveLength(0);
    });

    it('picks a client whose exact name was typed when the box is left', SLOW_UNDER_COVERAGE, async () => {
      const user = userEvent.setup();
      const client = await clientRepo.create({ name: 'Acme Corp' });
      renderDrawer();

      await user.type(await screen.findByLabelText(/^Amount/), '100');
      await user.type(screen.getByPlaceholderText(CLIENT_PLACEHOLDER), 'acme corp');
      await user.tab();
      await user.click(saveButton());

      await waitFor(async () => {
        const [tx] = await transactionRepo.list({});
        expect(tx?.clientId).toBe(client.id);
      });
    });

    it('closes only the client list on Escape, not the drawer', async () => {
      const user = userEvent.setup();
      await clientRepo.create({ name: 'Acme Corp' });
      renderDrawer();

      const clientInput = await screen.findByPlaceholderText(CLIENT_PLACEHOLDER);
      await user.type(clientInput, 'Ac');
      expect(await screen.findByRole('listbox')).toBeInTheDocument();
      await user.keyboard('{Escape}');

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(useDrawerStore.getState().incomeDrawer.isOpen).toBe(true);
    });
  });

  describe('keyboard', () => {
    it('starts in the title, then tabs to amount and client', async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => expect(titleInput()).toHaveFocus());
      await user.tab();
      expect(amountInput()).toHaveFocus();
      await user.tab();
      expect(screen.getByPlaceholderText(CLIENT_PLACEHOLDER)).toHaveFocus();
    });
  });

  describe('status inside More details', () => {
    it('shows the due date for Earned and Invoiced, and hides it for Received', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openMoreDetails(user);

      await user.click(statusButton('Invoiced'));
      expect(screen.getByLabelText('Due Date')).toBeInTheDocument();

      await user.click(statusButton('Received'));
      await waitFor(() => expect(screen.queryByLabelText('Due Date')).not.toBeInTheDocument());
    });

    it('creates a paid entry when Received is chosen', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openMoreDetails(user);

      await user.click(statusButton('Received'));
      await user.type(amountInput(), '100');
      await user.click(saveButton());

      await waitFor(async () => {
        const transactions = await transactionRepo.list({});
        expect(transactions).toHaveLength(1);
        expect(transactions[0].amountMinor).toBe(10000);
        expect(transactions[0].status).toBe('paid');
        expect(transactions[0].paidAt).toBeDefined();
        expect(transactions[0].receivedAmountMinor).toBe(10000);
      });

      // MUT-60 (TD-029): a Received create used to write these fields straight
      // onto the Transaction with no PaymentRecord. It must be record-backed
      // now, like any Mark-paid entry, so the client's Payments section and a
      // future statement export can both see it.
      const [transaction] = await transactionRepo.list({});
      const records = await paymentRecordRepo.listByTransaction(transaction.id);
      expect(records).toHaveLength(1);
      expect(records[0].amountMinor).toBe(10000);
      expect(records[0].paidAt).toBe(transaction.paidAt);
    });

    it.each(['Earned', 'Invoiced'] as const)('creates an unpaid entry when %s is chosen', async (status) => {
      const user = userEvent.setup();
      renderDrawer();
      await openMoreDetails(user);

      await user.click(statusButton(status));
      await user.type(amountInput(), '200');
      await user.click(saveButton());

      await waitFor(async () => {
        const transactions = await transactionRepo.list({});
        expect(transactions).toHaveLength(1);
        expect(transactions[0].status).toBe('unpaid');
      });
    });

    it('reopens More details when a field inside it is invalid', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openMoreDetails(user);

      await user.clear(screen.getByLabelText('Date'));
      await user.click(moreDetailsToggle()); // collapse again
      await user.type(amountInput(), '100');
      await user.click(saveButton());

      await waitFor(() => expect(moreDetailsToggle()).toHaveAttribute('aria-expanded', 'true'));
      expect(screen.getByText('Date is required')).toBeInTheDocument();
      expect(await transactionRepo.list({})).toHaveLength(0);
    });
  });

  describe('opened from All businesses (MUT-89, AC4)', () => {
    let secondProfileId: string;

    beforeEach(async () => {
      const second = await businessProfileRepo.create({ name: 'Second Business', defaultCurrency: 'USD' });
      secondProfileId = second.id;
      useProfileStore.setState({ activeProfileId: testProfileId, allBusinesses: true });
      useOwedScreenStore.setState({ onOwedScreen: true });
    });

    afterEach(() => {
      useProfileStore.setState({ activeProfileId: '', allBusinesses: false });
      useOwedScreenStore.setState({ onOwedScreen: false });
    });

    it('asks which business up front, with none chosen, and will not save without one', async () => {
      const user = userEvent.setup();
      useDrawerStore.setState({ incomeDrawer: { isOpen: true, mode: 'create' } });
      renderDrawer();

      const businessSelect = await screen.findByLabelText(/Business Profile/);
      expect(businessSelect).toHaveValue('');
      expect(moreDetailsToggle()).toHaveAttribute('aria-expanded', 'false');

      await user.type(amountInput(), '100');
      await user.click(saveButton());
      expect(await screen.findByText('Profile is required')).toBeInTheDocument();
      expect(await transactionRepo.list({})).toHaveLength(0);
    });

    it('takes the business the Add menu asked for', async () => {
      useDrawerStore.setState({ incomeDrawer: { isOpen: true, mode: 'create', defaultProfileId: secondProfileId } });
      renderDrawer();

      await screen.findByText('New Income');
      expect(screen.queryByLabelText(/Business Profile/)).not.toBeInTheDocument();
    });

    it('asks for the business before the client, so a new client is filed in the business chosen (review D2)', async () => {
      useDrawerStore.setState({ incomeDrawer: { isOpen: true, mode: 'create' } });
      renderDrawer();

      const businessSelect = await screen.findByLabelText(/Business Profile/);
      const clientInput = screen.getByPlaceholderText(CLIENT_PLACEHOLDER);
      expect(businessSelect.compareDocumentPosition(clientInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('offers to create a new client only once a business is chosen, so it is filed there (review)', async () => {
      const user = userEvent.setup();
      useDrawerStore.setState({ incomeDrawer: { isOpen: true, mode: 'create' } });
      renderDrawer();

      const clientInput = await screen.findByPlaceholderText(CLIENT_PLACEHOLDER);
      await user.type(clientInput, 'Brand New Co');
      expect(screen.queryByRole('option', { name: /Brand New Co/ })).not.toBeInTheDocument();
      expect(screen.getByText('Choose the business first to add a new client.')).toBeInTheDocument();

      await user.selectOptions(screen.getByLabelText(/Business Profile/), secondProfileId);
      await user.click(clientInput);
      expect(await screen.findByRole('option', { name: /Brand New Co/ })).toBeInTheDocument();
      expect(screen.queryByText('Choose the business first to add a new client.')).not.toBeInTheDocument();
    });

    it('says to choose the business first, not to press Enter, when an unknown client blocks the save (review)', async () => {
      const user = userEvent.setup();
      useDrawerStore.setState({ incomeDrawer: { isOpen: true, mode: 'create' } });
      renderDrawer();

      await user.type(await screen.findByPlaceholderText(CLIENT_PLACEHOLDER), 'Brand New Co');
      await user.type(amountInput(), '100');
      await user.click(saveButton());

      expect(await screen.findByText('Choose the business first to add a new client.')).toHaveClass('form-error');
      expect(screen.queryByText('Pick a client from the list, or press Enter to create it')).not.toBeInTheDocument();
      expect(screen.getAllByText('Choose the business first to add a new client.')).toHaveLength(1);
    });

    it('keeps the project field closed until a business is chosen, so a new project is filed there too (review)', async () => {
      const user = userEvent.setup();
      await settingsRepo.update({ features: { projects: true } });
      useDrawerStore.setState({ incomeDrawer: { isOpen: true, mode: 'create' } });
      renderDrawer();

      await openMoreDetails(user);
      expect(await screen.findByPlaceholderText(PROJECT_PLACEHOLDER)).toBeDisabled();

      await user.selectOptions(screen.getByLabelText(/Business Profile/), secondProfileId);
      expect(screen.getByPlaceholderText(PROJECT_PLACEHOLDER)).toBeEnabled();
    });

    it('still asks for the business when opened from a client, whatever business the client is in', async () => {
      const client = await clientRepo.create({ name: 'Gamma School', profileId: secondProfileId });
      useDrawerStore.setState({ incomeDrawer: { isOpen: true, mode: 'create', defaultClientId: client.id } });
      renderDrawer();

      expect(await screen.findByLabelText(/Business Profile/)).toHaveValue('');
    });

    it('keeps the business of the entry it duplicates', async () => {
      const user = userEvent.setup();
      const source = await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        currency: 'USD',
        amountMinor: 1500,
        occurredAt: todayISO(),
        title: 'Workshop',
        profileId: secondProfileId,
      });
      useDrawerStore.setState({ incomeDrawer: { isOpen: true, mode: 'create', duplicateFromId: source.id } });
      renderDrawer();

      await waitFor(() => expect(titleInput()).toHaveValue('Workshop'));
      await user.click(saveButton());

      await waitFor(async () => expect(await transactionRepo.list({})).toHaveLength(2));
      const copies = (await transactionRepo.list({})).filter((tx) => tx.id !== source.id);
      expect(copies[0].profileId).toBe(secondProfileId);
    });

    it('works in the working business when opened away from Home and Clients', async () => {
      const user = userEvent.setup();
      useOwedScreenStore.setState({ onOwedScreen: false });
      useDrawerStore.setState({ incomeDrawer: { isOpen: true, mode: 'create' } });
      renderDrawer();

      await screen.findByText('New Income');
      expect(screen.queryByLabelText(/Business Profile/)).not.toBeInTheDocument();
      await user.type(amountInput(), '100');
      await user.click(saveButton());

      await waitFor(async () => expect(await transactionRepo.list({})).toHaveLength(1));
      expect((await transactionRepo.list({}))[0].profileId).toBe(testProfileId);
    });
  });

  it('asks for the profile up front when none can be worked out', async () => {
    const user = userEvent.setup();
    await db.businessProfiles.clear();
    useDrawerStore.setState({ incomeDrawer: { isOpen: true, mode: 'create' } });
    renderDrawer();

    const profileSelect = await screen.findByLabelText(/Business Profile/);
    expect(moreDetailsToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(profileSelect).toBeInTheDocument();

    await user.type(amountInput(), '100');
    await user.click(saveButton());
    expect(await screen.findByText('Profile is required')).toBeInTheDocument();
  });

  it('should close drawer when cancel is clicked', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.click(await screen.findByRole('button', { name: /cancel/i }));

    expect(useDrawerStore.getState().incomeDrawer.isOpen).toBe(false);
  });

  it('should show clients in dropdown when available', async () => {
    const user = userEvent.setup();
    await clientRepo.create({ name: 'Test Client Inc' });
    renderDrawer();

    // The typeahead only renders its options while open (EntityTypeahead)
    const clientInput = await screen.findByPlaceholderText(CLIENT_PLACEHOLDER);
    await user.click(clientInput);

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Test Client Inc' })).toBeInTheDocument();
    });
  });

  it('should show projects filtered by selected client', async () => {
    const user = userEvent.setup();
    // The project field renders only while the Projects area is on (MUT-16)
    await settingsRepo.update({ features: { projects: true } });
    const clientA = await clientRepo.create({ name: 'Client A' });
    const clientB = await clientRepo.create({ name: 'Client B' });
    await projectRepo.create({ name: 'Project for A', clientId: clientA.id, profileId: testProfileId });
    await projectRepo.create({ name: 'Project for B', clientId: clientB.id, profileId: testProfileId });
    renderDrawer();

    // Select Client A in the client typeahead
    const clientInput = await screen.findByPlaceholderText(CLIENT_PLACEHOLDER);
    await user.click(clientInput);
    await user.click(await screen.findByRole('option', { name: 'Client A' }));

    // Open the project typeahead under More details: only Client A's project is listed
    await openMoreDetails(user);
    await user.click(await screen.findByPlaceholderText(PROJECT_PLACEHOLDER));

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Project for A' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Project for B' })).not.toBeInTheDocument();
    });
  });

  describe('edit mode', () => {
    it('loads an existing entry', async () => {
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        profileId: testProfileId,
        amountMinor: 25000, // $250
        currency: 'USD',
        occurredAt: '2024-03-15',
        title: 'Test payment',
      });

      await openEdit(tx.id);

      await waitFor(() => {
        expect(amountInput().value).toBe('250');
        expect(titleInput().value).toBe('Test payment');
      });
    });

    it('MUT-81: captures an edit for the after-save flash too', async () => {
      const client = await clientRepo.create({ name: 'Shoreline Studio' });
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        profileId: testProfileId,
        clientId: client.id,
        amountMinor: 25000,
        currency: 'USD',
        occurredAt: '2024-03-15',
        title: 'Test payment',
      });
      useSavedFlashStore.getState().clear();
      const user = userEvent.setup();

      await openEdit(tx.id);
      await waitFor(() => expect(titleInput().value).toBe('Test payment'));
      await user.click(saveButton());

      await waitFor(() => {
        expect(useSavedFlashStore.getState().pending).toMatchObject({
          kind: 'income',
          ids: [tx.id],
          clientId: client.id,
          clientName: 'Shoreline Studio',
          profileId: testProfileId,
        });
      });
    });

    it('opens More details when the entry has notes', async () => {
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        profileId: testProfileId,
        amountMinor: 25000,
        currency: 'USD',
        occurredAt: '2024-03-15',
        notes: 'Phase one of three',
      });

      await openEdit(tx.id);

      await waitFor(() => expect(moreDetailsToggle()).toHaveAttribute('aria-expanded', 'true'));
      expect(screen.getByLabelText('Notes')).toHaveValue('Phase one of three');
    });

    it('keeps More details collapsed for an entry with only the core fields', async () => {
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        profileId: testProfileId,
        amountMinor: 25000,
        currency: 'USD',
        occurredAt: '2024-03-15',
        title: 'Plain entry',
      });

      // a second profile puts the profile name in the defaults line, which proves
      // the profiles (the expansion rule's input) have loaded before asserting
      await businessProfileRepo.create({ name: 'Second Studio', defaultCurrency: 'ILS' });
      await openEdit(tx.id);

      await waitFor(() => expect(titleInput().value).toBe('Plain entry'));
      await waitFor(() => expect(screen.getByTestId('income-defaults')).toHaveTextContent('Test Profile'));
      expect(moreDetailsToggle()).toHaveAttribute('aria-expanded', 'false');
    });

    it('should clear paidAt and receivedAmountMinor when changing from received to invoiced', async () => {
      const user = userEvent.setup();
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        profileId: testProfileId,
        amountMinor: 50000, // $500
        currency: 'USD',
        occurredAt: '2024-03-15T10:00:00Z',
        paidAt: '2024-03-15T10:00:00Z',
        receivedAmountMinor: 50000,
        title: 'Paid invoice',
      });

      await openEdit(tx.id);
      await openMoreDetails(user);

      // Should show "Received" as active since status is 'paid'
      await waitFor(() => expect(statusButton('Received')).toHaveClass('active'));

      await user.click(statusButton('Invoiced'));
      await waitFor(() => expect(statusButton('Invoiced')).toHaveClass('active'));

      await user.click(saveButton());

      // The drawer writes `undefined`, and Dexie deletes keys whose value is undefined,
      // so the fields are absent - not null - after the update.
      await waitFor(async () => {
        const updatedTx = await transactionRepo.get(tx.id);
        expect(updatedTx?.status).toBe('unpaid');
        expect(updatedTx?.paidAt).toBeUndefined();
        expect(updatedTx?.receivedAmountMinor).toBeUndefined();
      });
    });
  });

  describe('payment data on edit (MUT-5)', () => {
    it('offers no Edit Payment on a new entry, or on one with no payments', async () => {
      renderDrawer();
      await screen.findByText('New Income');
      expect(screen.queryByRole('button', { name: 'Edit Payment' })).not.toBeInTheDocument();
      cleanup();

      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        profileId: testProfileId,
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-03-15',
        title: 'Unpaid job',
      });
      await openEdit(tx.id);
      await waitFor(() => expect(titleInput().value).toBe('Unpaid job'));
      expect(screen.queryByRole('button', { name: 'Edit Payment' })).not.toBeInTheDocument();
    });

    it('keeps the payment date when a paid entry is retitled', async () => {
      const user = userEvent.setup();
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        profileId: testProfileId,
        amountMinor: 50000,
        currency: 'USD',
        occurredAt: '2024-03-15T10:00:00Z',
        paidAt: '2024-03-15T10:00:00Z',
        receivedAmountMinor: 50000,
        title: 'Paid invoice',
      });

      await openEdit(tx.id);
      await waitFor(() => expect(titleInput().value).toBe('Paid invoice'));
      await user.clear(titleInput());
      await user.type(titleInput(), 'Paid invoice, renamed');
      await user.click(saveButton());

      await waitFor(async () => {
        const updated = await transactionRepo.get(tx.id);
        expect(updated?.title).toBe('Paid invoice, renamed');
        expect(updated?.paidAt).toBe('2024-03-15T10:00:00Z');
        expect(updated?.status).toBe('paid');
      });
    });

    describe('an entry with recorded payments', () => {
      let txId: string;

      beforeEach(async () => {
        const tx = await transactionRepo.create({
          kind: 'income',
          status: 'unpaid',
          profileId: testProfileId,
          amountMinor: 10000, // $100
          currency: 'USD',
          occurredAt: '2024-03-15',
          title: 'Part-paid job',
        });
        txId = tx.id;
        await paymentRecordRepo.create({ transactionId: txId, amountMinor: 5000, paidAt: '2024-03-20' });
      });

      it('keeps what was received when the entry is retitled', async () => {
        const user = userEvent.setup();
        await openEdit(txId);
        await waitFor(() => expect(titleInput().value).toBe('Part-paid job'));

        await user.type(titleInput(), ' (phase 1)');
        await user.click(saveButton());

        await waitFor(async () => {
          const updated = await transactionRepo.get(txId);
          expect(updated?.title).toBe('Part-paid job (phase 1)');
          expect(updated?.receivedAmountMinor).toBe(5000);
          expect(updated?.status).toBe('unpaid');
        });
      });

      it('shows the status read-only, with a hint about the payments', async () => {
        const user = userEvent.setup();
        await openEdit(txId);
        await openMoreDetails(user);

        await waitFor(() => expect(statusButton('Received')).toBeDisabled());
        expect(statusButton('Earned')).toBeDisabled();
        expect(statusButton('Invoiced')).toBeDisabled();
        // MUT-169: payments are managed from this drawer now, not the client page
        expect(screen.getByText('Payments are recorded for this entry, so its status follows them.')).toBeInTheDocument();
      });

      // MUT-169: fix a payment's date from the entry, without the client page
      describe('Edit payment', () => {
        const editPaymentButton = () => screen.getByRole('button', { name: 'Edit Payment' });

        it('names the last payment and offers Edit Payment up front', async () => {
          await paymentRecordRepo.create({ transactionId: txId, amountMinor: 2000, paidAt: '2024-03-25' });
          await openEdit(txId);

          expect(await screen.findByText('Last payment Mar 25, 2024')).toBeInTheDocument();
          expect(moreDetailsToggle()).toHaveAttribute('aria-expanded', 'false');
          expect(editPaymentButton()).toBeEnabled();
        });

        it('hands over to the payment drawer, to edit a payment', async () => {
          const user = userEvent.setup();
          await openEdit(txId);

          await user.click(await screen.findByRole('button', { name: 'Edit Payment' }));

          expect(useDrawerStore.getState().incomeDrawer.isOpen).toBe(false);
          // A tick later, once this drawer has handed focus back to its trigger
          await waitFor(() =>
            expect(useDrawerStore.getState().partialPaymentDrawer).toMatchObject({
              isOpen: true,
              transactionId: txId,
              intent: 'editPayment',
            })
          );
        });

        it('waits for unsaved changes to be saved, and says so, staying focusable', async () => {
          const user = userEvent.setup();
          await openEdit(txId);
          await waitFor(() => expect(titleInput().value).toBe('Part-paid job'));

          await user.type(titleInput(), ' (phase 1)');

          expect(editPaymentButton()).toHaveAttribute('aria-disabled', 'true');
          expect(editPaymentButton()).not.toBeDisabled();
          expect(editPaymentButton()).toHaveAccessibleDescription('Save your changes to edit the payment');
          await user.click(editPaymentButton());
          expect(useDrawerStore.getState().incomeDrawer.isOpen).toBe(true);
        });

        it('also waits for a client name typed but not picked', async () => {
          const user = userEvent.setup();
          await openEdit(txId);
          await waitFor(() => expect(editPaymentButton()).toHaveAttribute('aria-disabled', 'false'));

          await user.type(screen.getByPlaceholderText(CLIENT_PLACEHOLDER), 'Acme');

          await waitFor(() => expect(editPaymentButton()).toHaveAttribute('aria-disabled', 'true'));
        });

      });

      it('refuses an amount below what is recorded, and writes nothing', async () => {
        const user = userEvent.setup();
        await openEdit(txId);
        await waitFor(() => expect(amountInput().value).toBe('100'));

        await user.clear(amountInput());
        await user.type(amountInput(), '40');
        await user.click(saveButton());

        const recorded = formatAmount(5000, 'USD', 'en-US');
        // the amount is LRI-isolated (MUT-110) so it stays left-to-right whole inside the Arabic sentence too
        expect(
          await screen.findByText(`\u2066${recorded}\u2069 is already recorded as paid, so the amount can't be less`)
        ).toBeInTheDocument();
        expect((await transactionRepo.get(txId))?.amountMinor).toBe(10000);
      });

      it('owes the difference when the amount is raised', async () => {
        const user = userEvent.setup();
        await openEdit(txId);
        await waitFor(() => expect(amountInput().value).toBe('100'));

        await user.clear(amountInput());
        await user.type(amountInput(), '120');
        await user.click(saveButton());

        await waitFor(async () => {
          const updated = await transactionRepo.get(txId);
          expect(updated?.amountMinor).toBe(12000);
          expect(updated?.receivedAmountMinor).toBe(5000);
          expect(updated?.status).toBe('unpaid');
        });
      });
    });
  });

  describe('pre-landing review fixes', () => {
    it('holds a Save pressed while a new client is being created, then saves with that client', async () => {
      const user = userEvent.setup();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const realCreate = clientRepo.create.bind(clientRepo);
      const createSpy = vi.spyOn(clientRepo, 'create').mockImplementation(async (data) => {
        await gate;
        return realCreate(data);
      });
      try {
        renderDrawer();
        await user.type(await screen.findByLabelText(/^Amount/), '100');
        await user.type(screen.getByPlaceholderText(CLIENT_PLACEHOLDER), 'Brand New Co');
        await user.keyboard('{Enter}'); // picks "create Brand New Co"
        await waitFor(() => expect(createSpy).toHaveBeenCalled());
        await user.click(saveButton()); // the client is still being saved

        expect(await transactionRepo.list({})).toHaveLength(0);
        release();

        await waitFor(async () => {
          const created = (await db.clients.toArray()).find((c) => c.name === 'Brand New Co');
          const [tx] = await transactionRepo.list({});
          expect(created).toBeDefined();
          expect(tx?.clientId).toBe(created?.id);
        });
      } finally {
        createSpy.mockRestore();
      }
    });

    it('does not save a queued entry without its client when creating the client fails', async () => {
      const user = userEvent.setup();
      let fail!: (error: Error) => void;
      const createSpy = vi.spyOn(clientRepo, 'create').mockImplementation(
        () => new Promise((_, reject) => { fail = reject; })
      );
      try {
        renderDrawer();
        await user.type(await screen.findByLabelText(/^Amount/), '100');
        const clientInput = screen.getByPlaceholderText(CLIENT_PLACEHOLDER);
        await user.type(clientInput, 'Brand New Co');
        await user.keyboard('{Enter}');
        await waitFor(() => expect(createSpy).toHaveBeenCalled());
        await user.click(saveButton());
        fail(new Error('QuotaExceededError'));

        expect(
          await screen.findByText('Pick a client from the list, or press Enter to create it')
        ).toBeInTheDocument();
        expect(clientInput).toHaveValue('Brand New Co');
        expect(await transactionRepo.list({})).toHaveLength(0);
        expect(useDrawerStore.getState().incomeDrawer.isOpen).toBe(true);
      } finally {
        createSpy.mockRestore();
      }
    });

    it('holds the status switch and Save until the payment records have loaded', async () => {
      const user = userEvent.setup();
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        profileId: testProfileId,
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-03-15',
        title: 'Waiting on records',
      });
      const recordsSpy = vi
        .spyOn(paymentRecordRepo, 'listByTransaction')
        .mockImplementation(() => new Promise(() => {}));
      try {
        await openEdit(tx.id);
        await waitFor(() => expect(titleInput().value).toBe('Waiting on records'));
        await openMoreDetails(user);

        expect(statusButton('Received')).toBeDisabled();
        expect(screen.getByLabelText('Currency')).toBeDisabled();
        expect(saveButton()).toBeDisabled();
      } finally {
        recordsSpy.mockRestore();
      }
    });

    it('says when the payment records fail to load, and Try again loads them', async () => {
      const user = userEvent.setup();
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        profileId: testProfileId,
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-03-15',
        title: 'Records failed',
      });
      const recordsSpy = vi
        .spyOn(paymentRecordRepo, 'listByTransaction')
        .mockRejectedValueOnce(new Error('DatabaseClosedError'));
      try {
        await openEdit(tx.id);
        const notice = await screen.findByText("Couldn't load this entry's payments, so it can't be saved yet.");
        expect(notice).toBeInTheDocument();
        expect(saveButton()).toBeDisabled();

        await user.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(saveButton()).toBeEnabled());
        expect(screen.queryByText("Couldn't load this entry's payments, so it can't be saved yet.")).not.toBeInTheDocument();
      } finally {
        recordsSpy.mockRestore();
      }
    });

    it('locks the currency of an entry with recorded payments', async () => {
      const user = userEvent.setup();
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        profileId: testProfileId,
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-03-15',
      });
      await paymentRecordRepo.create({ transactionId: tx.id, amountMinor: 4000, paidAt: '2024-03-20' });

      await openEdit(tx.id);
      await openMoreDetails(user);

      await waitFor(() => expect(screen.getByLabelText('Currency')).toBeDisabled());
      expect(screen.getByText("Payments are recorded in USD, so the currency can't change.")).toBeInTheDocument();
    });

    it('keeps an edited entry in its stored currency when its profile default differs', async () => {
      const user = userEvent.setup();
      const ils = await businessProfileRepo.create({ name: 'Shekel Studio', defaultCurrency: 'ILS' });
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        profileId: ils.id,
        amountMinor: 30000,
        currency: 'EUR',
        occurredAt: '2024-03-15',
        title: 'Euro job',
      });

      await openEdit(tx.id);
      await waitFor(() => expect(amountInput().value).toBe('300'));
      await user.click(saveButton());

      await waitFor(async () => expect((await transactionRepo.get(tx.id))?.title).toBe('Euro job'));
      expect((await transactionRepo.get(tx.id))?.currency).toBe('EUR');
      expect(useDrawerStore.getState().incomeDrawer.isOpen).toBe(false);
    });

    it('keeps a duplicated entry in its source currency', async () => {
      const user = userEvent.setup();
      const ils = await businessProfileRepo.create({ name: 'Shekel Studio', defaultCurrency: 'ILS' });
      const source = await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        profileId: ils.id,
        amountMinor: 30000,
        currency: 'EUR',
        occurredAt: '2024-03-15',
        title: 'Retainer',
      });
      useDrawerStore.setState({
        incomeDrawer: { isOpen: true, mode: 'create', duplicateFromId: source.id },
      });
      renderDrawer();

      await waitFor(() => expect(amountInput().value).toBe('300'));
      await user.click(saveButton());

      await waitFor(async () => {
        const copy = (await transactionRepo.list({})).find((t) => t.id !== source.id);
        expect(copy?.currency).toBe('EUR');
      });
    });

    it('stays open and says so when the repository refuses the save', async () => {
      const user = userEvent.setup();
      useToastStore.setState({ toasts: [] });
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        profileId: testProfileId,
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-03-15',
      });
      const updateSpy = vi
        .spyOn(transactionRepo, 'update')
        .mockRejectedValueOnce(
          new PaymentRecordError('Payment amount already recorded (50 USD) exceeds the new amount', {
            transactionId: tx.id,
          })
        );
      try {
        await openEdit(tx.id);
        await waitFor(() => expect(amountInput().value).toBe('100'));
        await user.click(saveButton());

        await waitFor(() => expect(updateSpy).toHaveBeenCalled());
        await waitFor(() =>
          expect(useToastStore.getState().toasts.map((toast) => toast.message)).toContain(
            "This entry's payments changed while it was open. Reopen it to see the latest."
          )
        );
        expect(useDrawerStore.getState().incomeDrawer.isOpen).toBe(true);
      } finally {
        updateSpy.mockRestore();
      }
    });

    it('lets a legacy entry with more recorded than its amount still be retitled', async () => {
      const user = userEvent.setup();
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        profileId: testProfileId,
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-03-15',
        title: 'Old entry',
      });
      await paymentRecordRepo.create({ transactionId: tx.id, amountMinor: 5000, paidAt: '2024-03-20' });
      await db.transactions.update(tx.id, { amountMinor: 4000 }); // saved before the guard existed

      await openEdit(tx.id);
      await waitFor(() => expect(titleInput().value).toBe('Old entry'));
      await user.type(titleInput(), ', renamed');
      await user.click(saveButton());

      await waitFor(async () => expect((await transactionRepo.get(tx.id))?.title).toBe('Old entry, renamed'));
    });

    it('never turns an edit of a missing entry into a new entry', async () => {
      const user = userEvent.setup();
      useDrawerStore.setState({
        incomeDrawer: { isOpen: true, mode: 'edit', transactionId: 'no-such-entry' },
      });
      renderDrawer();
      await screen.findByText('Edit Income');

      await user.type(await screen.findByLabelText(/^Amount/), '100');
      await user.click(saveButton());

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(await transactionRepo.list({})).toHaveLength(0);
    });
  });

  describe('Projects area switch (MUT-16)', () => {
    it('renders no project field in create mode while projects is off', async () => {
      const user = userEvent.setup();
      renderDrawer();

      await openMoreDetails(user);
      // settle the settings query too, so a field that appears only after the read is caught
      await waitFor(() => expect(screen.getByLabelText('Notes')).toBeInTheDocument());
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(screen.queryByPlaceholderText(PROJECT_PLACEHOLDER)).not.toBeInTheDocument();
    });

    it('renders the project field in create mode while projects is on', async () => {
      const user = userEvent.setup();
      await settingsRepo.update({ features: { projects: true } });
      renderDrawer();

      await openMoreDetails(user);
      expect(await screen.findByPlaceholderText(PROJECT_PLACEHOLDER)).toBeInTheDocument();
    });

    it('keeps an existing projectId on save while projects is off (the field is hidden, not cleared)', async () => {
      const user = userEvent.setup();
      const client = await clientRepo.create({ name: 'Client A' });
      const project = await projectRepo.create({
        name: 'Project for A',
        clientId: client.id,
        profileId: testProfileId,
      });
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        profileId: testProfileId,
        amountMinor: 12000,
        currency: 'USD',
        occurredAt: '2024-03-15',
        clientId: client.id,
        projectId: project.id,
        title: 'Grouped entry',
      });

      await openEdit(tx.id);
      await waitFor(() => expect(amountInput().value).toBe('120'));
      expect(screen.queryByPlaceholderText(PROJECT_PLACEHOLDER)).not.toBeInTheDocument();

      await user.click(saveButton());

      await waitFor(async () => {
        const updated = await transactionRepo.get(tx.id);
        expect(updated?.projectId).toBe(project.id);
      });
      expect(useDrawerStore.getState().incomeDrawer.isOpen).toBe(false);
    });
  });
});
