import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ClaimDeliveryInput, LedgerStore } from '../ports.js';

/**
 * MUT-359 storage contract (D2, D10, D16): the mail send log behind the caps and idempotency, and the suppression
 * list. Run against the memory store and Postgres. The Postgres database is shared by every test file, so each
 * test works in its own random window of time and its own digests: counts only ever see rows between `since` and `at`.
 */
export function describeLedgerStoreEmailContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 12);
  const digest = (v: string) => createHash('sha256').update(v).digest('hex');
  /** A random hour between 2100 and 2900, so no two tests share a counting window. */
  const base = () => new Date(Date.UTC(2100 + Math.floor(Math.random() * 800), Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 27), Math.floor(Math.random() * 20)));
  const minutes = (from: Date, n: number) => new Date(from.getTime() + n * 60_000);
  const DAY = 24 * 60;

  function claim(at: Date, overrides: Partial<ClaimDeliveryInput> = {}): ClaimDeliveryInput {
    return {
      keyDigest: digest(`key-${unique()}`),
      recipientDigest: digest(`${unique()}@example.test`),
      template: 'password-changed',
      locale: 'en',
      at,
      since: minutes(at, -DAY),
      staleBefore: minutes(at, -10),
      limit: { total: 100, perRecipient: 100 },
      ...overrides,
    };
  }

  describe(`${name} LedgerStore email contract (MUT-359)`, () => {
    it('suppresses an address once and keeps the first reason', async () => {
      const store = await makeStore();
      const email = `bounce-${unique()}@example.test`;
      expect(await store.email.isSuppressed(email)).toBe(false);
      expect(await store.email.suppress({ email, reason: 'HARD_BOUNCE', eventId: 'msg_1', at: base() })).toEqual({ created: true });
      expect(await store.email.suppress({ email, reason: 'COMPLAINT', eventId: 'msg_2', at: base() })).toEqual({ created: false });
      expect(await store.email.isSuppressed(email)).toBe(true);
      expect(await store.email.isSuppressed(`other-${unique()}@example.test`)).toBe(false);
    });

    it('claims a key once; a sent or fresh pending key is a duplicate', async () => {
      const store = await makeStore();
      const at = base();
      const input = claim(at);
      const first = await store.email.claimDelivery(input);
      expect(first.status).toBe('claimed');
      expect(await store.email.claimDelivery({ ...input, at: minutes(at, 1), since: minutes(at, 1 - DAY), staleBefore: minutes(at, -9) })).toEqual({ status: 'duplicate' });
      if (first.status !== 'claimed') return;
      await store.email.finishDelivery(first.id, { providerId: 'res_1', at: minutes(at, 1) });
      expect(await store.email.claimDelivery({ ...input, at: minutes(at, 60), since: minutes(at, 60 - DAY), staleBefore: minutes(at, 50) })).toEqual({ status: 'duplicate' });
    });

    it('claims a failed key again, and a pending one once it is stale', async () => {
      const store = await makeStore();
      const at = base();
      const failedInput = claim(at);
      const failed = await store.email.claimDelivery(failedInput);
      if (failed.status !== 'claimed') throw new Error('expected a claim');
      await store.email.finishDelivery(failed.id, { error: 'rejected', uncertain: false, at });
      expect((await store.email.claimDelivery({ ...failedInput, at: minutes(at, 1) })).status).toBe('claimed');

      const crashedInput = claim(at);
      expect((await store.email.claimDelivery(crashedInput)).status).toBe('claimed');
      const later = minutes(at, 11);
      expect((await store.email.claimDelivery({ ...crashedInput, at: later, since: minutes(later, -DAY), staleBefore: minutes(later, -10) })).status).toBe('claimed');
    });

    it('caps the window: the claim that would reach the total is refused, and old rows stop counting', async () => {
      const store = await makeStore();
      const at = base();
      const limit = { total: 3, perRecipient: 100 };
      for (let i = 0; i < 3; i++) expect((await store.email.claimDelivery(claim(minutes(at, i), { since: minutes(at, i - DAY), limit }))).status).toBe('claimed');
      expect(await store.email.claimDelivery(claim(minutes(at, 3), { since: minutes(at, 3 - DAY), limit }))).toEqual({ status: 'capped', scope: 'global' });
      // A bigger total (a security mail's reserve) still fits.
      expect((await store.email.claimDelivery(claim(minutes(at, 3), { since: minutes(at, 3 - DAY), limit: { total: 4, perRecipient: 100 } }))).status).toBe('claimed');
      // A day after the first claim, it has left the window.
      const nextDay = minutes(at, DAY + 1);
      expect((await store.email.claimDelivery(claim(nextDay, { since: minutes(nextDay, -DAY), limit: { total: 4, perRecipient: 100 } }))).status).toBe('claimed');
    });

    it('does not count failed sends toward the cap', async () => {
      const store = await makeStore();
      const at = base();
      const limit = { total: 1, perRecipient: 100 };
      const first = await store.email.claimDelivery(claim(at, { limit }));
      if (first.status !== 'claimed') throw new Error('expected a claim');
      await store.email.finishDelivery(first.id, { error: 'rejected', uncertain: false, at });
      expect((await store.email.claimDelivery(claim(minutes(at, 1), { since: minutes(at, 1 - DAY), limit }))).status).toBe('claimed');
    });

    it('keeps counting an uncertain send (a timeout), which may still be claimed again', async () => {
      const store = await makeStore();
      const at = base();
      const limit = { total: 1, perRecipient: 100 };
      const input = claim(at, { limit });
      const first = await store.email.claimDelivery(input);
      if (first.status !== 'claimed') throw new Error('expected a claim');
      await store.email.finishDelivery(first.id, { error: 'timeout', uncertain: true, at });
      expect(await store.email.claimDelivery(claim(minutes(at, 1), { since: minutes(at, 1 - DAY), limit }))).toEqual({ status: 'capped', scope: 'global' });
      expect((await store.email.claimDelivery({ ...input, at: minutes(at, 1), limit: { total: 2, perRecipient: 100 } })).status).toBe('claimed');
    });

    it('caps one recipient without touching another, and never a mail outside the recipient cap', async () => {
      const store = await makeStore();
      const at = base();
      const recipientDigest = digest(`${unique()}@example.test`);
      const limit = { total: 100, perRecipient: 2 };
      for (let i = 0; i < 2; i++) expect((await store.email.claimDelivery(claim(minutes(at, i), { since: minutes(at, i - DAY), recipientDigest, limit }))).status).toBe('claimed');
      expect(await store.email.claimDelivery(claim(minutes(at, 2), { since: minutes(at, 2 - DAY), recipientDigest, limit }))).toEqual({ status: 'capped', scope: 'recipient' });
      expect((await store.email.claimDelivery(claim(minutes(at, 2), { since: minutes(at, 2 - DAY), limit }))).status).toBe('claimed');
      expect((await store.email.claimDelivery(claim(minutes(at, 3), { since: minutes(at, 3 - DAY), recipientDigest, limit: { total: 100, perRecipient: null } }))).status).toBe('claimed');
    });

    it('answers a concurrent claim of the same key as a duplicate, never an error', async () => {
      const store = await makeStore();
      const input = claim(base());
      const results = await Promise.all([store.email.claimDelivery(input), store.email.claimDelivery(input), store.email.claimDelivery(input)]);
      expect(results.filter((r) => r.status === 'claimed')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'duplicate')).toHaveLength(2);
    });

    it('prunes rows created before a time', async () => {
      const store = await makeStore();
      const at = base();
      const oldInput = claim(at);
      const old = await store.email.claimDelivery(oldInput);
      const recent = claim(minutes(at, 60));
      await store.email.claimDelivery(recent);
      if (old.status !== 'claimed') throw new Error('expected a claim');
      await store.email.finishDelivery(old.id, { providerId: 'res_old', at });
      expect(await store.email.pruneDeliveries(minutes(at, 30))).toBeGreaterThanOrEqual(1);
      // The pruned key is gone, so it can be claimed again (a SENT key would otherwise be a duplicate for good); the recent one is still a duplicate.
      expect((await store.email.claimDelivery({ ...claim(minutes(at, 61)), keyDigest: oldInput.keyDigest })).status).toBe('claimed');
      expect((await store.email.claimDelivery({ ...claim(minutes(at, 61)), keyDigest: recent.keyDigest })).status).toBe('duplicate');
    });
  });
}
