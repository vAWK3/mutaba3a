import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, type CreateExpenseRequest, type Expense, type UpdateExpenseRequest } from '../api/client';
import { useCursorList } from './queries';
import { profileKey } from '../session/me';
import type { ExpenseFilters } from './filters';
import { invalidateGroups } from './expenseGroupQueries';
import { localFiles } from './download';
import { isLocalBlobUrl } from '../session/localBackendContract';

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
  // Keyed on exactly these five fields, not the caller's `filters` object as a
  // whole: ExpensesList passes its full ExpensesPageSearch (list filters *and*
  // the drawer's ?expense=/?newExpense= state), and keying on that would make
  // opening or closing the drawer look like a filter change — a fresh
  // useInfiniteQuery entry with no cached data, so a visible reload of the
  // list underneath for a value this call never even sends to the server.
  const key = {
    currency: filters.currency,
    categoryId: filters.categoryId,
    customerId: filters.customerId,
    from: filters.from,
    to: filters.to,
    anchor: filters.anchor,
  };
  // The anchor starts the first page only (MUT-91); later pages follow its nextCursor.
  const { anchor, ...listFilters } = key;
  return useCursorList<Expense>(profileKey(profileId, 'expenses', key), (cursor) =>
    api.expenses(profileId, { limit: PAGE_LIMIT, ...listFilters, ...(cursor ? { cursor } : { anchor }) }),
  );
}

export const expenseKey = (profileId: string, expenseId: string) => profileKey(profileId, 'expense', expenseId);

export function useExpense(profileId: string, expenseId: string) {
  return useQuery({
    queryKey: expenseKey(profileId, expenseId),
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

/**
 * MUT-254: the profile's vendors matching what was typed (`q` empty: the most recently used). The previous answer stays
 * up while the next one loads, so the list doesn't blink between keystrokes.
 */
export function useVendorSuggestions(profileId: string, q: string) {
  return useQuery({
    queryKey: profileKey(profileId, 'vendors', q),
    // The answer carries its own query, so the picker can tell a suggestion's `exact` is about what is typed now.
    queryFn: async () => ({ q, items: (await api.vendors(profileId, q ? { q, limit: 10 } : { limit: 10 })).items }),
    placeholderData: (previous) => previous,
    staleTime: STALE_MS,
  });
}

function invalidateExpenses(queryClient: ReturnType<typeof useQueryClient>, profileId: string) {
  queryClient.invalidateQueries({ queryKey: profileKey(profileId, 'expenses') });
  // MUT-254: a save may have created a vendor or moved its default category.
  queryClient.invalidateQueries({ queryKey: profileKey(profileId, 'vendors') });
  queryClient.invalidateQueries({ queryKey: profileKey(profileId, 'summary', 'expenses') });
  // MUT-268: an expense's date, amount, category or very existence moves it in or out of groups (membership is computed when read).
  void invalidateGroups(queryClient, profileId);
}

export function useCreateExpense(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    // MUT-133 D5: the key comes from the drawer's attempt (data/attemptKey.ts), so a retry after a
    // timeout that actually landed replays instead of recording the expense twice.
    mutationFn: ({ body, idempotencyKey }: { body: CreateExpenseRequest; idempotencyKey: string }) => api.createExpense(profileId, body, idempotencyKey),
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
      queryClient.invalidateQueries({ queryKey: expenseKey(profileId, expenseId) });
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
  // Signed out (MUT-287): the server's routes run in the page and signed a local-blob URL; the bytes go to this device's IndexedDB.
  if (isLocalBlobUrl(url)) {
    try {
      await localFiles.put(url, file);
    } catch {
      throw new ApiError(0, 'UNKNOWN', 'The receipt could not be saved on this device');
    }
    return;
  }
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
      queryClient.invalidateQueries({ queryKey: expenseKey(profileId, expenseId) });
    },
  });
}

export function useDeleteReceipt(profileId: string, expenseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (receiptId: string) => api.deleteReceipt(profileId, expenseId, receiptId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: expenseKey(profileId, expenseId) });
    },
  });
}
