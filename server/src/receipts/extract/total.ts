import { moneyIn } from './amounts.js';
import { isConfident } from './confidence.js';
import { CARD_SLIP, CASH, CHANGE, DISCOUNT, hasKeyword, INCLUSIVE, type KeywordSet, NOT_TOTAL, REGISTRATION, SUBTOTAL, TOTAL, VAT } from './keywords.js';
import { confOf, labelConf } from './rows.js';
import type { Row } from './types.js';

/**
 * MUT-441: the total, the VAT and its rate. A total-labelled row first; the receipt's own arithmetic (subtotal + VAT,
 * cash − change) confirms it, and stands in for it only when no labelled total survived OCR (the MUT-253 spike's
 * lesson). The largest amount alone is never a total, unless the receipt also adds it up from two printed amounts or
 * repeats it on several rows, with no discount and not as cash tendered (MUT-504). Pure.
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
const RULE_REPEATED_LARGEST = 0.7;
const RULE_SUM_OF_TWO = 0.75;
/** Total-labelled rows with this many different amounts are a statement's monthly lines, not one receipt (MUT-504). */
const STATEMENT_TOTALS = 3;
/** A till receipt prints its total on the to-pay row, the card row and the card slip: three readings at least (MUT-504). */
const MIN_REPEATS = 3;
/** Repeated readings count only across this many rows: one row can print an amount twice (quantity × price). */
const MIN_REPEAT_ROWS = 2;
/** Past this many distinct amounts the pairwise rules are skipped: a statement, not a receipt, and O(n²) (MUT-504). */
const MAX_PAIRWISE_AMOUNTS = 500;
/** A VAT-exempt line ("amounts at 0% VAT") is neither the subtotal nor the VAT. */
const ZERO_RATE = /(?<![\d.])0(?:\.0+)?\s*%/;
const RULE_VAT = 0.8;
const RULE_VAT_CONFIRMED = 0.92;
const RULE_VAT_RATE = 0.85;
/** A VAT rate above this is a misread, not a rate. */
const MAX_VAT_RATE_PERCENT = 30;
/** Rounding on the receipt: one minor unit either way still agrees. */
const ROUNDING = 1n;

const isVatRow = (row: Row) => hasKeyword(row.folded, VAT) && !hasKeyword(row.folded, INCLUSIVE) && !hasKeyword(row.folded, NOT_TOTAL) && !hasKeyword(row.folded, REGISTRATION) && !/invoice|חשבונית|فاتورة/.test(row.folded);
const isPayment = (row: Row) => hasKeyword(row.folded, CASH) || hasKeyword(row.folded, CHANGE);
const isTotalRow = (row: Row) => (hasKeyword(row.folded, TOTAL) || hasKeyword(row.folded, CARD_SLIP)) && !hasKeyword(row.folded, NOT_TOTAL) && !isVatRow(row) && !isPayment(row);
const isSubtotalRow = (row: Row) => hasKeyword(row.folded, SUBTOTAL) && !isVatRow(row) && !ZERO_RATE.test(row.text);

const last = (values: readonly bigint[]): bigint | null => values[values.length - 1] ?? null;
const max = (values: readonly bigint[]): bigint | null => (values.length ? values.reduce((a, b) => (a > b ? a : b)) : null);
const min = (values: readonly bigint[]): bigint | null => (values.length ? values.reduce((a, b) => (a < b ? a : b)) : null);
const near = (a: bigint, b: bigint) => (a > b ? a - b : b - a) <= ROUNDING;

/** How sure the reader was of `minor` on the row: the box it was printed in (MUT-504), else the row's least. */
function amountConf(row: Row, minor: bigint, exponent: number | null, integers: boolean): number {
  return confOf(row, (part) => moneyIn(part.text, exponent, integers).includes(minor));
}

interface Labelled {
  minor: bigint;
  row: Row;
  /** The lower of the amount's box and its label's box. */
  conf: number;
}

/**
 * The amount on the first row matching `match`: its last amount (labels come first in reading order), or its smallest
 * where `smallest` says (a VAT row OCR joined with the total's row holds both; the VAT is the smaller, MUT-504).
 */
