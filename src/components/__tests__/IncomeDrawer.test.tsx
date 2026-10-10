import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { db } from '../../db/database';
import { transactionRepo, clientRepo, projectRepo, businessProfileRepo, settingsRepo } from '../../db/repository';
import { useDrawerStore } from '../../lib/stores';
import { IncomeDrawer } from '../drawers/IncomeDrawer';
import { LanguageProvider } from '../../lib/i18n';

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

describe('IncomeDrawer', () => {
  let testProfileId: string;

  beforeEach(async () => {
    await db.transactions.clear();
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
    await db.clients.clear();
    await db.projects.clear();
    await db.businessProfiles.clear();
    await db.settings.clear();
    useDrawerStore.setState({
      incomeDrawer: { isOpen: false, mode: 'create' },
    });
  });

  it('should render create mode form correctly', async () => {
    render(
      <TestWrapper>
        <IncomeDrawer />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('New Income')).toBeInTheDocument();
    });

    // Should show the three status options
    expect(screen.getByText('Earned')).toBeInTheDocument();
    expect(screen.getByText('Invoiced')).toBeInTheDocument();
    expect(screen.getByText('Received')).toBeInTheDocument();
  });

  it('should have amount input field', async () => {
    render(
      <TestWrapper>
        <IncomeDrawer />
      </TestWrapper>
    );

    await waitFor(() => {
      const amountInput = screen.getByPlaceholderText('0.00');
      expect(amountInput).toBeInTheDocument();
    });
  });

  it('should have currency options', async () => {
    render(
      <TestWrapper>
        <IncomeDrawer />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('USD')).toBeInTheDocument();
      expect(screen.getByText('ILS')).toBeInTheDocument();
    });
  });

  it('should show due date field when Earned or Invoiced is selected', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <IncomeDrawer />
      </TestWrapper>
    );

    // Click on Invoiced status
    await waitFor(() => {
      expect(screen.getByText('Invoiced')).toBeInTheDocument();
    });

    const invoicedButton = screen.getByText('Invoiced');
    await user.click(invoicedButton);

    // Due date field should appear
    await waitFor(() => {
      expect(screen.getByText('Due Date')).toBeInTheDocument();
    });
  });

  it('should hide due date field when Received is selected', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <IncomeDrawer />
      </TestWrapper>
    );

    // Click on Received status
    await waitFor(() => {
      expect(screen.getByText('Received')).toBeInTheDocument();
    });

    const receivedButton = screen.getByText('Received');
    await user.click(receivedButton);

    // Due date field should NOT appear
    await waitFor(() => {
      expect(screen.queryByText('Due Date')).not.toBeInTheDocument();
    });
  });

  it('should create a paid income transaction when Received is selected', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <IncomeDrawer />
      </TestWrapper>
    );

    // Wait for form to load
    await waitFor(() => {
      expect(screen.getByText('Received')).toBeInTheDocument();
    });

    // Select Received status
    const receivedButton = screen.getByText('Received');
    await user.click(receivedButton);

    // Fill in amount
    const amountInput = screen.getByPlaceholderText('0.00');
    await user.type(amountInput, '100');

    // Submit
    const saveButton = screen.getByRole('button', { name: /save/i });
    await user.click(saveButton);

    // Wait for transaction to be created
    await waitFor(async () => {
      const transactions = await transactionRepo.list({});
      expect(transactions).toHaveLength(1);
      expect(transactions[0].amountMinor).toBe(10000); // $100.00 = 10000 minor
      expect(transactions[0].kind).toBe('income');
      expect(transactions[0].status).toBe('paid');
    });
  });

  it('should create an unpaid income transaction when Earned is selected', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <IncomeDrawer />
      </TestWrapper>
    );

    // Wait for form to load - Earned is the default
    await waitFor(() => {
      expect(screen.getByText('Earned')).toBeInTheDocument();
    });

    // Fill in amount
    const amountInput = screen.getByPlaceholderText('0.00');
    await user.type(amountInput, '200');

    // Submit
    const saveButton = screen.getByRole('button', { name: /save/i });
    await user.click(saveButton);

    await waitFor(async () => {
      const transactions = await transactionRepo.list({});
      expect(transactions).toHaveLength(1);
      expect(transactions[0].kind).toBe('income');
      expect(transactions[0].status).toBe('unpaid');
    });
  });

  it('should create an unpaid income transaction when Invoiced is selected', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <IncomeDrawer />
      </TestWrapper>
    );

    // Wait for form to load
    await waitFor(() => {
      expect(screen.getByText('Invoiced')).toBeInTheDocument();
    });

    // Select Invoiced status
    const invoicedButton = screen.getByText('Invoiced');
    await user.click(invoicedButton);

    // Fill in amount
    const amountInput = screen.getByPlaceholderText('0.00');
    await user.type(amountInput, '300');

    // Submit
    const saveButton = screen.getByRole('button', { name: /save/i });
    await user.click(saveButton);

    await waitFor(async () => {
      const transactions = await transactionRepo.list({});
      expect(transactions).toHaveLength(1);
      expect(transactions[0].kind).toBe('income');
      expect(transactions[0].status).toBe('unpaid');
    });
  });

  it('should show validation error when amount is empty', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <IncomeDrawer />
      </TestWrapper>
    );

    // Wait for form to load
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    });

    // Submit without filling amount
    const saveButton = screen.getByRole('button', { name: /save/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText('Amount is required')).toBeInTheDocument();
    });
  });

  it('should close drawer when cancel is clicked', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <IncomeDrawer />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    await user.click(cancelButton);

    expect(useDrawerStore.getState().incomeDrawer.isOpen).toBe(false);
  });

  it('should show clients in dropdown when available', async () => {
    const user = userEvent.setup();
    // Create a client
    await clientRepo.create({ name: 'Test Client Inc' });

    render(
      <TestWrapper>
        <IncomeDrawer />
      </TestWrapper>
    );

    // The typeahead only renders its options while open (EntityTypeahead:143)
    const clientInput = await screen.findByPlaceholderText('Search or create client...');
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
    await projectRepo.create({
      name: 'Project for A',
      clientId: clientA.id,
      profileId: testProfileId,
    });
    await projectRepo.create({
      name: 'Project for B',
      clientId: clientB.id,
      profileId: testProfileId,
    });

    render(
      <TestWrapper>
        <IncomeDrawer />
      </TestWrapper>
    );

    // Select Client A in the client typeahead
    const clientInput = await screen.findByPlaceholderText('Search or create client...');
    await user.click(clientInput);
    const optionA = await screen.findByRole('option', { name: 'Client A' });
    await user.click(optionA);

    // Open the project typeahead: only Client A's project should be listed
    const projectInput = screen.getByPlaceholderText('Select project...');
    await user.click(projectInput);

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Project for A' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Project for B' })).not.toBeInTheDocument();
    });
  });

  // Edit mode tests
  it.skip('should load existing transaction in edit mode', async () => {
    // Create a transaction first
    const tx = await transactionRepo.create({
      kind: 'income',
      status: 'paid',
      profileId: testProfileId,
      amountMinor: 25000, // $250
      currency: 'USD',
      occurredAt: '2024-03-15',
      title: 'Test payment',
    });

    // Set drawer to edit mode
    useDrawerStore.setState({
      incomeDrawer: { isOpen: true, mode: 'edit', transactionId: tx.id },
    });

    render(
      <TestWrapper>
        <IncomeDrawer />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Edit Income')).toBeInTheDocument();
    }, { timeout: 3000 });

    await waitFor(() => {
      const amountInput = screen.getByPlaceholderText('0.00') as HTMLInputElement;
      expect(amountInput.value).toBe('250');
    }, { timeout: 3000 });
  });

  it('should clear paidAt and receivedAmountMinor when changing from received to invoiced', async () => {
    const user = userEvent.setup();

    // Create a paid transaction
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

    // Verify initial state
    const initialTx = await transactionRepo.get(tx.id);
    expect(initialTx?.status).toBe('paid');
    expect(initialTx?.paidAt).toBe('2024-03-15T10:00:00Z');
    expect(initialTx?.receivedAmountMinor).toBe(50000);

    // Set drawer to edit mode
    useDrawerStore.setState({
      incomeDrawer: { isOpen: true, mode: 'edit', transactionId: tx.id },
    });

    render(
      <TestWrapper>
        <IncomeDrawer />
      </TestWrapper>
    );

    // Wait for form to load
    await waitFor(() => {
      expect(screen.getByText('Edit Income')).toBeInTheDocument();
    });

    // Should show "Received" as active since status is 'paid'
    await waitFor(() => {
      const receivedButton = screen.getByText('Received');
      expect(receivedButton.closest('button')).toHaveClass('active');
    });

    // Click on Invoiced status
    const invoicedButton = screen.getByText('Invoiced');
    await user.click(invoicedButton);

    // Wait for the status to change in the UI
    await waitFor(() => {
      expect(invoicedButton.closest('button')).toHaveClass('active');
    });

    // Submit the form
    const saveButton = screen.getByRole('button', { name: /save/i });
    await user.click(saveButton);

    // Wait for update to complete and verify paidAt and receivedAmountMinor are cleared.
    // The drawer writes `undefined`, and Dexie deletes keys whose value is undefined,
    // so the fields are absent - not null - after the update.
    await waitFor(async () => {
      const updatedTx = await transactionRepo.get(tx.id);
      expect(updatedTx?.status).toBe('unpaid');
      expect(updatedTx?.paidAt).toBeUndefined();
      expect(updatedTx?.receivedAmountMinor).toBeUndefined();
    });
  });

  describe('Projects area switch (MUT-16)', () => {
    const PROJECT_PLACEHOLDER = 'Select project...';

    it('renders no project field in create mode while projects is off', async () => {
      render(
        <TestWrapper>
          <IncomeDrawer />
        </TestWrapper>
      );

      await screen.findByText('New Income');
      await waitFor(() => expect(screen.getByPlaceholderText('0.00')).toBeInTheDocument());
      // An ungated field would already be in the form at this point (the client field is);
      // settle the settings query too, so a field that appears only after the read is caught
      await waitFor(() => expect(screen.getByPlaceholderText('Search or create client...')).toBeInTheDocument());
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(screen.queryByPlaceholderText(PROJECT_PLACEHOLDER)).not.toBeInTheDocument();
    });

    it('renders the project field in create mode while projects is on', async () => {
      await settingsRepo.update({ features: { projects: true } });

      render(
        <TestWrapper>
          <IncomeDrawer />
        </TestWrapper>
      );

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

      useDrawerStore.setState({
        incomeDrawer: { isOpen: true, mode: 'edit', transactionId: tx.id },
      });

      render(
        <TestWrapper>
          <IncomeDrawer />
        </TestWrapper>
      );

      await screen.findByText('Edit Income');
      await waitFor(() => {
        expect((screen.getByPlaceholderText('0.00') as HTMLInputElement).value).toBe('120');
      });
      expect(screen.queryByPlaceholderText(PROJECT_PLACEHOLDER)).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(async () => {
        const updated = await transactionRepo.get(tx.id);
        expect(updated?.projectId).toBe(project.id);
      });
      expect(useDrawerStore.getState().incomeDrawer.isOpen).toBe(false);
    });
  });
});
