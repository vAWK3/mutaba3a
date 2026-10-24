import type { PrismaClient } from '@prisma/client';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Forced-overlap helpers for the expense row lock (MUT-389, MUT-397). A `holder` connection takes the expense's lock
 * and makes a competing change under it; a `prober` connection watches pg_blocking_pids until the operations under
 * test are queued on that lock, so a test never depends on timing (or on how loaded the machine is).
 */
export function expenseLockHarness(holder: PrismaClient, prober: PrismaClient) {
  /**
   * Holds the expense's row lock, runs `change` under it, and commits on release(). `isLocked` resolves with the
   * holder's backend pid, or rejects with `change`'s error instead of leaving the test to time out.
   */
  function holdExpense(expenseId: string, change: (tx: Tx) => Promise<unknown> = async () => undefined) {
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let locked!: (pid: number) => void;
    let failed!: (error: unknown) => void;
    const isLocked = new Promise<number>((resolve, reject) => ((locked = resolve), (failed = reject)));
    const done = holder.$transaction(
      async (tx) => {
        try {
          const [me] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          await tx.$queryRaw`SELECT "id" FROM "expenses" WHERE "id" = ${expenseId}::uuid FOR NO KEY UPDATE`;
          await change(tx);
          locked(me!.pid);
        } catch (error) {
          failed(error);
          throw error;
        }
        await released;
      },
      { timeout: 30_000 },
    );
    // Reported through isLocked; the test still awaits `done` for a failed commit.
    done.catch(() => {});
    return { isLocked, release, done };
  }

  /**
   * Resolves once at least `waiters` sessions are queued behind this holder. Counted transitively: on a row lock only
   * the first waiter waits on the holder itself; the next ones wait on the tuple lock that first waiter holds.
   */
  async function blockedBy(holderPid: number, waiters = 1): Promise<void> {
    for (let i = 0; i < 500; i += 1) {
      const [row] = await prober.$queryRaw<Array<{ n: number }>>`
        WITH RECURSIVE queued(pid) AS (
          SELECT pid FROM pg_stat_activity WHERE ${holderPid}::int = ANY(pg_blocking_pids(pid))
          UNION
          SELECT a.pid FROM pg_stat_activity a JOIN queued q ON q.pid = ANY(pg_blocking_pids(a.pid))
        )
        SELECT count(*)::int AS n FROM queued`;
      if (row && row.n >= waiters) return;
      await sleep(20);
    }
    throw new Error(`fewer than ${waiters} session(s) ever waited on the expense lock`);
  }

  return { holdExpense, blockedBy };
}
