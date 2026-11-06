import type { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { PrismaLedgerStore } from '../prisma.js';

/**
 * MUT-575 (plan test 4): the client list's stats cost two queries in all, however many clients the accountant reads —
 * one grouped count over the money-date indexes and one newest-logged read — never one read per client.
 */
describe('Prisma entries.clientActivity cost', () => {
  it('reads 10 clients’ stats in exactly 2 queries, and no per-client entry read', async () => {
    let raw = 0;
    let perTable = 0;
    const organizationIds = Array.from({ length: 10 }, (_, i) => `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`);
    const table = { findMany: async () => (perTable++, []), count: async () => (perTable++, 0), findFirst: async () => (perTable++, null) };
    const prisma = {
      $queryRaw: async () => {
        raw++;
        // The first answers counts, the second the newest logged instant; one row per client for each.
        return raw === 1
          ? organizationIds.map((organizationId, i) => ({ organizationId, count: BigInt(i) }))
          : organizationIds.map((organizationId, i) => ({ organizationId, last: i === 0 ? null : new Date(Date.UTC(2026, 10, i)) }));
      },
      expense: table,
      payment: table,
    } as unknown as PrismaClient;

    const activity = await new PrismaLedgerStore(prisma).entries.clientActivity(organizationIds.map((organizationId) => ({ organizationId, from: '2026-11-01', before: '2026-12-01' })));

    expect(raw).toBe(2);
    expect(perTable).toBe(0);
    expect(activity.size).toBe(10);
    expect(activity.get(organizationIds[0]!)).toEqual({ entriesThisMonth: 0, lastActivityAt: null });
    expect(activity.get(organizationIds[3]!)).toEqual({ entriesThisMonth: 3, lastActivityAt: new Date(Date.UTC(2026, 10, 3)) });
  });

  it('asks nothing for no clients', async () => {
    let raw = 0;
    const prisma = { $queryRaw: async () => (raw++, []) } as unknown as PrismaClient;
    expect((await new PrismaLedgerStore(prisma).entries.clientActivity([])).size).toBe(0);
    expect(raw).toBe(0);
  });
});
