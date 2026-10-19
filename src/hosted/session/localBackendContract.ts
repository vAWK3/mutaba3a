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
  /** Replaces every local record with the file's. Resolves once the new data is saved on this device. */
  apply(): Promise<void>;
}

export type LocalRecordsFileError = 'not-a-records-file' | 'too-new';

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

export interface LocalBackend {
  fetch: LocalFetch;
  /** Another tab saved; returns the unsubscribe function. */
  onRemoteWrite(handler: () => void): () => void;
  /** Everything on this device, including other tabs' latest saves, as one versioned file (Your data › Download my records). */
  exportRecords(): Promise<Blob>;
  /** Reads and migrates a records file; rejects with `LocalRecordsFileRefused`. Nothing changes until `apply()`. */
  readRecordsFile(file: Blob): Promise<PendingRestore>;
}

export type BootLocalBackend = () => Promise<LocalBackend>;

/** Implemented by `src/hosted/local/index.ts`; reached only through `@mut/local-backend` (see above). */
export declare const bootLocalBackend: BootLocalBackend;