function firstAmount(rows: readonly Row[], match: (row: Row) => boolean, labels: KeywordSet, exponent: number | null, integers: boolean, smallest: (row: Row) => boolean = () => false): Labelled | null {
  for (const row of rows) {
    if (!match(row)) continue;
    const amounts = moneyIn(row.text, exponent, integers);
    const minor = smallest(row) ? min(amounts) : last(amounts);
    if (minor !== null) return { minor, row, conf: Math.min(amountConf(row, minor, exponent, integers), labelConf(row, labels)) };
  }
  return null;
}

interface Parts {
  subtotal: Labelled | null;
  vat: Labelled | null;
  rateBasisPoints: number | null;
  cash: Labelled | null;
  change: Labelled | null;
  /** Every decimal amount on the receipt, with the confidence of its box and the row it is on. */
  all: Array<{ minor: bigint; conf: number; row: Row }>;
  /** Whether a bare integer on a labelled row may be money: only when the receipt prints no decimal amount at all. */
  integers: boolean;
}

function vatRateOn(row: Row): number | null {
  const match = /(\d{1,2}(?:\.\d{1,2})?)\s*%|%\s*(\d{1,2}(?:\.\d{1,2})?)/.exec(row.text);
  const percent = Number(match?.[1] ?? match?.[2]);
  return percent > 0 && percent <= MAX_VAT_RATE_PERCENT ? Math.round(percent * 100) : null;
}

function partsOf(rows: readonly Row[], exponent: number | null): Parts {
  const all = rows.flatMap((row) => moneyIn(row.text, exponent, false).map((minor) => ({ minor, conf: amountConf(row, minor, exponent, false), row })));
  // A receipt that prints its money with decimals and shows a bare integer on a labelled row has lost a decimal point
  // to OCR (MUT-441 benchmark: "15.01" read as 15001); taking it as whole units would fill a wrong amount.
  const integers = all.length === 0;
  const vat = firstAmount(rows, (r) => isVatRow(r) && !ZERO_RATE.test(r.text), VAT, exponent, integers, (r) => hasKeyword(r.folded, TOTAL));
  return {
    subtotal: firstAmount(rows, isSubtotalRow, SUBTOTAL, exponent, integers),
    vat,
    rateBasisPoints: vat ? vatRateOn(vat.row) : (rows.filter(isVatRow).map(vatRateOn).find((r) => r !== null) ?? null),
    cash: firstAmount(rows, (r) => hasKeyword(r.folded, CASH), CASH, exponent, integers),
    change: firstAmount(rows, (r) => hasKeyword(r.folded, CHANGE), CHANGE, exponent, integers),
    all,
    integers,
  };
}

/** Whether the receipt's own parts add up to `total`: 'guided' by their labels, 'loose' by any two other amounts, or not. */
function confirmation(total: bigint, parts: Parts): 'guided' | 'loose' | null {
  if (parts.subtotal && parts.vat && near(parts.subtotal.minor + parts.vat.minor, total)) return 'guided';
  if (parts.cash && parts.change && near(parts.cash.minor - parts.change.minor, total)) return 'guided';
  if (parts.vat && parts.rateBasisPoints && near((total * BigInt(parts.rateBasisPoints)) / BigInt(10_000 + parts.rateBasisPoints), parts.vat.minor)) return 'guided';
  const others = [...new Set(parts.all.map((a) => a.minor))].filter((a) => a !== total);
  if (others.length > MAX_PAIRWISE_AMOUNTS) return null;
  for (let i = 0; i < others.length; i += 1) {
    for (let j = 0; j < others.length; j += 1) {
      if (i !== j && (others[i]! + others[j]! === total || others[i]! - others[j]! === total)) return 'loose';
    }
  }
  return null;
}

