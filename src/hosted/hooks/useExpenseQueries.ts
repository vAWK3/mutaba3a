import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CreateExpenseRequest, type Expense, type UpdateExpenseRequest } from '../api/client';
import { useCursorList } from '../data/queries';
import { profileKey } from '../session/me';
import type { ExpenseFilters } from '../data/filters';

/**
 * The portal's expense query and mutation hooks (MUT-44). A sibling of
 * `src/hosted/data/queries.ts`, not an addition to it: that file's own
 * comment says nothing in it mutates or is placed in the cache ahead of the
 * server — true of every hook there today. Expenses are the portal's first
 * write, so they get their own home rather than quietly changing what
 * `data/` means. `useCursorList` is reused from that file (exported for
 * exactly this) rather than duplicated.
 */

const PAGE_LIMIT = 50;
const STALE_MS = 30_000;

export function useExpenses(profileId: string, filters: ExpenseFilters) {
  return useCursorList<Expense>(profileKey(profileId, 'expenses', filters), (cursor) =>
    api.expenses(profileId, {
      limit: PAGE_LIMIT,
      cursor,
      currency: filters.currency,
      categoryId: filters.categoryId,
      customerId: filters.customerId,
      from: filters.from,
      to: filters.to,
    }),
  );
}

export function useExpense(profileId: string, expenseId: string) {
  return useQuery({
    queryKey: profileKey(profileId, 'expense', expenseId),
    queryFn: () => api.expense(profileId, expenseId),
    enabled: Boolean(expenseId),
    staleTime: STALE_MS,
  });
}

export function useExpenseCategories(profileId: string) {
  return useQuery({
    queryKey: profileKey(profileId, 'expense-categories'),
    queryFn: () => api.expenseCategories(profileId),
    select: (data) => data.items,
    staleTime: STALE_MS,
  });
}

function invalidateExpenses(queryClient: ReturnType<typeof useQueryClient>, profileId: string) {
  queryClient.invalidateQueries({ queryKey: profileKey(profileId, 'expenses') });
  queryClient.invalidateQueries({ queryKey: profileKey(profileId, 'summary', 'expenses') });
}

export function useCreateExpense(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateExpenseRequest) => api.createExpense(profileId, body, crypto.randomUUID()),
    onSuccess: () => invalidateExpenses(queryClient, profileId),
  });
}

export function useUpdateExpense(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ expenseId, body, version }: { expenseId: string; body: UpdateExpenseRequest; version: string }) =>
      api.updateExpense(profileId, expenseId, body, version),
    onSuccess: (_result: Expense, { expenseId }) => {
      invalidateExpenses(queryClient, profileId);
      queryClient.invalidateQueries({ queryKey: profileKey(profileId, 'expense', expenseId) });
    },
  });
}

export function useDeleteExpense(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (expenseId: string) => api.deleteExpense(profileId, expenseId),
    onSuccess: () => invalidateExpenses(queryClient, profileId),
  });
}
