import { useState } from 'react';
import { useMutation, useQuery, useQueryClient, type Query, type QueryClient } from '@tanstack/react-query';
import { ApiError, api, type ApproveReceiptRequest, type ExpenseReceipt, type ReceiptDisposition, type ReceiptListItem } from '../api/client';
import { profileKey } from '../session/me';
import { useCursorList } from './queries';
import { invalidateExpenses, putToSignedUrl } from './expenseQueries';
import type { ReceiptStatusFilter } from './filters';
import type { ReceiptMimeType } from './receiptFileRules';

/**
 * The receipts library in the portal (MUT-260 over MUT-255's /v1/receipts): the gallery's pages, the counts that
 * also say whether the library is on (D4, A11), one receipt, its signed originals (D5), library uploads (D9) and
 * approve (D8). Everything keys under `['p', profileId, 'receipts', …]`, so one invalidation refreshes it all.
 */

export const RECEIPT_PAGE_LIMIT = 24;
const COUNTS_STALE_MS = 60_000;
const RECEIPT_STALE_MS = 30_000;
/** A signed URL is used until a minute before it expires (D5). */
const URL_MARGIN_MS = 60_000;

export const receiptsKey = (profileId: string, ...rest: unknown[]) => profileKey(profileId, 'receipts', ...rest);
export const receiptKey = (profileId: string, receiptId: string) => receiptsKey(profileId, 'one', receiptId);

/** A13: the URL's status as the server's filter; `all` sends none. */
export function filingStatusOf(status: ReceiptStatusFilter): 'TO_REVIEW' | 'FILED' | undefined {
  if (status === 'to_review') return 'TO_REVIEW';
  if (status === 'filed') return 'FILED';
  return undefined;
}

export function useReceipts(profileId: string, status: ReceiptStatusFilter) {
  const filingStatus = filingStatusOf(status);
  return useCursorList<ReceiptListItem>(receiptsKey(profileId, 'list', status), (cursor) =>
    api.listReceipts(profileId, { limit: RECEIPT_PAGE_LIMIT, ...(filingStatus ? { filingStatus } : {}), ...(cursor ? { cursor } : {}) }),
  );
}

/** A11: 404 (the library off, or signed out) and 503 (no bucket) both mean "not here", and are never retried. */
export function isLibraryOff(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 503);
}

export type ReceiptsAvailability = 'checking' | 'on' | 'off';

export function useReceiptCounts(profileId: string) {
  return useQuery({
    queryKey: receiptsKey(profileId, 'counts'),
    queryFn: () => api.receiptCounts(profileId),
    staleTime: COUNTS_STALE_MS,
    retry: (failures, error) => !isLibraryOff(error) && failures < 2,
  });
}

/**
 * Whether the library is on for this profile (D4): on once the counts answer, off on a 404 or 503. Any other failure
 * (the network, a 500) keeps the tab: the library is there, only its count is unknown.
 */
export function useReceiptsAvailability(profileId: string): { availability: ReceiptsAvailability; toReview: number | null } {
  const counts = useReceiptCounts(profileId);
  // A refetch that says "off" wins over counts cached from before (the library turned off mid-session).
  if (counts.isError && isLibraryOff(counts.error)) return { availability: 'off', toReview: null };
  if (counts.data) return { availability: 'on', toReview: counts.data.toReview };
  if (counts.isError) return { availability: 'on', toReview: null };
  return { availability: 'checking', toReview: null };
}

/** MUT-441 §4: while the server reads a receipt, its page re-reads it this often, for at most this long. */
export const READING_POLL_MS = 3_000;
export const READING_POLL_MAX_MS = 120_000;

type ReceiptQuery = Query<ExpenseReceipt, Error, ExpenseReceipt, readonly unknown[]>;

/** When each receipt query was first seen `pending`, on the wall clock, so the two minutes survive a remount. */
const pendingSince = new WeakMap<ReceiptQuery, number>();

/**
 * Whether the two minutes since the query was first seen pending are up. Wall time, not `dataUpdatedAt`: a refetch
 * that fails leaves `dataUpdatedAt` where it was, which would never reach the limit (MUT-441 review).
 */
