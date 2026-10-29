import { describe, expect, it } from 'vitest';
import { addDays, type IsoDate } from '../../dates.js';
import { buildStatement, encodeStatementCursor, type StatementCursor, type StatementPage, type StatementView } from '../build.js';
import { DRIVER_OPS, driveLedger, rng, type DrivenLedger } from './ledger-driver.js';
import { legacyBuildStatement } from './legacy-build.js';

/**
 * MUT-483 (eng review R1, step 0): the statement builder, whatever is extracted from it, returns exactly what the
 * frozen pre-extraction copy returns. Over 500 organizations built from real writes (R2), for every customer and
 * currency, with and without each project, over a random period and a random page size walked to the end: every line
 * (all fields, its id, atMs and rank), the opening balance, the totals, the closing balance and every cursor.
 */
const SEEDS = 500;

/** A random bound in or around the data: null, or a day within ~4 months either side of asOf. */
function bound(r: () => number, asOf: IsoDate): IsoDate | null {
  return r() < 0.25 ? null : addDays(asOf, Math.floor(r() * 300) - 200);
}

type Builder = (s: Parameters<typeof buildStatement>[0], v: StatementView, p: { limit: number; cursor: StatementCursor | null }) => StatementPage;

/** Every page from the first to the last, with the cursor each one hands on (encoded, as the wire carries it). */
function walk(build: Builder, sources: Parameters<typeof buildStatement>[0], view: StatementView, limit: number) {
  const pages: Array<{ page: StatementPage; encoded: string | null }> = [];
  let cursor: StatementCursor | null = null;
  for (let i = 0; i < 10_000; i++) {
    const page = build(sources, view, { limit, cursor });
    pages.push({ page, encoded: page.nextCursor ? encodeStatementCursor(page.nextCursor) : null });
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return pages;
}

async function compareAll(d: DrivenLedger): Promise<number> {
  const r = rng(d.seed * 7919 + 1);
  let compared = 0;
  for (const customerId of d.customers) {
    for (const currency of d.currencies) {
      const sources = await d.store.receivables.statementSources(d.organization.id, customerId, currency);
      for (const projectId of [null, d.projects.get(customerId)!.get(currency)!]) {
        let from = bound(r, d.asOf);
        let to = bound(r, d.asOf);
        if (from && to && from > to) [from, to] = [to, from];
        const view: StatementView = { asOf: d.asOf, timezone: d.organization.timezone, from, to, projectId };
        const limit = 1 + Math.floor(r() * 50);
        const now = walk(buildStatement, sources, view, limit);
        const legacy = walk(legacyBuildStatement, sources, view, limit);
        expect(now, `seed ${d.seed} customer ${customerId} ${currency} project ${projectId} ${from}..${to} limit ${limit}`).toEqual(legacy);
        compared += legacy.reduce((n, p) => n + p.page.lines.length, 0);
      }
    }
  }
  return compared;
}

describe('buildStatement equals the frozen pre-extraction builder (MUT-483 R1)', () => {
  it(`over ${SEEDS} driven organizations, every customer × currency × project view, period and page size`, async () => {
    let lines = 0;
    const made = new Set<string>();
    for (let seed = 1; seed <= SEEDS; seed++) {
      const d = await driveLedger(seed);
      for (const op of Object.keys(d.ops)) made.add(op);
      lines += await compareAll(d);
    }
    // The comparison is not vacuous: the driven ledgers carry thousands of lines, and every kind of write happened.
    expect(lines).toBeGreaterThan(5_000);
    expect([...made].sort()).toEqual([...DRIVER_OPS].sort());
  }, 300_000);
});
