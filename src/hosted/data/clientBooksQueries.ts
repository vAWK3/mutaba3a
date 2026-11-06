import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '../../lib/i18n/core';
import { api, ApiError, type ReceiptDisposition } from '../api/client';
import { ME_KEY, profileKey } from '../session/me';
import { DESK_PAGE, feedBounds, feedKinds, firstDay, lastDay, type KindFilter, type Period } from '../pages/client-books/clientBooksRules';
import { useCursorList } from './queries';
import { expenseCategoriesKey } from './expenseQueries';

/**
 * MUT-562: the Client books desk's reads (MUT-575's routes). The list is the accountant's own (`['clientBooks']`, no
 * profile); everything about one client lives under that client's profile key, so the "no longer shared" state can
 * drop it all at once. Every client read is read-only: there is no write here but Remove on an ended row.
 */

export const CLIENT_BOOKS_KEY = ['clientBooks'] as const;
const STALE_MS = 30_000;
/** A signed URL is fetched again this long before it expires (receiptQueries' margin). */
const URL_MARGIN_MS = 60_000;

export function useClientBooks() {
  return useQuery({ queryKey: CLIENT_BOOKS_KEY, queryFn: ({ signal }) => api.clientBooks(signal), staleTime: STALE_MS });
}

/** Remove an ended client from the list (MUT-575: it sets dismissedAt; the owner sees nothing change). */
export function useRemoveClientBook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profileId: string) => api.removeClientBook(profileId),
    onSuccess: (_, profileId) => {
      queryClient.removeQueries({ queryKey: profileKey(profileId) });
      void queryClient.invalidateQueries({ queryKey: CLIENT_BOOKS_KEY });
      void queryClient.invalidateQueries({ queryKey: ME_KEY });
    },
  });
}

/** One client's entries for a period and type, newest money date first, a page of 100 at a time. */
export function useClientEntries(profileId: string, period: Period, kind: KindFilter | undefined) {
  const bounds = feedBounds(period);
  const kinds = feedKinds(kind);
  return useCursorList(profileKey(profileId, 'clientBooks', 'entries', { ...bounds, kinds }), (cursor) =>
    api.profileEntries(profileId, { ...bounds, kinds, limit: DESK_PAGE, cursor }),
  );
}

/** The period's totals per currency (`/v1/summaries/activity`, whole months). */
export function useClientTotals(profileId: string, period: Period) {
  const from = firstDay(period.from);
  const to = lastDay(period.to);
  return useQuery({
    queryKey: profileKey(profileId, 'clientBooks', 'totals', from, to),
    queryFn: () => api.activitySummary(profileId, { from, to, bucket: 'month' }),
    staleTime: STALE_MS,
  });
}

/** Category names (archived too), in the portal's language, for the table's Category column. */
export function useClientCategories(profileId: string) {
  const { language } = useLanguage();
  return useQuery({
    queryKey: expenseCategoriesKey(profileId, language, true),
    queryFn: () => api.expenseCategories(profileId, { includeArchived: 'true' }),
    staleTime: STALE_MS,
    select: (page) => new Map(page.items.map((category) => [category.id, category.name])),
  });
}

/** An expense with its receipts, for the receipt pane. */
export function useClientExpense(profileId: string, expenseId: string | undefined) {
  return useQuery({
    queryKey: profileKey(profileId, 'clientBooks', 'expense', expenseId),
    queryFn: () => api.expense(profileId, expenseId!),
    enabled: expenseId !== undefined,
    staleTime: STALE_MS,
  });
}

/** A receipt's signed URL; `inline` previews (MUT-575 S4), `attachment` saves. Fetched again before it expires. */
export function useClientReceiptUrl(profileId: string, expenseId: string, receiptId: string, disposition: ReceiptDisposition, enabled = true) {
  return useQuery({
    queryKey: profileKey(profileId, 'clientBooks', 'receiptUrl', expenseId, receiptId, disposition),
    queryFn: () => api.expenseReceiptDownload(profileId, expenseId, receiptId, disposition),
    enabled,
    staleTime: (query) => {
      const expiresAt = query.state.data?.expiresAt;
      return expiresAt ? Math.max(0, new Date(expiresAt).getTime() - Date.now() - URL_MARGIN_MS) : 0;
    },
  });
}

/** A client read answering 404: the owner stopped sharing (or is closing their account) since the page opened. */
export function isClientGone(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** Forget everything about a client that ended mid-session, and ask the list and /v1/me again (the row turns faded). */
export function useForgetClient() {
  const queryClient = useQueryClient();
  return useCallback(
    (profileId: string) => {
      queryClient.removeQueries({ queryKey: profileKey(profileId), type: 'inactive' });
      void queryClient.invalidateQueries({ queryKey: CLIENT_BOOKS_KEY });
      void queryClient.invalidateQueries({ queryKey: ME_KEY });
    },
    [queryClient],
  );
}
