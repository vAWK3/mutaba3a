import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CreateExpenseRequest, type Expense, type UpdateExpenseRequest } from '../api/client';
import { useCursorList } from './queries';
import { profileKey } from '../session/me';
import type { ExpenseFilters } from './filters';

/**
 * The portal's expense query and mutation hooks (MUT-44), in their own file
 * rather than queries.ts: that file's own comment says nothing in it mutates
 * or is placed in the cache ahead of the server — true of every hook there
 * until now. Expenses are the portal's first write. Lives under `data/`, not
 * a `hooks/` directory — that path segment is lint-banned from `src/hosted/**`
 * (it means the *local app's* hooks, hosted-portal.md §8, but the rule
 * matches on the literal segment name, not which hooks they are).
 * `useCursorList` is reused from queries.ts (exported for exactly this)
 * rather than duplicated.
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
