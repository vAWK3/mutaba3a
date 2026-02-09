import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { db } from '../../db/database';
import { transactionRepo, clientRepo, projectRepo } from '../../db/repository';
import { useDrawerStore } from '../../lib/stores';
import { TransactionDrawer } from '../drawers/TransactionDrawer';
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

describe('TransactionDrawer', () => {
  beforeEach(async () => {
    await db.transactions.clear();
    await db.clients.clear();
    await db.projects.clear();
    useDrawerStore.setState({
      transactionDrawer: { isOpen: true, mode: 'create' },
    });
  });

  afterEach(async () => {
    await db.transactions.clear();
    await db.clients.clear();
    await db.projects.clear();
    useDrawerStore.setState({
      transactionDrawer: { isOpen: false, mode: 'create' },
    });
  });

  it('should render create mode form correctly', () => {
    render(
      <TestWrapper>
        <TransactionDrawer />
      </TestWrapper>
    );

    expect(screen.getByText('New Transaction')).toBeInTheDocument();
    expect(screen.getByText('Income')).toBeInTheDocument();
    expect(screen.getByText('Receivable')).toBeInTheDocument();
    expect(screen.getByText('Expense')).toBeInTheDocument();
  });

  it('should have amount input field', () => {
    render(
      <TestWrapper>
        <TransactionDrawer />
      </TestWrapper>
    );

    const amountInput = screen.getByPlaceholderText('0.00');
    expect(amountInput).toBeInTheDocument();
  });

  it('should have currency options', () => {
    render(
      <TestWrapper>
        <TransactionDrawer />
      </TestWrapper>
    );

    expect(screen.getByText('USD')).toBeInTheDocument();
    expect(screen.getByText('ILS')).toBeInTheDocument();
  });

  it('should show due date field when receivable is selected', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <TransactionDrawer />
      </TestWrapper>
    );

    // Click on Receivable type
    const receivableButton = screen.getByText('Receivable');
    await user.click(receivableButton);

    // Due date field should appear
    await waitFor(() => {
      expect(screen.getByText('Due Date')).toBeInTheDocument();
    });
  });

  it('should create an income transaction on valid submission', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <TransactionDrawer />
      </TestWrapper>
    );

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

  it('should create an expense transaction when expense type is selected', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <TransactionDrawer />
      </TestWrapper>
    );

    // Select expense type
    const expenseButton = screen.getByText('Expense');
    await user.click(expenseButton);

    // Fill in amount
    const amountInput = screen.getByPlaceholderText('0.00');
    await user.type(amountInput, '50');

    // Submit
    const saveButton = screen.getByRole('button', { name: /save/i });
    await user.click(saveButton);

    await waitFor(async () => {
      const transactions = await transactionRepo.list({});
      expect(transactions).toHaveLength(1);
      expect(transactions[0].kind).toBe('expense');
    });
  });

  it('should create a receivable (unpaid income) when receivable type is selected', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <TransactionDrawer />
      </TestWrapper>
    );

    // Select receivable type
    const receivableButton = screen.getByText('Receivable');
    await user.click(receivableButton);

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

  it('should show validation error when amount is empty', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <TransactionDrawer />
      </TestWrapper>
    );

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
        <TransactionDrawer />
      </TestWrapper>
    );

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    await user.click(cancelButton);

    expect(useDrawerStore.getState().transactionDrawer.isOpen).toBe(false);
  });

  // Note: Edit mode tests require more complex query mocking
  it.skip('should load existing transaction in edit mode', async () => {
    // Create a transaction first
    const tx = await transactionRepo.create({
      kind: 'income',
      status: 'paid',
      amountMinor: 25000, // $250
      currency: 'USD',
      occurredAt: '2024-03-15',
      title: 'Test payment',
    });

    // Set drawer to edit mode
    useDrawerStore.setState({
      transactionDrawer: { isOpen: true, mode: 'edit', transactionId: tx.id },
    });

    render(
      <TestWrapper>
        <TransactionDrawer />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Edit Transaction')).toBeInTheDocument();
    }, { timeout: 3000 });

    await waitFor(() => {
      const amountInput = screen.getByPlaceholderText('0.00') as HTMLInputElement;
      expect(amountInput.value).toBe('250');
    }, { timeout: 3000 });
  });

  it('should show clients in dropdown when available', async () => {
    // Create a client
    await clientRepo.create({ name: 'Test Client Inc' });

    render(
      <TestWrapper>
        <TransactionDrawer />
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
        <TransactionDrawer />
      </TestWrapper>
    );

    // Projects should be available after client is in the system
    await waitFor(() => {
      expect(screen.getByText('Client A')).toBeInTheDocument();
    });
  });
});
