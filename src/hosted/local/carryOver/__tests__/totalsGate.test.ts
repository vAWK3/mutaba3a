import { describe, expect, it, vi } from 'vitest';
import { CarryOverCheckFailed, prepareFromBackup } from '../index';
import { business, client, freeAppBackup, income, payment } from './helpers/freeAppFixture';

/**
 * MUT-291 E4 through `prepareFromBackup` itself: a replay that doesn't add up is never offered. The replay is the
 * real one, with one posted payment taken out of what it made, the way a bug in it would.
 */

vi.mock('../replay', async (original) => {
  const real = await original<typeof import('../replay')>();
  return {
    ...real,
    replayCarryOver: async (...args: Parameters<typeof real.replayCarryOver>) => {
      const result = await real.replayCarryOver(...args);
      const posted = [...result.snapshot.maps.pays.values()].find((p) => p.status === 'POSTED')!;
      result.snapshot.maps.pays.delete(posted.id);
      return result;
    },
  };
});

const OPTIONS = { now: () => new Date('2026-03-01T10:00:00.000Z'), timezone: 'Asia/Jerusalem', locale: 'en' as const, labels: { noClient: 'No client', defaultBusiness: 'My business' }, yieldToBrowser: async () => undefined };

describe('the totals gate (E4)', () => {
  it('refuses records that don\'t add up, and says which figure differed', async () => {
    const backup = freeAppBackup({
      businessProfiles: [business('b1', { isDefault: true })],
      clients: [client('c1', 'b1')],
      transactions: [income('t1', 'b1', { clientId: 'c1', receivedAmountMinor: 3_000 })],
      paymentRecords: [payment('r1', 't1', 3_000, '2026-02-11')],
    });
    const refused = prepareFromBackup(backup, OPTIONS);
    await expect(refused).rejects.toBeInstanceOf(CarryOverCheckFailed);
    const error = (await refused.catch((e: unknown) => e)) as CarryOverCheckFailed;
    expect(error.mismatches).toEqual(expect.arrayContaining([expect.objectContaining({ currency: 'ILS', field: 'paid', expected: 3_000n, actual: 0n })]));
  });
});
