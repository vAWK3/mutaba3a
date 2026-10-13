/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LegacyExpenseEditDrawer } from '../LegacyExpenseEditDrawer';
import { useDrawerStore } from '../../../lib/stores';
import { db } from '../../../db/database';
import { LanguageProvider } from '../../../lib/i18n';

function renderDrawer() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <LegacyExpenseEditDrawer />
      </LanguageProvider>
    </QueryClientProvider>
  );
}

const LEGACY_EXPENSE_ID = 'legacy-tx-1';

describe('LegacyExpenseEditDrawer (MUT-138)', () => {
  beforeEach(async () => {
    await db.transactions.clear();
    await db.expenses.clear();
    await db.clients.clear();
    await db.projects.clear();
    await db.categories.clear();

    await db.transactions.add({
      id: LEGACY_EXPENSE_ID,
      kind: 'expense',
      status: 'paid',
      title: 'Office Rent',
      amountMinor: 15000,
      currency: 'USD',
      occurredAt: '2026-01-15',
      notes: 'Monthly rent',
      createdAt: '2026-01-15T00:00:00.000Z',
      updatedAt: '2026-01-15T00:00:00.000Z',
    });

    act(() => {
      useDrawerStore.getState().openLegacyExpenseDrawer({ transactionId: LEGACY_EXPENSE_ID });
    });
  });

  afterEach(async () => {
    act(() => {
      useDrawerStore.getState().closeLegacyExpenseDrawer();
    });
    await db.transactions.clear();
    await db.expenses.clear();
    await db.clients.clear();
    await db.projects.clear();
    await db.categories.clear();
  });

  it('loads the existing transaction by id from db.transactions, not db.expenses', async () => {
    renderDrawer();

    await waitFor(() => {
      expect(screen.getByDisplayValue('Office Rent')).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('150')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Monthly rent')).toBeInTheDocument();
  });

  it('saves edits back to db.transactions and preserves kind:expense and status:paid', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await waitFor(() => {
      expect(screen.getByDisplayValue('Office Rent')).toBeInTheDocument();
    });

    const titleInput = screen.getByDisplayValue('Office Rent');
    await user.clear(titleInput);
    await user.type(titleInput, 'Office Rent (updated)');

    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(async () => {
      const updated = await db.transactions.get(LEGACY_EXPENSE_ID);
      expect(updated?.title).toBe('Office Rent (updated)');
    });

    const updated = await db.transactions.get(LEGACY_EXPENSE_ID);
    expect(updated?.kind).toBe('expense');
    expect(updated?.status).toBe('paid');
    expect(await db.expenses.count()).toBe(0);
  });

  it('deletes the transaction on confirm', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderDrawer();

    await waitFor(() => {
      expect(screen.getByDisplayValue('Office Rent')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /delete/i }));

    await waitFor(async () => {
      const deleted = await db.transactions.get(LEGACY_EXPENSE_ID);
      expect(deleted?.deletedAt).toBeTruthy();
    });
  });

  it('does not delete when the confirmation is declined', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderDrawer();

    await waitFor(() => {
      expect(screen.getByDisplayValue('Office Rent')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /delete/i }));

    const stillThere = await db.transactions.get(LEGACY_EXPENSE_ID);
    expect(stillThere?.deletedAt).toBeFalsy();
  });

  it('renders without crashing when clientId/projectId point at a deleted record', async () => {
    await db.transactions.update(LEGACY_EXPENSE_ID, {
      clientId: 'deleted-client-id',
      projectId: 'deleted-project-id',
    });

    renderDrawer();

    await waitFor(() => {
      expect(screen.getByDisplayValue('Office Rent')).toBeInTheDocument();
    });
    // No crash, no matching option selected — the stale id is simply not in the list
    expect(screen.queryByText('deleted-client-id')).not.toBeInTheDocument();
  });

  it('allows saving with no category selected', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await waitFor(() => {
      expect(screen.getByDisplayValue('Office Rent')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(async () => {
      const updated = await db.transactions.get(LEGACY_EXPENSE_ID);
      expect(updated?.categoryId).toBeUndefined();
    });
  });
});
