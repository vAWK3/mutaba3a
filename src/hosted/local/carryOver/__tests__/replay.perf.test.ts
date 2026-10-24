import { describe, expect, it } from 'vitest';
import { prepareFromBackup } from '../index';
import { business, client, expense, freeAppBackup, income, payment } from './helpers/freeAppFixture';

/**
 * MUT-291 T-P1 (R5): a 20,000-record free-app device, carried end to end.
 * Off by default (it takes tens of seconds); run with CARRY_OVER_PERF=1 and
 * record the time and heap in the PR. Over 30 s on a mid laptop reopens the
 * Web Worker question.
 */
const RUN = process.env.CARRY_OVER_PERF === '1';

describe.skipIf(!RUN)('carry-over at 20,000 records (T-P1)', () => {
  it('prepares within 30 s', async () => {
    const clients = Array.from({ length: 200 }, (_, i) => client(`c${i}`, 'b1'));
    const transactions = Array.from({ length: 8_000 }, (_, i) => income(`t${i}`, 'b1', { clientId: `c${i % 200}`, receivedAmountMinor: i % 2 ? 5_000 : 0 }));
    const paymentRecords = transactions.filter((_, i) => i % 2).map((t) => payment(`r${t.id}`, t.id, 5_000, '2026-02-12'));
    const expenses = Array.from({ length: 7_800 }, (_, i) => expense(`e${i}`, 'b1'));
    const backup = freeAppBackup({ businessProfiles: [business('b1')], clients, transactions, paymentRecords, expenses });
    const heapBefore = process.memoryUsage().heapUsed;
    const started = performance.now();
    const prepared = await prepareFromBackup(backup, { now: () => new Date('2026-03-01T10:00:00Z'), timezone: 'Asia/Jerusalem', locale: 'en', labels: { noClient: 'No client', defaultBusiness: 'My business' } });
    const seconds = (performance.now() - started) / 1000;
    const heapMb = (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024;
    process.stdout.write(`\nT-P1: ${clients.length + transactions.length + paymentRecords.length + expenses.length} records in ${seconds.toFixed(1)} s, heap +${heapMb.toFixed(0)} MB\n`);
    expect(prepared.counts.expenses).toBe(7_800);
    expect(seconds).toBeLessThan(30);
  }, 120_000);
});
