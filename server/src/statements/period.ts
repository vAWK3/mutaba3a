import type { IsoDate } from '../dates.js';
import type { LedgerEntry } from './lines.js';

/**
 * A period's figures (MUT-483, ADR-227): the statement's lines, summed across the organization per currency. One pass
 * over `ledgerEntries`, no sort, no store, no clock: a line before `from` adds to the opening balance, a line in
 * [from, to] adds to its kind's total, a line after `to` is ignored.
 *
 * - billed = CHARGE lines (gross), credited = CREDIT lines, payments = PAYMENT lines, reversals = PAYMENT_REVERSAL lines.
 * - closing = opening + billed + reversals − credited − payments, so closing − opening = billed − received − credited
 *   with received = payments − reversals (AC2), by construction; the tests compute both ends from the lines instead.
 */
export interface PeriodTotals {
  currency: string;
  openingMinor: bigint;
  billedMinor: bigint;
  creditedMinor: bigint;
  paymentsMinor: bigint;
  reversalsMinor: bigint;
  closingMinor: bigint;
}

/**
 * With `currency`, exactly one block, all zeros if nothing exists (S4, R12). Without it, one block per currency with
 * a line in the period or a non-zero opening or closing balance, sorted by code: a currency settled long ago with no
 * activity gets no block of zeros. Never summed across currencies (ADR-004).
 */
export function summarizePeriod(entries: readonly LedgerEntry[], period: { from: IsoDate; to: IsoDate }, currency: string | null): PeriodTotals[] {
  const blocks = new Map<string, { totals: PeriodTotals; active: boolean }>();
  const blockOf = (code: string) => {
    let b = blocks.get(code);
    if (!b) blocks.set(code, (b = { totals: { currency: code, openingMinor: 0n, billedMinor: 0n, creditedMinor: 0n, paymentsMinor: 0n, reversalsMinor: 0n, closingMinor: 0n }, active: false }));
    return b;
  };
  if (currency !== null) blockOf(currency);
  for (const e of entries) {
    if ((currency !== null && e.currency !== currency) || e.date > period.to) continue;
    const b = blockOf(e.currency);
    if (e.date < period.from) {
      b.totals.openingMinor += e.debitMinor - e.creditMinor;
      continue;
    }
    b.active = true;
    if (e.kind === 'CHARGE') b.totals.billedMinor += e.debitMinor;
    else if (e.kind === 'CREDIT') b.totals.creditedMinor += e.creditMinor;
    else if (e.kind === 'PAYMENT') b.totals.paymentsMinor += e.creditMinor;
    else b.totals.reversalsMinor += e.debitMinor;
  }
  const result: PeriodTotals[] = [];
  for (const { totals: t, active } of blocks.values()) {
    t.closingMinor = t.openingMinor + t.billedMinor + t.reversalsMinor - t.creditedMinor - t.paymentsMinor;
    if (currency !== null || active || t.openingMinor !== 0n || t.closingMinor !== 0n) result.push(t);
  }
  return result.sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
}