function labelledTotal(rows: readonly Row[], parts: Parts, exponent: number | null): MoneyReading | null {
  const candidates = rows.filter(isTotalRow).flatMap((row) => {
    const minor = max(moneyIn(row.text, exponent, parts.integers));
    return minor === null ? [] : [{ row, minor }];
  });
  // A total-labelled amount that a larger total-labelled one equals plus another amount the receipt prints (its VAT,
  // a service charge) is a subtotal whose own label OCR misread.
  // A total-labelled amount that another one plus a printed discount equals is the amount before the discount (MUT-504).
  const discounts = new Set(rows.filter((r) => hasKeyword(r.folded, DISCOUNT)).flatMap((r) => moneyIn(r.text, exponent, parts.integers)));
  const printed = new Set([...parts.all.map((a) => a.minor), ...(parts.vat ? [parts.vat.minor] : [])]);
  const isSubtotal = (minor: bigint) => candidates.some((c) => c.minor > minor && printed.has(c.minor - minor) && !discounts.has(c.minor - minor));
  const isPreDiscount = (minor: bigint) => [...discounts].some((d) => candidates.some((c) => c.minor === minor - d));
  let best: MoneyReading | null = null;
  for (const { row, minor } of candidates) {
    if (isSubtotal(minor) || isPreDiscount(minor)) continue;
    const confirmed = confirmation(minor, parts);
    // A card slip alone can be one of two in a split payment: it is the total only when the receipt agrees with it.
    if (!hasKeyword(row.folded, TOTAL) && confirmed === null && rowsPrinting(parts, minor) < MIN_REPEAT_ROWS) continue;
    const rule = confirmed === 'guided' ? RULE_LABELLED_CONFIRMED : confirmed === 'loose' ? RULE_LABELLED_LOOSELY_CONFIRMED : RULE_LABELLED;
    const conf = Math.min(amountConf(row, minor, exponent, parts.integers), labelConf(row, TOTAL));
    const better = !best || rule * conf > best.rule * best.conf || (rule * conf === best.rule * best.conf && minor > best.minor);
    if (better) best = { minor, rule, conf, row };
  }
  return best;
}

/** No labelled total: subtotal + VAT, else cash − change, by their labels. */
function guidedTotal(parts: Parts): MoneyReading | null {
  if (parts.subtotal && parts.vat) {
    return { minor: parts.subtotal.minor + parts.vat.minor, rule: RULE_SUBTOTAL_PLUS_VAT, conf: Math.min(parts.subtotal.conf, parts.vat.conf), row: null };
  }
  if (parts.cash && parts.change && parts.cash.minor > parts.change.minor) {
    return { minor: parts.cash.minor - parts.change.minor, rule: RULE_CASH_MINUS_CHANGE, conf: Math.min(parts.cash.conf, parts.change.conf), row: null };
  }
  return null;
}

/** An amount two others add up to (or differ by), at least twice. */
function votedTotal(parts: Parts): MoneyReading | null {
  const votes = new Map<bigint, number>();
  const confByAmount = new Map(parts.all.map((a) => [a.minor, a.conf]));
  // Each value once (MUT-504): a total printed four times would otherwise vote for its own difference with the VAT.
  const amounts = [...confByAmount.keys()];
  if (amounts.length > MAX_PAIRWISE_AMOUNTS) return null;
  for (let i = 0; i < amounts.length; i += 1) {
    for (let j = i + 1; j < amounts.length; j += 1) {
      const [a, b] = [amounts[i]!, amounts[j]!];
      for (const candidate of [a + b, a > b ? a - b : b - a]) if (confByAmount.has(candidate) && candidate !== a && candidate !== b) votes.set(candidate, (votes.get(candidate) ?? 0) + 1);
    }
  }
  const agreed = [...votes].filter(([, n]) => n >= 2).sort(([a], [b]) => (a > b ? -1 : 1))[0];
  return agreed ? { minor: agreed[0], rule: RULE_TWO_AMOUNTS_AGREE, conf: confByAmount.get(agreed[0]) ?? 0, row: null } : null;
}

/** On how many distinct rows the receipt prints `minor`. */
function rowsPrinting(parts: Parts, minor: bigint): number {
  return new Set(parts.all.filter((a) => a.minor === minor).map((a) => a.row)).size;
}

/**
 * MUT-504: the receipt's largest amount and its readings, for the two rules that take it when no label or arithmetic
 * gives a total. None when the receipt prints a discount (its largest amount is then a pre-discount one) or when the
 * largest is on a cash or change row (cash tendered).
 */
function largestReadings(rows: readonly Row[], parts: Parts): { minor: bigint; readings: Parts['all']; rows: number } | null {
  if (rows.some((row) => hasKeyword(row.folded, DISCOUNT))) return null;
  const minor = max(parts.all.map((a) => a.minor));
  if (minor === null) return null;
  const readings = parts.all.filter((a) => a.minor === minor);
  if (readings.some((a) => isPayment(a.row))) return null;
  return { minor, readings, rows: rowsPrinting(parts, minor) };
}

