/**
 * MUT-441 (F3): how a receipt's read is scheduled. `attempt` is the receipt's `readAttempts` when it was asked for:
 * Cloud Tasks names the task `<receiptId>-<attempt>`, so asking twice for the same attempt (a retried `complete`, a
 * sweep racing an upload) queues one task (R10 #7). Pure types and the in-process adapter only: the receipt routes
 * import this, and nothing here may pull a Google client into them.
 */
export interface ReadDispatcher {
  enqueue(receiptId: string, attempt: number): Promise<void>;
}

/**
 * Development, tests and the release-QA local API: the read runs in this process after the current request returns
 * (setImmediate), by calling the read function directly, never through the job route (which only takes Google's
 * OIDC tokens, R8). The same attempt asked twice while the first is still queued runs once, as Cloud Tasks would.
 */
export class InlineDispatcher implements ReadDispatcher {
  private run: ((receiptId: string) => Promise<unknown>) | null = null;
  private readonly queued = new Set<string>();
  private readonly running = new Set<Promise<unknown>>();
  private readonly delayMs: number;

  /**
   * `delayMs` (QA_READ_DELAY_MS, local QA only): wait this long before each read, standing in for Cloud Tasks' dispatch
   * and a cold start, so release-QA can see the portal's "Reading…" state before the fields fill. Default: no wait.
   */
  constructor(options: { delayMs?: number | undefined } = {}) {
    this.delayMs = options.delayMs ?? 0;
  }

  /** The read function; bound after construction because the reader itself takes this dispatcher. */
  bind(run: (receiptId: string) => Promise<unknown>): void {
    this.run = run;
  }

  async enqueue(receiptId: string, attempt: number): Promise<void> {
    const name = `${receiptId}-${attempt}`;
    if (this.queued.has(name)) return;
    this.queued.add(name);
    const task = new Promise<void>((resolve) => {
      const start = () => {
        this.queued.delete(name);
        // The reader logs and settles its own failures; a throw here would only be an unhandled rejection.
        void Promise.resolve(this.run?.(receiptId))
          .catch(() => undefined)
          .finally(() => resolve());
      };
      if (this.delayMs > 0) setTimeout(start, this.delayMs);
      else setImmediate(start);
    });
    this.running.add(task);
    void task.finally(() => this.running.delete(task));
  }

  /** Tests: wait until every queued read (and any it queued in turn) has finished. */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.all([...this.running]);
  }
}
