import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { db } from '../../db/database';
import { clientRepo, projectRepo, businessProfileRepo, settingsRepo } from '../../db/repository';
import { expenseRepo, expenseCategoryRepo } from '../../db/expenseRepository';
import { useDrawerStore } from '../../lib/stores';
import { ExpenseDrawer } from '../drawers/ExpenseDrawer';
import { LanguageProvider } from '../../lib/i18n';

/**
 * MUT-16 D3 for the expense drawer: the optional project field renders only
 * while the Projects area is on, and an existing projectId survives an edit
 * while the field is hidden. Real Dexie round-trip, as IncomeDrawer.test does.
 */
const PROJECT_PLACEHOLDER = 'Search or create project...';

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

describe('ExpenseDrawer — Projects area switch (MUT-16)', () => {
  let profileId: string;
  let categoryId: string;

  beforeEach(async () => {
    await clearAll();
    const profile = await businessProfileRepo.create({ name: 'Test Profile', defaultCurrency: 'USD' });
    profileId = profile.id;
    // One category so the drawer neither seeds nor fails validation
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

  it('renders no project field in create mode while projects is off', async () => {
    render(
      <TestWrapper>
        <ExpenseDrawer />
      </TestWrapper>
    );

    await screen.findByText('New Expense');
    await waitFor(() => expect(screen.getByPlaceholderText('0.00')).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByPlaceholderText(PROJECT_PLACEHOLDER)).not.toBeInTheDocument();
  });

  it('renders the project field in create mode while projects is on', async () => {
    await settingsRepo.update({ features: { projects: true } });

    render(
      <TestWrapper>
        <ExpenseDrawer />
      </TestWrapper>
    );

    expect(await screen.findByPlaceholderText(PROJECT_PLACEHOLDER)).toBeInTheDocument();
  });

  it('keeps an existing projectId on save while projects is off', async () => {
    const user = userEvent.setup();
    const client = await clientRepo.create({ name: 'Client A' });
    const project = await projectRepo.create({ name: 'Project for A', clientId: client.id, profileId });
    const expense = await expenseRepo.create({
      profileId,
      amountMinor: 4500,
      currency: 'USD',
      occurredAt: '2024-03-15',
      clientId: client.id,
      projectId: project.id,
      categoryId,
      title: 'Licence',
    });

    useDrawerStore.setState({
      expenseDrawer: { isOpen: true, mode: 'edit', expenseId: expense.id },
    });

    render(
      <TestWrapper>
        <ExpenseDrawer />
      </TestWrapper>
    );

    await screen.findByText('Edit Expense');
    await waitFor(() => {
      expect((screen.getByPlaceholderText('0.00') as HTMLInputElement).value).toBe('45');
    });
    expect(screen.queryByPlaceholderText(PROJECT_PLACEHOLDER)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(async () => {
      const updated = await expenseRepo.get(expense.id);
      expect(updated?.projectId).toBe(project.id);
      expect(updated?.categoryId).toBe(categoryId);
    });
    expect(useDrawerStore.getState().expenseDrawer.isOpen).toBe(false);
  });
});