const surestOf = (readings: Parts['all']) => Math.max(...readings.map((a) => a.conf));

/**
 * MUT-504: the receipt's largest amount is two other printed amounts added up (a subtotal and its VAT whose labels OCR
 * garbled), and either it is printed on two rows or one of the two is the labelled subtotal.
 */
function sumOfTwo(largest: ReturnType<typeof largestReadings>, parts: Parts): MoneyReading | null {
  if (!largest) return null;
  const others = new Set(parts.all.map((a) => a.minor).filter((a) => a !== largest.minor));
  if (others.size > MAX_PAIRWISE_AMOUNTS) return null;
  const subtotal = parts.subtotal?.minor;
  const adds = [...others].some((a) => {
    const b = largest.minor - a;
    return a < b && others.has(b) && (largest.rows >= MIN_REPEAT_ROWS || a === subtotal || b === subtotal);
  });
  return adds ? { minor: largest.minor, rule: RULE_SUM_OF_TWO, conf: surestOf(largest.readings), row: null } : null;
}

/** MUT-504: a statement lists a total per month; picking one would be a wrong total. */
function isStatement(rows: readonly Row[], exponent: number | null): boolean {
  const totals = new Set(rows.filter(isTotalRow).flatMap((row) => moneyIn(row.text, exponent, false).slice(-1)));
  return totals.size >= STATEMENT_TOTALS;
}

/**
 * MUT-504: no labelled total survived OCR and no arithmetic gives one, but the receipt prints its largest amount three
 * times or more, on two rows at least (a till receipt's to-pay row, card row and card slip; OCR can join the first
 * two into one row). Its surest reading is the confidence.
 */
function repeatedLargest(largest: ReturnType<typeof largestReadings>): MoneyReading | null {
  if (!largest || largest.readings.length < MIN_REPEATS || largest.rows < MIN_REPEAT_ROWS) return null;
  return { minor: largest.minor, rule: RULE_REPEATED_LARGEST, conf: surestOf(largest.readings), row: null };
}

/**
 * The first rule, strictest first, whose total is sure; else the first that gave one at all (left out later as unsure).
 * An unsure reading never blocks a sure one from a later rule (MUT-504), unless the unsure one came from a label or
 * the labelled arithmetic and names a different amount: the receipt then contradicts the later rule, so nothing is
 * suggested.
 */
function firstSure(rules: ReadonlyArray<{ read: () => MoneyReading | null; binding: boolean }>): MoneyReading | null {
  let fallback: MoneyReading | null = null;
  const bound: MoneyReading[] = [];
  for (const { read, binding } of rules) {
    const reading = read();
    if (reading && isConfident(reading.rule * reading.conf)) return bound.every((b) => near(b.minor, reading.minor)) ? reading : fallback;
    if (reading && binding) bound.push(reading);
    fallback ??= reading;
  }
  return fallback;
}

export interface MoneyFields {
  total: MoneyReading | null;
  vat: MoneyReading | null;
  vatRate: { basisPoints: number; rule: number; conf: number } | null;
}

export function readMoney(rows: readonly Row[], exponent: number | null): MoneyFields {
  const parts = partsOf(rows, exponent);
  const largest = largestReadings(rows, parts);
  const total = isStatement(rows, exponent)
    ? null
    : firstSure([
        { read: () => labelledTotal(rows, parts, exponent), binding: true },
        { read: () => guidedTotal(parts), binding: true },
        { read: () => votedTotal(parts), binding: false },
        { read: () => sumOfTwo(largest, parts), binding: false },
        { read: () => repeatedLargest(largest), binding: false },
      ]);
  const vatConfirmed = parts.vat && total && ((parts.subtotal && near(parts.subtotal.minor + parts.vat.minor, total.minor)) || confirmation(total.minor, parts) === 'guided');
  return {
    total,
    vat: parts.vat ? { minor: parts.vat.minor, rule: vatConfirmed ? RULE_VAT_CONFIRMED : RULE_VAT, conf: parts.vat.conf, row: parts.vat.row } : null,
    vatRate: parts.rateBasisPoints !== null && parts.vat ? { basisPoints: parts.rateBasisPoints, rule: RULE_VAT_RATE, conf: parts.vat.conf } : null,
  };
}
