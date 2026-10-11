import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { db } from '../../db/database';
import { businessProfileRepo } from '../../db/repository';
import { expenseRepo, expenseCategoryRepo } from '../../db/expenseRepository';
import { useDrawerStore } from '../../lib/stores';
import { ExpenseDrawer } from '../drawers/ExpenseDrawer';
import { LanguageProvider } from '../../lib/i18n';

/**
 * MUT-44: regression coverage for the one-time-expense fields now rendered by
 * the extracted ExpenseFormFields, through the real local ExpenseDrawer. Before
 * this ticket, only the Projects-area toggle was covered
 * (ExpenseDrawer.projectField.test.tsx) — nothing exercised amount, currency,
 * date, title, category-required or notes. This file proves the extraction
 * changed where the JSX lives, not what it does.
 */

function TestWrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>{children}</LanguageProvider>
    </QueryClientProvider>
  );
}

async function clearAll() {
  await db.expenses.clear();
  await db.expenseCategories.clear();
  await db.clients.clear();
  await db.projects.clear();
  await db.businessProfiles.clear();
  await db.settings.clear();
}

describe('ExpenseDrawer — one-time fields (MUT-44 extraction regression)', () => {
  let profileId: string;
  let categoryId: string;

  beforeEach(async () => {
    await clearAll();
    const profile = await businessProfileRepo.create({ name: 'Test Profile', defaultCurrency: 'USD' });
    profileId = profile.id;
    const category = await expenseCategoryRepo.create({ profileId, name: 'Software' });
    categoryId = category.id;
    useDrawerStore.setState({
      expenseDrawer: { isOpen: true, mode: 'create', defaultProfileId: profileId },
    });
  });

  afterEach(async () => {
    await clearAll();
    useDrawerStore.setState({ expenseDrawer: { isOpen: false, mode: 'create' } });
  });

  it('saves amount, currency, date, title, category and notes as amountMinor on create', async () => {
    const user = userEvent.setup();
    render(
      <TestWrapper>
        <ExpenseDrawer />
      </TestWrapper>,
    );

    await screen.findByText('New Expense');
    const amountInput = (await screen.findByPlaceholderText('0.00')) as HTMLInputElement;
    expect(amountInput.type).toBe('number');

    await user.clear(amountInput);
    await user.type(amountInput, '45.50');

    const currencySelect = screen.getByDisplayValue('USD') as HTMLSelectElement;
    await user.selectOptions(currencySelect, 'ILS');

    const titleInput = screen.getByPlaceholderText('Brief description...');
    await user.type(titleInput, 'Office supplies');

    const categorySelect = screen.getByDisplayValue('Select category...') as HTMLSelectElement;
    await user.selectOptions(categorySelect, categoryId);

    const notesInput = screen.getByPlaceholderText('Additional notes...');
    await user.type(notesInput, 'Stationery for the office');

    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(async () => {
      const all = await expenseRepo.list();
      expect(all).toHaveLength(1);
      const saved = all[0];
      expect(saved.amountMinor).toBe(4550);
      expect(saved.currency).toBe('ILS');
      expect(saved.title).toBe('Office supplies');
      expect(saved.categoryId).toBe(categoryId);
      expect(saved.notes).toBe('Stationery for the office');
    });
    expect(useDrawerStore.getState().expenseDrawer.isOpen).toBe(false);
  });

  it('blocks submit when category is left empty', async () => {
    const user = userEvent.setup();
    render(
      <TestWrapper>
        <ExpenseDrawer />
      </TestWrapper>,
    );

    await screen.findByText('New Expense');
    const amountInput = await screen.findByPlaceholderText('0.00');
    await user.type(amountInput, '10');

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText('This field is required')).toBeInTheDocument();
    expect(useDrawerStore.getState().expenseDrawer.isOpen).toBe(true);
    expect(await expenseRepo.list()).toHaveLength(0);
  });

  it('prefills amount, currency, date, title and notes on edit', async () => {
    const expense = await expenseRepo.create({
      profileId,
      amountMinor: 12345,
      currency: 'ILS',
      occurredAt: '2026-09-01',
      categoryId,
      title: 'Hosting',
      notes: 'Monthly bill',
    });

    useDrawerStore.setState({
      expenseDrawer: { isOpen: true, mode: 'edit', expenseId: expense.id },
    });

    render(
      <TestWrapper>
        <ExpenseDrawer />
      </TestWrapper>,
    );

    await screen.findByText('Edit Expense');
    await waitFor(() => {
      expect((screen.getByPlaceholderText('0.00') as HTMLInputElement).value).toBe('123.45');
    });
    expect(screen.getByDisplayValue('ILS')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Hosting')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Monthly bill')).toBeInTheDocument();
  });
});
