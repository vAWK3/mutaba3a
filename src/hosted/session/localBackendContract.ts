/**
 * The portal's view of the local backend (MUT-286). `src/hosted/local/**`
 * runs the server's own route modules and is type-checked under its own
 * program (tsconfig.hosted-local.json); the portal program can't check those
 * files (`erasableSyntaxOnly`, zod's route generics). So the portal reaches
 * the lazy chunk through the module alias `@mut/local-backend`:
 *
 *  - for types, tsconfig.hosted.json maps the alias to *this* file;
 *  - for code, vite.config.ts (hosted) and vitest.config.ts map it to
 *    `src/hosted/local/index.ts`, which implements `BootLocalBackend` and is
 *    checked against these types in its own program.
 *
 * Never import `bootLocalBackend` from this file directly: it is a
 * declaration only, with no value behind it.
 */

/** `fetch`'s shape: the portal's `request()` hands it the same `Request` it would send to the server. */
export type LocalFetch = (request: Request) => Promise<Response>;

/** A records file read back, before anything is replaced (Your data › Restore). */
export interface PendingRestore {
  /** Clients, projects, income, payments, expenses and conversions in the file, for the confirm step. */
  recordCount: number;
  /** Visible receipts whose file the records file can't supply; they restore without one. The confirm says so (MUT-287 review D4). */
  missingReceiptFiles: number;
  /** When the file was downloaded from a Mutaba3a account (MUT-325) rather than a device: the confirm says it is an export, and from when. */
  exportedFromAccountAt: Date | null;
  /** Records already on this device, which `apply` replaces (MUT-291 D3: the carry-over warns, and offers a download first). */
  deviceRecordCount: number;
  /** MUT-291: present when the file or message came from the old web app or the old address; what arrived and what didn't. */
  carryOver?: CarryOverSummary;
  /** Replaces every local record with the file's. Resolves once the new data is saved on this device. */
  apply(): Promise<void>;
}

/** What a carry-over brings (MUT-291 §3.6), for its summary and the `done` message to the old page. */
export interface CarryOverSummary {
  /** Per kind: businesses, clients, projects, income, payments, expenses, receipts, conversions. */
  counts: Record<string, number>;
  /** Per currency, then per figure (paid, outstanding, expenses, convertedOut, convertedIn), as decimal strings. */
  totals: Record<string, Record<string, string>>;
  /** What was reshaped to fit, one line per kind with a count (codes in mapFreeAppBackup.ts). */
  changed: Array<{ code: string; count: number }>;
  /** What didn't come, one line per kind with a count; a `refused` line carries the API's reason. */
  notCarried: Array<{ code: string; count: number; reason?: string }>;
  /** JOD income and expenses: a CSV import may have stored them 10× too small (TD-112). */
  jodEntries: number;
}

/** Which old page sent a carry-over: the free web app sends its own backup, the old portal address its records file. */
/** The two payloads the carry-over hands over: the protocol's own kinds. */
export type CarryOverPayloadKind = import('../../lib/carryOver/protocol').CarryOverKind;

export interface CarryOverPrepareOptions {
  /** The names the carry-over has to make up, in the person's language. */
  labels: { noClient: string; defaultBusiness: string };
  locale: 'ar' | 'en';
  /** Ops done of total, while the old records go through the rules (R5). */
  onProgress?: (done: number, total: number) => void;
}

/** `carry-over-failed`: the old app's records didn't add up after they went through the rules (MUT-291 E4); nothing was changed. */
export type LocalRecordsFileError = 'not-a-records-file' | 'too-new' | 'carry-over-failed';

export class LocalRecordsFileRefused extends Error {
  readonly reason: LocalRecordsFileError;

  constructor(reason: LocalRecordsFileError) {
    super(`The file can't be restored: ${reason}`);
    this.name = 'LocalRecordsFileRefused';
    this.reason = reason;
  }
}

/** By name, not `instanceof`: the class can reach the portal from the lazy chunk's own module instance. */
export function isRecordsFileRefused(error: unknown): error is LocalRecordsFileRefused {
  return error instanceof Error && error.name === 'LocalRecordsFileRefused';
}

/**
 * Receipts signed out (MUT-287, brief §6): the server's receipt routes hand
 * out `local-blob:<key>` instead of a bucket's signed URL. The portal's two
 * off-API flows (the upload PUT and the download) branch on it and go to
 * `LocalBackend.putBlob` / `readBlob`; nothing ever fetches the URL.
 */
export const LOCAL_BLOB_SCHEME = 'local-blob:';

export function localBlobUrl(key: string): string {
  return `${LOCAL_BLOB_SCHEME}${key}`;
}

export function isLocalBlobUrl(url: string): boolean {
  return url.startsWith(LOCAL_BLOB_SCHEME);
}

/** The storage key a `local-blob:` URL names. Throws for any other URL, so a bucket URL can never reach the device's store. */
export function localBlobKey(url: string): string {
  if (!isLocalBlobUrl(url)) throw new Error('Not a local-blob URL');
  return url.slice(LOCAL_BLOB_SCHEME.length);
}

export interface LocalBackend {
  fetch: LocalFetch;
  /** Another tab saved; returns the unsubscribe function. */
  onRemoteWrite(handler: () => void): () => void;
  /** Everything on this device, including other tabs' latest saves, as one versioned file (Your data › Download my records). */
  exportRecords(): Promise<Blob>;
  /**
   * Reads and migrates a records file; rejects with `LocalRecordsFileRefused`. Nothing changes until `apply()`.
   * With `carryOver`, the old web app's backup file is read too (MUT-291 E5); without it, that file is refused.
   */
  readRecordsFile(file: Blob, carryOver?: CarryOverPrepareOptions): Promise<PendingRestore>;
  /** A carry-over message's payload (MUT-291 §3.2), read the way Restore reads a file; nothing changes until `apply()`. */
  prepareCarryOver(kind: CarryOverPayloadKind, payload: Blob, options: CarryOverPrepareOptions): Promise<PendingRestore>;
  /** Stores a receipt's bytes for the `local-blob:` URL a receipt upload was signed with. Rejects any other URL, and when the browser refuses the space. */
  putBlob(url: string, file: Blob): Promise<void>;
  /** The bytes behind a `local-blob:` download URL; `null` when this device no longer has them. Rejects any other URL. */
  readBlob(url: string): Promise<Blob | null>;
}

export type BootLocalBackend = () => Promise<LocalBackend>;

/** Implemented by `src/hosted/local/index.ts`; reached only through `@mut/local-backend` (see above). */
export declare const bootLocalBackend: BootLocalBackend;

/** MUT-291: how many records this origin's signed-out store holds, read without booting a session (the old address's carry-over page). */
export declare const countRecordsOnThisDevice: () => Promise<number>;
