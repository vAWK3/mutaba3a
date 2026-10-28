import { moneyIn } from './amounts.js';
import { CASH, CHANGE, hasKeyword, INCLUSIVE, NOT_TOTAL, REGISTRATION, SUBTOTAL, TOTAL, VAT } from './keywords.js';
import type { Row } from './types.js';

/**
 * MUT-441: the total, the VAT and its rate. A total-labelled row first; the receipt's own arithmetic (subtotal + VAT,
 * cash − change) confirms it, and stands in for it only when no labelled total survived OCR (the MUT-253 spike's
 * lesson). The largest amount alone is never a total. Pure.
 */

export interface MoneyReading {
  minor: bigint;
  rule: number;
  conf: number;
  /** The row the total was read from, for the currency it names. Null when the arithmetic produced it. */
  row: Row | null;
}

const RULE_LABELLED = 0.8;
const RULE_LABELLED_CONFIRMED = 0.95;
const RULE_LABELLED_LOOSELY_CONFIRMED = 0.85;
const RULE_SUBTOTAL_PLUS_VAT = 0.8;
const RULE_CASH_MINUS_CHANGE = 0.75;
const RULE_TWO_AMOUNTS_AGREE = 0.65;
const RULE_VAT = 0.8;
const RULE_VAT_CONFIRMED = 0.92;
const RULE_VAT_RATE = 0.85;
/** A VAT rate above this is a misread, not a rate. */
const MAX_VAT_RATE_PERCENT = 30;
/** Rounding on the receipt: one minor unit either way still agrees. */
const ROUNDING = 1n;

const isVatRow = (row: Row) => hasKeyword(row.folded, VAT) && !hasKeyword(row.folded, INCLUSIVE) && !hasKeyword(row.folded, NOT_TOTAL) && !hasKeyword(row.folded, REGISTRATION) && !/invoice|חשבונית|فاتورة/.test(row.folded);
const isPayment = (row: Row) => hasKeyword(row.folded, CASH) || hasKeyword(row.folded, CHANGE);
const isTotalRow = (row: Row) => hasKeyword(row.folded, TOTAL) && !hasKeyword(row.folded, NOT_TOTAL) && !isVatRow(row) && !isPayment(row);

const last = (values: readonly bigint[]): bigint | null => values[values.length - 1] ?? null;
const max = (values: readonly bigint[]): bigint | null => (values.length ? values.reduce((a, b) => (a > b ? a : b)) : null);
const near = (a: bigint, b: bigint) => (a > b ? a - b : b - a) <= ROUNDING;

/** The amount on the first row matching `match` (its last amount: labels come first in reading order). */
function firstAmount(rows: readonly Row[], match: (row: Row) => boolean, exponent: number | null): { minor: bigint; row: Row } | null {
  for (const row of rows) {
    if (!match(row)) continue;
    const minor = last(moneyIn(row.text, exponent, true));
    if (minor !== null) return { minor, row };
  }
  return null;
}

interface Parts {
  subtotal: { minor: bigint; row: Row } | null;
  vat: { minor: bigint; row: Row } | null;
  rateBasisPoints: number | null;
  cash: { minor: bigint; row: Row } | null;
  change: { minor: bigint; row: Row } | null;
  /** Every decimal amount on the receipt, with the confidence of its row. */
  all: Array<{ minor: bigint; conf: number }>;
}

function vatRateOn(row: Row): number | null {
  const match = /(\d{1,2}(?:\.\d{1,2})?)\s*%|%\s*(\d{1,2}(?:\.\d{1,2})?)/.exec(row.text);
  const percent = Number(match?.[1] ?? match?.[2]);
  return percent > 0 && percent <= MAX_VAT_RATE_PERCENT ? Math.round(percent * 100) : null;
}

function partsOf(rows: readonly Row[], exponent: number | null): Parts {
  const vat = firstAmount(rows, isVatRow, exponent);
  return {
    subtotal: firstAmount(rows, (r) => hasKeyword(r.folded, SUBTOTAL) && !isVatRow(r), exponent),
    vat,
    rateBasisPoints: vat ? vatRateOn(vat.row) : (rows.filter(isVatRow).map(vatRateOn).find((r) => r !== null) ?? null),
    cash: firstAmount(rows, (r) => hasKeyword(r.folded, CASH), exponent),
    change: firstAmount(rows, (r) => hasKeyword(r.folded, CHANGE), exponent),
    all: rows.flatMap((r) => moneyIn(r.text, exponent, false).map((minor) => ({ minor, conf: r.conf }))),
  };
}

