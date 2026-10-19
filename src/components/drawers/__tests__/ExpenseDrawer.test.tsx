import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { db } from '../../../db/database';
import { businessProfileRepo } from '../../../db/repository';
import { expenseCategoryRepo } from '../../../db/expenseRepository';
import { useToastStore } from '../../../lib/toastStore';
import { useDrawerStore } from '../../../lib/stores';
import { ExpenseDrawer } from '../ExpenseDrawer';
import { LanguageProvider } from '../../../lib/i18n';

/**
 * MUT-338: legacy expense saves had no success confirmation at all before
 * this ticket (only delete did) - this proves the gap is closed with the
 * same animated icon the other save surfaces get.
 */

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
      <ExpenseDrawer />
    </TestWrapper>
  );
}

describe('ExpenseDrawer', () => {
  let testProfileId: string;

  beforeEach(async () => {
    await db.expenses.clear();
    await db.expenseCategories.clear();
    await db.businessProfiles.clear();

    const profile = await businessProfileRepo.create({ name: 'Test Profile', defaultCurrency: 'USD' });
    testProfileId = profile.id;
    await expenseCategoryRepo.create({ profileId: testProfileId, name: 'Office' });

    useToastStore.setState({ toasts: [] });
    useDrawerStore.setState({
      expenseDrawer: { isOpen: true, mode: 'create', defaultProfileId: testProfileId },
    });
  });

  afterEach(async () => {
    await db.expenses.clear();
    await db.expenseCategories.clear();
    await db.businessProfiles.clear();
    useDrawerStore.setState({ expenseDrawer: { isOpen: false, mode: 'create' } });
    useToastStore.setState({ toasts: [] });
  });

  it('shows a success toast with the animated icon after saving a one-time expense', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await screen.findByText('New Expense');
    await user.type(screen.getByLabelText(/^Amount/), '42');
    await user.selectOptions(await screen.findByLabelText(/^Category/), 'Office');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    const toast = useToastStore.getState().toasts[0];
    expect(toast.message).toBe('Expense saved successfully');
    expect(toast.icon).toBeTruthy();
  });
});
