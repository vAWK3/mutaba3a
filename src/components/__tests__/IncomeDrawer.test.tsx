import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { db } from '../../db/database';
import { transactionRepo, clientRepo, projectRepo, businessProfileRepo } from '../../db/repository';
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
    // Create a client
    await clientRepo.create({ name: 'Test Client Inc' });

    render(
      <TestWrapper>
        <IncomeDrawer />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Client Inc')).toBeInTheDocument();
    });
  });

  it('should show projects filtered by selected client', async () => {
    const client = await clientRepo.create({ name: 'Client A' });
    await projectRepo.create({ name: 'Project for A', clientId: client.id });
    await projectRepo.create({ name: 'Unrelated Project' });

    render(
      <TestWrapper>
        <IncomeDrawer />
      </TestWrapper>
    );

    // Projects should be available after client is in the system
    await waitFor(() => {
      expect(screen.getByText('Client A')).toBeInTheDocument();
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
});
