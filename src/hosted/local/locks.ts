import type { IndexedDbPersistence } from './persistence.js';

const LOCK_NAME = 'mut-local';
const CHANNEL_NAME = 'mut-local';

export interface LockContext {
  /** Another tab's write landed since this tab last knew the on-disk version — reload before applying this one (no lost update). */
  stale: boolean;
  /** The state version currently on disk (0 if nothing has ever been saved). A write persists `onDiskVersion + 1`. */
  onDiskVersion: number;
}

export interface LockOutcome<T> {
  result: T;
  /** Did the callback persist a new snapshot? A plain read reports `false`: no version bump, no broadcast to other tabs. */
  wrote: boolean;
}

/**
 * Two tabs (plan §2.5, brief §2.2 "two tabs"): writes run under
 * `navigator.locks.request('mut-local', { mode: 'exclusive' })`, which
 * serializes same-origin callers across tabs, not just within one. Holding
 * the lock is necessary but not sufficient — a lock only orders *when* each
 * tab's turn runs, not what either tab's in-memory `MemoryLedgerStore` still
 * believes. `withLock` additionally compares the on-disk `stateVersion`
 * against what this instance last knew: if another tab wrote in between,
 * `stale` tells the caller to reload the snapshot (`persistence.load()` +
 * `store.restore(...)`) before applying its own change, so the two writes
 * stack instead of the second clobbering the first.
 *
 * After every write, a `BroadcastChannel` message lets other tabs invalidate
 * their own caches (Phase C's job) — a second, independent channel: the lock
 * only has to unblock a waiter in the posting tab's own lock manager, not
 * reach other tabs, which is exactly what `BroadcastChannel` is for.
 */
export class LocalLock {
  private readonly persistence: IndexedDbPersistence;
  private readonly lockName: string;
  private readonly channel: BroadcastChannel;
  private knownStateVersion = 0;

  constructor(persistence: IndexedDbPersistence, lockName: string = LOCK_NAME, channelName: string = CHANNEL_NAME) {
    this.persistence = persistence;
    this.lockName = lockName;
    this.channel = new BroadcastChannel(channelName);
  }

  /** Call once after a successful boot load, with the version just loaded, so the first `withLock` call isn't compared against a stale default of 0. */
  noteLoadedVersion(stateVersion: number): void {
    this.knownStateVersion = stateVersion;
  }

  async withLock<T>(fn: (context: LockContext) => Promise<LockOutcome<T>>): Promise<T> {
    return navigator.locks.request(this.lockName, { mode: 'exclusive' }, async () => {
      const onDisk = await this.persistence.peekVersion();
      const onDiskVersion = onDisk?.stateVersion ?? 0;
      const stale = onDiskVersion > this.knownStateVersion;

      const { result, wrote } = await fn({ stale, onDiskVersion });

      this.knownStateVersion = wrote ? onDiskVersion + 1 : Math.max(this.knownStateVersion, onDiskVersion);
      if (wrote) this.channel.postMessage({ type: 'written', stateVersion: this.knownStateVersion });
      return result;
    });
  }

  /** Phase C invalidates its query cache on this. */
  onRemoteWrite(handler: (stateVersion: number) => void): () => void {
    const listener = (event: MessageEvent<{ type: 'written'; stateVersion: number }>): void => {
      if (event.data?.type === 'written') handler(event.data.stateVersion);
    };
    this.channel.addEventListener('message', listener);
    return () => this.channel.removeEventListener('message', listener);
  }

  close(): void {
    this.channel.close();
  }
}
