import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ApiError, api, type DueEntryRef, type IssueDueResult } from '../api/client';
import { profileKey } from '../session/me';
import { useAttemptKey } from './attemptKey';

/**
 * MUT-660 (ADR-270): documents due. The server derives the list each read, so these hooks only read it and refresh it
 * after anything that settles an item (issuing, attaching, marking). A 404 means invoicing is off for this profile
 * (or signed out): every caller hides its part rather than showing an error.
 */
export type DueView = 'to-issue' | 'not-for-invoice';

/** Issue all: the server takes at most this many items per call; more are sent in turn. */
export const ISSUE_ALL_CHUNK = 25;
/** Bulk marks: the server takes at most this many per call. */
const MARK_CHUNK = 500;
/** Home's count: fresh enough for a glance, without a read on every render. */
const COUNT_STALE_MS = 60_000;

const notFound = (error: unknown) => error instanceof ApiError && error.status === 404;
const noRetryOn404 = (count: number, error: unknown) => !notFound(error) && count < 2;

export const documentsDueScope = (profileId: string) => profileKey(profileId, 'documents-due');

export function useDocumentsDue(profileId: string, view: DueView, olderThanMonths: number, enabled = true) {
  return useQuery({
    queryKey: [...documentsDueScope(profileId), 'list', view, olderThanMonths],
    queryFn: ({ signal }) => api.documentsDue(profileId, { view, olderThanMonths }, signal),
    retry: noRetryOn404,
    enabled,
  });
}

/** Home's "To issue · N". Null while invoicing is off (404), so Home shows nothing. */
export function useDocumentsDueCount(profileId: string, enabled = true) {
  return useQuery({
    queryKey: [...documentsDueScope(profileId), 'count'],
    queryFn: async ({ signal }): Promise<number | null> => {
      try {
        return (await api.documentsDueCount(profileId, signal)).total;
      } catch (error) {
        if (notFound(error)) return null;
        throw error;
      }
    },
    staleTime: COUNT_STALE_MS,
    enabled,
  });
}

/** Everything an issue or a mark can change: the list, the documents, the entries and the figures. */
export function refreshAfterDue(queryClient: QueryClient, profileId: string) {
  for (const scope of ['documents-due', 'issued', 'receivables', 'receivable', 'payments', 'payment', 'summary']) void queryClient.invalidateQueries({ queryKey: profileKey(profileId, scope) });
}

const chunks = <T>(items: readonly T[], size: number): T[][] => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

/** Issue all for one client: in chunks of 25, each chunk its own attempt key; the results are joined in order. */
export function useIssueDue(profileId: string) {
  const queryClient = useQueryClient();
  const attempt = useAttemptKey();
  return useMutation({
    mutationFn: async (vars: { customerId: string | null; items: DueEntryRef[] }): Promise<IssueDueResult> => {
      const results: IssueDueResult['results'] = [];
      for (const items of chunks(vars.items, ISSUE_ALL_CHUNK)) {
        const body = { customerId: vars.customerId, items };
        const answer = await api.issueDue(profileId, body, attempt.keyFor(body));
        attempt.succeeded();
        results.push(...answer.results);
      }
      return { results, issued: results.filter((r) => r.status === 'issued').length };
    },
    onSettled: () => refreshAfterDue(queryClient, profileId),
  });
}

/** Bulk "Not for invoice" (value true) or "Back to invoice" (false); all or nothing per call. */
export function useMarkNotForInvoice(profileId: string) {
  const queryClient = useQueryClient();
  const attempt = useAttemptKey();
  return useMutation({
    mutationFn: async (vars: { items: DueEntryRef[]; value: boolean }) => {
      let changed = 0;
      for (const items of chunks(vars.items, MARK_CHUNK)) {
        const body = { items, value: vars.value };
        changed += (await api.markNotForInvoice(profileId, body, attempt.keyFor(body))).changed;
        attempt.succeeded();
      }
      return { changed };
    },
    onSettled: () => refreshAfterDue(queryClient, profileId),
  });
}

/** One entry's mark from its row, with the version the row read (If-Match). */
export function useSetEntryNotForInvoice(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { entry: DueEntryRef; value: boolean; version: number }) => api.setEntryNotForInvoice(profileId, vars.entry, vars.value, vars.version),
    onSettled: () => refreshAfterDue(queryClient, profileId),
  });
}

/** The server's reason for refusing a mark, when it is one the page explains (a tax document needs a credit note first). */
export function markRefusal(error: unknown): 'HAS_TAX_DOCUMENT' | 'VERSION_MISMATCH' | null {
  if (!(error instanceof ApiError)) return null;
  const reason = (error.details as { reason?: unknown } | undefined)?.reason;
  return reason === 'HAS_TAX_DOCUMENT' || reason === 'VERSION_MISMATCH' ? reason : null;
}