function readingTimedOut(query: ReceiptQuery): boolean {
  const since = pendingSince.get(query);
  return since !== undefined && Date.now() - since >= READING_POLL_MAX_MS;
}

function readingPoll(query: ReceiptQuery): number | false {
  if (query.state.data?.reading !== 'pending') {
    pendingSince.delete(query);
    return false;
  }
  if (!pendingSince.has(query)) pendingSince.set(query, Date.now());
  // A refetch that failed (a 404, or retries used up) stops the polling; the form stays usable as it is.
  if (query.state.status === 'error') return false;
  return readingTimedOut(query) ? false : READING_POLL_MS;
}

/**
 * One receipt. MUT-441: polls while the server reads it (`reading: 'pending'`) and stops two minutes after first
 * seeing that, or once a refetch fails; `readingShown` is false after that too, so the page just shows the form. When
 * the reading ends, the gallery's lists refresh (their cards say "Reading…"). Local mode and unread receipts answer
 * null: no polling.
 */
export function useReceipt(profileId: string, receiptId: string) {
  const queryClient = useQueryClient();
  const key = receiptKey(profileId, receiptId);
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const before = queryClient.getQueryData<ExpenseReceipt>(key)?.reading;
      const receipt = await api.getReceipt(profileId, receiptId);
      if (before === 'pending' && receipt.reading !== 'pending') void queryClient.invalidateQueries({ queryKey: receiptsKey(profileId, 'list') });
      return receipt;
    },
    staleTime: RECEIPT_STALE_MS,
    retry: (failures, error) => !(error instanceof ApiError && error.status === 404) && failures < 2,
    refetchInterval: readingPoll,
  });
  const cached = queryClient.getQueryCache().find<ExpenseReceipt>({ queryKey: key, exact: true }) as ReceiptQuery | undefined;
  const readingShown = query.data?.reading === 'pending' && !query.isError && !(cached && readingTimedOut(cached));
  return { ...query, readingShown };
}

/** A3: the receipt as the gallery last listed it (with its linked expense), from any loaded page. */
export function cachedListItem(queryClient: QueryClient, profileId: string, receiptId: string): ReceiptListItem | undefined {
  for (const [, data] of queryClient.getQueriesData<{ pages: { items: ReceiptListItem[] }[] }>({ queryKey: receiptsKey(profileId, 'list') })) {
    const found = data?.pages.flatMap((page) => page.items).find((item) => item.id === receiptId);
    if (found) return found;
  }
  return undefined;
}

/**
 * A receipt's signed original (D5, A12), fetched only while `enabled` (a card in view, the preview open). Used until a
 * minute before it expires; the disposition is part of the key, since an inline URL and an attachment URL differ.
 */
export function useReceiptDownload(profileId: string, receiptId: string, disposition: ReceiptDisposition, enabled = true) {
  return useQuery({
    queryKey: receiptsKey(profileId, 'download', receiptId, disposition),
    queryFn: () => api.libraryReceiptDownload(profileId, receiptId, disposition),
    enabled,
    staleTime: (query) => {
      const expiresAt = query.state.data?.expiresAt;
      return expiresAt ? Math.max(0, new Date(expiresAt).getTime() - Date.now() - URL_MARGIN_MS) : 0;
    },
    gcTime: RECEIPT_STALE_MS,
  });
}

/** The lists, the counts and single receipts; never the signed URLs, which stay valid (re-signing would reload every thumbnail). */
export function invalidateReceipts(queryClient: QueryClient, profileId: string) {
  for (const part of ['list', 'counts', 'one']) void queryClient.invalidateQueries({ queryKey: receiptsKey(profileId, part) });
}

/**
 * One library upload (D9): start (an Idempotency-Key per file attempt), PUT the bytes to the signed URL, complete.
 * A4: when the PUT or complete fails, the PENDING row is deleted (best effort) so it doesn't hold the pending cap.
 */
