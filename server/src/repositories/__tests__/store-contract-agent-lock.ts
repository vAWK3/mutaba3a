import { describe, expect, it } from 'vitest';
import type { LedgerStore } from '../ports.js';

/**
 * MUT-437 (review D15): one agent expense write at a time per person, so two parallel tool calls for the same purchase
 * cannot both pass the look-alike check. The contract: runs for one person never overlap; runs for different people do;
 * a run that throws still lets the next one in.
 */
export function describeLedgerStoreAgentLockContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 100));
  const deferred = () => {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => (release = resolve));
    return { promise, release };
  };
  const person = () => crypto.randomUUID();

  describe(`${name} LedgerStore agent write lock (MUT-437)`, () => {
    it('serialises runs for one person and lets another person run alongside', async () => {
      const store = await makeStore();
      const [nour, rami] = [person(), person()];
      const order: string[] = [];
      const gate = deferred();

      const first = store.agentWriteLock.run(nour, async () => {
        order.push('first:start');
        await gate.promise;
        order.push('first:end');
        return 1;
      });
      await tick();
      const second = store.agentWriteLock.run(nour, async () => {
        order.push('second');
        return 2;
      });
      const other = store.agentWriteLock.run(rami, async () => {
        order.push('other');
        return 3;
      });
      expect(await other).toBe(3);
      await tick();
      expect(order).toEqual(['first:start', 'other']);

      gate.release();
      expect(await Promise.all([first, second])).toEqual([1, 2]);
      expect(order).toEqual(['first:start', 'other', 'first:end', 'second']);
    });

    it('releases the lock when a run throws', async () => {
      const store = await makeStore();
      const nour = person();
      await expect(store.agentWriteLock.run(nour, async () => Promise.reject(new Error('refused')))).rejects.toThrow('refused');
      expect(await store.agentWriteLock.run(nour, async () => 'next')).toBe('next');
    });
  });
}
