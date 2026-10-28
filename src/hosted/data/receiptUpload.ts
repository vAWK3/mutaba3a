import { ApiError, api, type CreateReceiptUploadResponse, type ExpenseReceipt } from '../api/client';
import { localFiles } from './download';
import { isLocalBlobUrl } from '../session/localBackendContract';
import type { ReceiptMimeType } from './receiptFileRules';

/**
 * One receipt upload, wherever it lands (MUT-491 R1): start → PUT the bytes to the signed URL → complete, with one
 * cleanup rule for the library (MUT-260 A4) and the expense drawer alike. Its own module so receiptQueries.ts and
 * expenseQueries.ts can both use it without importing each other.
 */

/**
 * The storage bucket's signed URL is a different origin from the API, so this
 * bypasses `api/client.ts`'s `request()` (same-origin credentials, `/v1/*`
 * only) for a bare `fetch`. `credentials: 'omit'` makes explicit that no
 * cookie ever reaches the bucket, regardless of browser defaults. See
 * mut-44-expense-capture.md's CSP note: this PUT needs the bucket's origin in
 * the portal's eventual `connect-src` (MUT-45, not yet drafted).
 */
export async function putToSignedUrl(url: string, headers: Record<string, string>, file: File): Promise<void> {
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

export interface ReceiptUploadSteps {
  start: () => Promise<CreateReceiptUploadResponse>;
  complete: (receiptId: string) => Promise<ExpenseReceipt>;
  remove: (receiptId: string) => Promise<unknown>;
}

/**
 * Start, PUT, complete. When the PUT or complete fails, the PENDING row is deleted (best effort) so it doesn't hold
 * the profile's pending cap; a complete only when the server said it didn't complete (a 4xx): a lost answer or a 5xx
 * may have completed it, and deleting would throw away a receipt that is in.
 */
export async function uploadReceiptFile(steps: ReceiptUploadSteps, file: File): Promise<ExpenseReceipt> {
  const { receipt, upload } = await steps.start();
  const cleanUp = () => steps.remove(receipt.id).catch(() => undefined);
  try {
    await putToSignedUrl(upload.url, upload.headers, file);
  } catch (error) {
    await cleanUp();
    throw error;
  }
  try {
    return await steps.complete(receipt.id);
  } catch (error) {
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) await cleanUp();
    throw error;
  }
}

function fileBody(file: File) {
  return { filename: file.name, mimeType: file.type as ReceiptMimeType, sizeBytes: file.size };
}

/** A receipt onto an existing expense (MUT-44 §3), FILED from the start. */
export function uploadExpenseReceipt(profileId: string, expenseId: string, file: File): Promise<ExpenseReceipt> {
  return uploadReceiptFile(
    {
      start: () => api.startReceipt(profileId, expenseId, fileBody(file)),
      complete: (receiptId) => api.completeReceipt(profileId, expenseId, receiptId),
      remove: (receiptId) => api.deleteReceipt(profileId, expenseId, receiptId),
    },
    file,
  );
}

/** A To-review receipt in the library (MUT-260 D9): an Idempotency-Key per file attempt. */
export function uploadLibraryReceipt(profileId: string, file: File, idempotencyKey: string): Promise<ExpenseReceipt> {
  return uploadReceiptFile(
    {
      start: () => api.startLibraryUpload(profileId, fileBody(file), idempotencyKey),
      complete: (receiptId) => api.completeLibraryReceipt(profileId, receiptId),
      remove: (receiptId) => api.deleteLibraryReceipt(profileId, receiptId),
    },
    file,
  );
}