/** Whether the receipt's own parts add up to `total`: 'guided' by their labels, 'loose' by any two other amounts, or not. */
function confirmation(total: bigint, parts: Parts): 'guided' | 'loose' | null {
  if (parts.subtotal && parts.vat && near(parts.subtotal.minor + parts.vat.minor, total)) return 'guided';
  if (parts.cash && parts.change && near(parts.cash.minor - parts.change.minor, total)) return 'guided';
  if (parts.vat && parts.rateBasisPoints && near((total * BigInt(parts.rateBasisPoints)) / BigInt(10_000 + parts.rateBasisPoints), parts.vat.minor)) return 'guided';
  const others = parts.all.map((a) => a.minor).filter((a) => a !== total);
  for (let i = 0; i < others.length; i += 1) {
    for (let j = 0; j < others.length; j += 1) {
      if (i !== j && (others[i]! + others[j]! === total || others[i]! - others[j]! === total)) return 'loose';
    }
  }
  return null;
}

function labelledTotal(rows: readonly Row[], parts: Parts, exponent: number | null): MoneyReading | null {
  let best: MoneyReading | null = null;
  for (const row of rows.filter(isTotalRow)) {
    const minor = max(moneyIn(row.text, exponent, true));
    if (minor === null) continue;
    const confirmed = confirmation(minor, parts);
    const rule = confirmed === 'guided' ? RULE_LABELLED_CONFIRMED : confirmed === 'loose' ? RULE_LABELLED_LOOSELY_CONFIRMED : RULE_LABELLED;
    const better = !best || rule * row.conf > best.rule * best.conf || (rule * row.conf === best.rule * best.conf && minor > best.minor);
    if (better) best = { minor, rule, conf: row.conf, row };
  }
  return best;
}

/** No labelled total: subtotal + VAT, else cash − change, else an amount two others add up to, at least twice. */
function arithmeticTotal(parts: Parts): MoneyReading | null {
  if (parts.subtotal && parts.vat) {
    return { minor: parts.subtotal.minor + parts.vat.minor, rule: RULE_SUBTOTAL_PLUS_VAT, conf: Math.min(parts.subtotal.row.conf, parts.vat.row.conf), row: null };
  }
  if (parts.cash && parts.change && parts.cash.minor > parts.change.minor) {
    return { minor: parts.cash.minor - parts.change.minor, rule: RULE_CASH_MINUS_CHANGE, conf: Math.min(parts.cash.row.conf, parts.change.row.conf), row: null };
  }
  const votes = new Map<bigint, number>();
  const confOf = new Map(parts.all.map((a) => [a.minor, a.conf]));
  const amounts = parts.all.map((a) => a.minor);
  for (let i = 0; i < amounts.length; i += 1) {
    for (let j = i + 1; j < amounts.length; j += 1) {
      const [a, b] = [amounts[i]!, amounts[j]!];
      for (const candidate of [a + b, a > b ? a - b : b - a]) if (confOf.has(candidate) && candidate !== a && candidate !== b) votes.set(candidate, (votes.get(candidate) ?? 0) + 1);
    }
  }
  const agreed = [...votes].filter(([, n]) => n >= 2).sort(([a], [b]) => (a > b ? -1 : 1))[0];
  return agreed ? { minor: agreed[0], rule: RULE_TWO_AMOUNTS_AGREE, conf: confOf.get(agreed[0]) ?? 0, row: null } : null;
}

export interface MoneyFields {
  total: MoneyReading | null;
  vat: MoneyReading | null;
  vatRate: { basisPoints: number; rule: number; conf: number } | null;
}

export function readMoney(rows: readonly Row[], exponent: number | null): MoneyFields {
  const parts = partsOf(rows, exponent);
  const total = labelledTotal(rows, parts, exponent) ?? arithmeticTotal(parts);
  const vatConfirmed = parts.vat && total && ((parts.subtotal && near(parts.subtotal.minor + parts.vat.minor, total.minor)) || confirmation(total.minor, parts) === 'guided');
  return {
    total,
    vat: parts.vat ? { minor: parts.vat.minor, rule: vatConfirmed ? RULE_VAT_CONFIRMED : RULE_VAT, conf: parts.vat.row.conf, row: parts.vat.row } : null,
    vatRate: parts.rateBasisPoints !== null && parts.vat ? { basisPoints: parts.rateBasisPoints, rule: RULE_VAT_RATE, conf: parts.vat.row.conf } : null,
  };
}