export async function uploadLibraryReceipt(profileId: string, file: File, idempotencyKey: string): Promise<ExpenseReceipt> {
  const { receipt, upload } = await api.startLibraryUpload(
    profileId,
    { filename: file.name, mimeType: file.type as ReceiptMimeType, sizeBytes: file.size },
    idempotencyKey,
  );
  const cleanUp = () => api.deleteLibraryReceipt(profileId, receipt.id).catch(() => undefined);
  try {
    await putToSignedUrl(upload.url, upload.headers, file);
  } catch (error) {
    await cleanUp();
    throw error;
  }
  try {
    return await api.completeLibraryReceipt(profileId, receipt.id);
  } catch (error) {
    // Only when the server said it didn't complete (a 4xx): a lost answer or a 5xx may have completed it, and
    // deleting would throw away a receipt that is in (the pending row, if any, ages out of the 24-hour cap).
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) await cleanUp();
    throw error;
  }
}

export interface PendingUpload {
  key: string;
  name: string;
}

export interface UploadOutcome {
  file: File;
  error: unknown | null;
}

/**
 * Files upload one at a time (D9), each shown as an "Uploading…" card until it lands. Resolves with each file's
 * outcome; the list and counts refresh after every success, so a receipt appears under To review as soon as it is in.
 */
export function useUploadReceipts(profileId: string) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingUpload[]>([]);

  const upload = async (files: File[]): Promise<UploadOutcome[]> => {
    const queued = files.map((file) => ({ file, key: crypto.randomUUID() }));
    setPending((current) => [...current, ...queued.map(({ file, key }) => ({ key, name: file.name }))]);
    const outcomes: UploadOutcome[] = [];
    let refused: ApiError | null = null;
    for (const { file, key } of queued) {
      // A 429 refuses the rest too (the pending cap, or the per-minute budget): they are reported, not sent.
      if (refused) {
        outcomes.push({ file, error: refused });
        setPending((current) => current.filter((p) => p.key !== key));
        continue;
      }
      try {
        await uploadLibraryReceipt(profileId, file, key);
        outcomes.push({ file, error: null });
        invalidateReceipts(queryClient, profileId);
      } catch (error) {
        outcomes.push({ file, error });
        if (error instanceof ApiError && error.status === 429) refused = error;
        // A refused start never made a row, but a failed PUT/complete may have left one behind if its delete failed.
        else invalidateReceipts(queryClient, profileId);
      } finally {
        setPending((current) => current.filter((p) => p.key !== key));
      }
    }
    return outcomes;
  };

  return { upload, pending, uploading: pending.length > 0 };
}

export function useApproveReceipt(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ receiptId, body, idempotencyKey }: { receiptId: string; body: ApproveReceiptRequest; idempotencyKey: string }) =>
      api.approveReceipt(profileId, receiptId, body, idempotencyKey),
    onSuccess: () => {
      invalidateReceipts(queryClient, profileId);
      invalidateExpenses(queryClient, profileId);
    },
  });
}

export type UploadErrorKey = 'tooManyPending' | 'rateLimited' | 'storage' | 'uploadFailed';

/** What a failed library upload tells the person (D9, A4): two different 429s, the bucket down, anything else. */
export function uploadErrorOf(error: unknown): { key: UploadErrorKey; seconds?: number } {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      const reason = (error.details as { reason?: unknown } | null)?.reason;
      if (reason === 'TOO_MANY_PENDING_UPLOADS') return { key: 'tooManyPending' };
      return { key: 'rateLimited', seconds: error.retryAfterSeconds ?? RATE_LIMIT_FALLBACK_SECONDS };
    }
    if (error.status === 503) return { key: 'storage' };
  }
  return { key: 'uploadFailed' };
}

const RATE_LIMIT_FALLBACK_SECONDS = 60;

/** "Next receipt" (D8, A13): the one after this in the loaded To-review list, else the first other one, else none. */
export function nextReceiptId(queue: readonly { id: string }[] | undefined, currentId: string): string | null {
  if (!queue) return null;
  const at = queue.findIndex((item) => item.id === currentId);
  const after = at >= 0 ? queue.slice(at + 1).find((item) => item.id !== currentId) : undefined;
  return (after ?? queue.find((item) => item.id !== currentId))?.id ?? null;
}
