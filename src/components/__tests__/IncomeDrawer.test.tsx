import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
} from '../../db/repository';
import { useDrawerStore } from '../../lib/stores';
import { IncomeDrawer } from '../drawers/IncomeDrawer';
import { LanguageProvider } from '../../lib/i18n';
import { formatAmount, formatDate, todayISO } from '../../lib/utils';

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
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(clientInput).toHaveValue('');
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

    it('picks a client whose exact name was typed when the box is left', async () => {
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

      await openEdit(tx.id);

      await waitFor(() => expect(titleInput().value).toBe('Plain entry'));
      await new Promise((resolve) => setTimeout(resolve, 30));
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

    it('still shows the lock notice and disables Save on a locked entry', async () => {
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        profileId: testProfileId,
        amountMinor: 25000,
        currency: 'USD',
        occurredAt: '2024-03-15',
        lockedAt: '2024-03-20T00:00:00.000Z',
        lockedByDocumentId: 'doc-1',
      });

      await openEdit(tx.id);

      expect(await screen.findByTestId('income-locked-notice')).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
    });
  });

  describe('payment data on edit (MUT-5)', () => {
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
        expect(
          screen.getByText(
            'Payments are recorded for this entry, so its status follows them. Manage payments from the client page.'
          )
        ).toBeInTheDocument();
      });

      it('refuses an amount below what is recorded, and writes nothing', async () => {
        const user = userEvent.setup();
        await openEdit(txId);
        await waitFor(() => expect(amountInput().value).toBe('100'));

        await user.clear(amountInput());
        await user.type(amountInput(), '40');
        await user.click(saveButton());

        const recorded = formatAmount(5000, 'USD', 'en-US');
        expect(
          await screen.findByText(`${recorded} is already recorded as paid, so the amount can’t be less`)
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
