/**
 * The portal's view of the signed-in records export (MUT-325, ADR-156). The
 * export builds the local-mode records file, so it lives with local mode in
 * `src/hosted/local/hostedExport.ts` and runs server code (the records-file
 * codec) checked under tsconfig.hosted-local.json. The portal reaches it the
 * way it reaches the local backend (localBackendContract.ts):
 *
 *  - for types, tsconfig.hosted.json maps `@mut/records-export` to this file;
 *  - for code, vite.config.ts (hosted) and vitest.config.ts map it to
 *    `src/hosted/local/hostedExport.ts`, loaded only when someone presses
 *    Download.
 *
 * Never import `exportHostedRecords` from this file: it is a declaration only.
 */

/** How the export reaches the two routes; the portal passes its own `send()`-based one, tests a fake. */
export interface RecordsExportTransport {
  /** GET /v1/records-export for the profile; rejects with the portal's ApiError on a refusal. */
  records(profileId: string, signal?: AbortSignal): Promise<Response>;
  /** GET /v1/records-export/receipts/{receiptId} on the profile. */
  receipt(profileId: string, receiptId: string, signal?: AbortSignal): Promise<Response>;
}

export interface ExportProgress {
  phase: 'records' | 'receipts';
  /** Profiles read, or receipt files fetched, so far. */
  done: number;
  total: number;
}

export interface ExportHostedRecordsOptions {
  profileIds: readonly string[];
  transport: RecordsExportTransport;
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void;
  /** Injected so tests don't wait; resolves after `ms`, rejects when `signal` aborts. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => Date;
  concurrency?: number;
}

export interface HostedExport {
  blob: Blob;
  /** Receipts whose file couldn't be fetched (twice) or arrived the wrong size; they're in the file without it. */
  missingReceipts: number;
}

export type ExportHostedRecords = (options: ExportHostedRecordsOptions) => Promise<HostedExport>;

/** Implemented by `src/hosted/local/hostedExport.ts`; reached only through `@mut/records-export` (see above). */
export declare const exportHostedRecords: ExportHostedRecords;
