import type { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { PrismaLedgerStore } from '../prisma.js';

/**
 * MUT-270 review (D1): the feed's per-organization queries share a small pool (connection_limit 10), so one request
 * never has more than 4 in flight — one organization at a time, its 4 kinds in parallel — however many profiles the
 * person belongs to.
 */
describe('Prisma entries.list fan-out', () => {
  it.each(['createdAt', 'occurredOn'] as const)('never has more than 4 queries in flight, and still reads every organization and kind (order %s)', async (order) => {
    let inFlight = 0;
    let peak = 0;
    const seen: string[] = [];
    const tableOf = (table: string) => ({
      findMany: async (args: { where: { organizationId: string } }) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        seen.push(`${table}:${args.where.organizationId}`);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight--;
        return [];
      },
    });
    const prisma = { expense: tableOf('expense'), payment: tableOf('payment'), receivable: tableOf('receivable'), conversion: tableOf('conversion') } as unknown as PrismaClient;
    const organizationIds = Array.from({ length: 10 }, (_, i) => `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`);

    const page = await new PrismaLedgerStore(prisma).entries.list(organizationIds, { limit: 20, cursor: null, order });

    expect(page).toEqual({ items: [], nextCursor: null });
    expect(peak).toBeLessThanOrEqual(4);
    expect(seen).toHaveLength(40);
  });
});
