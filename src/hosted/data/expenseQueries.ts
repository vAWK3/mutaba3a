import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, type CreateExpenseRequest, type Expense, type UpdateExpenseRequest } from '../api/client';
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

/**
 * The storage bucket's signed URL is a different origin from the API, so this
 * bypasses `api/client.ts`'s `request()` (same-origin credentials, `/v1/*`
 * only) for a bare `fetch`. `credentials: 'omit'` makes explicit that no
 * cookie ever reaches the bucket, regardless of browser defaults. See
 * mut-44-expense-capture.md's CSP note: this PUT needs the bucket's origin in
 * the portal's eventual `connect-src` (MUT-45, not yet drafted).
 */
async function putToSignedUrl(url: string, headers: Record<string, string>, file: File): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, { method: 'PUT', headers, body: file, credentials: 'omit' });
  } catch {
    throw new ApiError(0, 'NETWORK', 'The upload did not reach the storage server');
  }
  if (!response.ok) throw new ApiError(response.status, 'UNKNOWN', `Upload failed with HTTP ${response.status}`);
}

export function useAddReceipt(profileId: string, expenseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const { receipt, upload } = await api.startReceipt(profileId, expenseId, {
        filename: file.name,
        mimeType: file.type as 'application/pdf' | 'image/jpeg' | 'image/png',
        sizeBytes: file.size,
      });
      await putToSignedUrl(upload.url, upload.headers, file);
      return api.completeReceipt(profileId, expenseId, receipt.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileKey(profileId, 'expense', expenseId) });
    },
  });
}

export function useDeleteReceipt(profileId: string, expenseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (receiptId: string) => api.deleteReceipt(profileId, expenseId, receiptId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileKey(profileId, 'expense', expenseId) });
    },
  });
}
