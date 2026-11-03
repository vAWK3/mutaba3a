import type { Currency } from '../../money.js';
import { moneyIn } from './amounts.js';
import { isConfident } from './confidence.js';
import { BALANCE, CARD_SLIP, CASH, CHANGE, DEPOSIT, DISCOUNT, hasKeyword, INCLUSIVE, isInstallment, type KeywordSet, NOT_TOTAL, PAID, REGISTRATION, SUBTOTAL, OTHER_TENDER, REFUND, TENDERED, TIP, TIP_APART, TOTAL, UNIT, VAT } from './keywords.js';
import { confOf, labelConf } from './rows.js';
import type { Row } from './types.js';

/**
 * MUT-441: the total, the VAT and its rate. A total-labelled row first; the receipt's own arithmetic (subtotal + VAT,
 * cash − change) confirms it, and stands in for it only when no labelled total survived OCR (the MUT-253 spike's
 * lesson). The largest amount alone is never a total, unless the receipt also adds it up from two printed amounts or
 * repeats it on several rows, with no discount and not as cash tendered (MUT-504). A VAT is filled only when something
 * independent of it confirms it: the rate (printed, or the currency's), or a labelled total less a labelled subtotal;
 * a tip, an instalment, cash tendered or change is never the total (MUT-514). Pure.
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
const RULE_VAT_CONFIRMED = 0.92;
/** MUT-514: the VAT as a labelled total less a labelled subtotal, at a rate the receipt prints or its currency charges. */
const RULE_VAT_DERIVED = 0.9;
const RULE_VAT_RATE = 0.85;
/** A VAT rate above this is a misread, not a rate. */
const MAX_VAT_RATE_PERCENT = 30;
/** MUT-514 (AC3): a VAT above this share of the total (in percent) is another amount, not the VAT. */
const MAX_VAT_SHARE_PERCENT = 20n;
/** Rounding on the receipt: one minor unit either way still agrees. */
const ROUNDING = 1n;
const BASIS = 10_000n;
/**
 * MUT-514 (D5, OV-9): the VAT rates (basis points) a currency's receipts charge, for a receipt that prints none.
 * Shekel receipts are Israeli (17%, 18% since 2025); a Palestinian 16% counts only when printed. The API's other
 * currencies have no single rate, and a receipt in one it doesn't take has no currency, so no rate is known for it.
 */
const KNOWN_VAT_RATES: Partial<Record<Currency, readonly number[]>> = { ILS: [1700, 1800], JOD: [1600] };

export function knownVatRates(currency: Currency | null): readonly number[] {
  return (currency && KNOWN_VAT_RATES[currency]) ?? [];
}

const isVatRow = (row: Row) => hasKeyword(row.folded, VAT) && !hasKeyword(row.folded, INCLUSIVE) && !hasKeyword(row.folded, NOT_TOTAL) && !hasKeyword(row.folded, REGISTRATION) && !/invoice|חשבונית|فاتورة/.test(row.folded);
/** "סה"כ שולם", "total paid": what was paid. Whether that is the total or cash handed over depends on the receipt (`rowKinds`). */
const isTotalPaid = (row: Row) => hasKeyword(row.folded, TOTAL) && hasKeyword(row.folded, PAID) && !hasKeyword(row.folded, TENDERED) && !hasKeyword(row.folded, CHANGE);
/**
 * MUT-514 (T3, OV-7): a tip or one instalment: a part of what was paid, never the total. A total that says the tip is
 * in it, or not in it ("Total before tip"), is still a total.
 */
const isPart = (row: Row) =>
  (hasKeyword(row.folded, TIP) && !(hasKeyword(row.folded, TOTAL) && (hasKeyword(row.folded, INCLUSIVE) || hasKeyword(row.folded, TIP_APART)))) || isInstallment(row.folded);
// MUT-540 (review): a row naming a unit (litres, a price per litre) holds a quantity or a unit price, never the total.
const isTotalLabelled = (row: Row) => (hasKeyword(row.folded, TOTAL) || hasKeyword(row.folded, CARD_SLIP)) && !hasKeyword(row.folded, NOT_TOTAL) && !hasKeyword(row.folded, UNIT) && !isVatRow(row);
const isSubtotalRow = (row: Row) => hasKeyword(row.folded, SUBTOTAL) && !isVatRow(row) && !ZERO_RATE.test(row.text);

/** What a receipt's rows are, for the total: decided once per receipt, as a "total paid" row depends on the others. */
interface RowKinds {
  /** A total-labelled row (or a card slip) that may give the total. */
  isTotal(row: Row): boolean;
  /** Cash handed over or change. */
  isPayment(row: Row): boolean;
  /**
   * MUT-514: amounts never the total and never voting for one: tips, instalments, cash tendered, change. A card slip
   * stays (OV-7: "סכום עסקה" beside a payment count).
   */
  neverTotal(row: Row): boolean;
}

/**
 * MUT-514 (T2): a "total paid" row is the total (`סה"כ שולם 70.00`, change 30.00, the 100.00 handed over printed apart)
 * only when no other row is total-labelled and, with change printed, paid + change is printed too; otherwise it is
 * the cash handed over (`Total 15.40`, `Total paid 20.00`, `Change 4.60`).
 */
function rowKinds(rows: readonly Row[], exponent: number | null): RowKinds {
  const printed = new Set(rows.flatMap((row) => moneyIn(row.text, exponent, false)));
  const integers = printed.size === 0;
  const amountsOf = (row: Row) => moneyIn(row.text, exponent, integers);
  const plainPayment = (row: Row) => (hasKeyword(row.folded, CASH) || hasKeyword(row.folded, CHANGE)) && !isTotalPaid(row);
  const otherTotal = rows.some((row) => isTotalLabelled(row) && !isTotalPaid(row) && !plainPayment(row) && amountsOf(row).length > 0);
  const change = rows.filter((row) => hasKeyword(row.folded, CHANGE)).flatMap(amountsOf)[0] ?? null;
  const paidIsTotal = (row: Row) => !otherTotal && (change === null || amountsOf(row).some((paid) => printed.has(paid + change)));
  const isPayment = (row: Row) => plainPayment(row) || (isTotalPaid(row) && !paidIsTotal(row));
  const neverTotal = (row: Row) => (isPart(row) || hasKeyword(row.folded, TENDERED) || hasKeyword(row.folded, CHANGE) || (isTotalPaid(row) && !paidIsTotal(row))) && !hasKeyword(row.folded, CARD_SLIP);
  return { isTotal: (row) => isTotalLabelled(row) && !isPayment(row) && !neverTotal(row), isPayment, neverTotal };
}

const last = (values: readonly bigint[]): bigint | null => values[values.length - 1] ?? null;
const max = (values: readonly bigint[]): bigint | null => (values.length ? values.reduce((a, b) => (a > b ? a : b)) : null);
const min = (values: readonly bigint[]): bigint | null => (values.length ? values.reduce((a, b) => (a < b ? a : b)) : null);
const near = (a: bigint, b: bigint, within: bigint = ROUNDING) => (a > b ? a - b : b - a) <= within;
/** MUT-514: the VAT is the rate (basis points) of `base`, the amount before VAT, within one minor unit. */
const vatOf = (vat: bigint, base: bigint, rate: number) => near(vat * BASIS, base * BigInt(rate), ROUNDING * BASIS);
/** MUT-514: the VAT is the share of `total`, the amount with VAT, that the rate gives, within one minor unit. */
const vatIn = (vat: bigint, total: bigint, rate: number) => near(vat * (BASIS + BigInt(rate)), total * BigInt(rate), ROUNDING * (BASIS + BigInt(rate)));
/** MUT-514 (AC3): a VAT is less than the total it is part of, and at most MAX_VAT_SHARE_PERCENT of it. */
const plausibleVat = (vat: bigint, total: bigint) => vat < total && vat * 100n <= total * MAX_VAT_SHARE_PERCENT;
/** MUT-514 (OV-6): an agorot rounding line (עיגול) moves a total this many minor units at most (50 agorot, 50 fils). */
const ROUNDING_LINE = 50n;

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
function firstAmount(
  rows: readonly Row[],
  match: (row: Row) => boolean,
  labels: KeywordSet,
  exponent: number | null,
  integers: boolean,
  smallest: (row: Row) => boolean = () => false,
  accept: (minor: bigint) => boolean = () => true,
): Labelled | null {
  for (const row of rows) {
    if (!match(row)) continue;
    const amounts = moneyIn(row.text, exponent, integers);
    const minor = smallest(row) ? min(amounts) : last(amounts);
    // MUT-514: an amount `accept` refuses (a "VAT" larger than a total allows) passes to the next matching row.
    if (minor !== null && accept(minor)) return { minor, row, conf: Math.min(amountConf(row, minor, exponent, integers), labelConf(row, labels)) };
  }
  return null;
}

interface Parts {
  subtotal: Labelled | null;
  vat: Labelled | null;
  rateBasisPoints: number | null;
  /** MUT-514: the rates a VAT may be checked against: the printed one when there is one (OV-9), else the currency's. */
  rates: readonly number[];
  cash: Labelled | null;
  change: Labelled | null;
  /** Every decimal amount on the receipt, with the confidence of its box and the row it is on. */
  all: Array<{ minor: bigint; conf: number; row: Row }>;
  /** MUT-514: `all` less the amounts on tip, instalment, cash-tendered and change rows: what may vote for a total. */
  voting: Parts['all'];
  /** The largest amount of each total-labelled row: the labelled totals the receipt prints. */
  labelled: Array<{ row: Row; minor: bigint }>;
  kinds: RowKinds;
  /** Whether a bare integer on a labelled row may be money: only when the receipt prints no decimal amount at all. */
  integers: boolean;
}

function vatRateOn(row: Row): number | null {
  const match = /(\d{1,2}(?:\.\d{1,2})?)\s*%|%\s*(\d{1,2}(?:\.\d{1,2})?)/.exec(row.text);
  const percent = Number(match?.[1] ?? match?.[2]);
  return percent > 0 && percent <= MAX_VAT_RATE_PERCENT ? Math.round(percent * 100) : null;
}

function partsOf(rows: readonly Row[], exponent: number | null, knownRates: readonly number[]): Parts {
  const kinds = rowKinds(rows, exponent);
  const all = rows.flatMap((row) => moneyIn(row.text, exponent, false).map((minor) => ({ minor, conf: amountConf(row, minor, exponent, false), row })));
  // A receipt that prints its money with decimals and shows a bare integer on a labelled row has lost a decimal point
  // to OCR (MUT-441 benchmark: "15.01" read as 15001); taking it as whole units would fill a wrong amount.
  const integers = all.length === 0;
  const labelled = rows.filter(kinds.isTotal).flatMap((row) => {
    const minor = max(moneyIn(row.text, exponent, integers));
    return minor === null ? [] : [{ row, minor }];
  });
  // MUT-514 (R8): a VAT row's amount must be less than every labelled total the receipt prints and a plausible share
  // of the largest (a split payment's card slips are smaller), else the row is another amount on a VAT-labelled row
  // (the total, or the amount before VAT) and the next VAT row is read.
  const largestLabelled = max(labelled.map((t) => t.minor));
  const plausible = (minor: bigint) => labelled.every((t) => minor < t.minor) && (largestLabelled === null || plausibleVat(minor, largestLabelled));
  const vat = firstAmount(rows, (r) => isVatRow(r) && !ZERO_RATE.test(r.text), VAT, exponent, integers, (r) => hasKeyword(r.folded, TOTAL), plausible);
  const subtotal = firstAmount(rows, isSubtotalRow, SUBTOTAL, exponent, integers);
  const rateBasisPoints = vat ? vatRateOn(vat.row) : (rows.filter(isVatRow).map(vatRateOn).find((r) => r !== null) ?? null);
  // MUT-514: an Israeli bill prints its rate on the subtotal row ("סה"כ סכומים ב-18% מע"מ"): a rate to check against,
  // though not the VAT row's own.
  const printedRate = rateBasisPoints ?? (subtotal ? vatRateOn(subtotal.row) : null);
  return {
    subtotal,
    vat,
    rateBasisPoints,
    rates: printedRate !== null ? [printedRate] : knownRates,
    cash: firstAmount(rows, (r) => hasKeyword(r.folded, CASH) && kinds.isPayment(r), CASH, exponent, integers),
    change: firstAmount(rows, (r) => hasKeyword(r.folded, CHANGE), CHANGE, exponent, integers),
    all,
    voting: all.filter((a) => !kinds.neverTotal(a.row)),
    labelled,
    kinds,
    integers,
  };
}

/**
 * Whether the receipt's own parts add up to `total`: 'guided' by their labels (subtotal + VAT, cash − change, the VAT
 * at its rate, MUT-514's subtotal at the rate), 'loose' by any two other amounts or by the subtotal at the rate within
 * an agorot rounding line (OV-6: never flips a total, never beats an exact match), or not.
 */
function confirmation(total: bigint, parts: Parts): 'guided' | 'loose' | null {
  const subtotal = parts.subtotal?.minor;
  const atRate = (within: bigint) => subtotal !== undefined && parts.rates.some((rate) => near(subtotal * (BASIS + BigInt(rate)), total * BASIS, within * BASIS));
  if (parts.subtotal && parts.vat && near(parts.subtotal.minor + parts.vat.minor, total)) return 'guided';
  if (parts.cash && parts.change && near(parts.cash.minor - parts.change.minor, total)) return 'guided';
  if (parts.vat && parts.rates.some((rate) => vatIn(parts.vat!.minor, total, rate))) return 'guided';
  if (atRate(ROUNDING)) return 'guided';
  if (atRate(ROUNDING_LINE)) return 'loose';
  const others = [...new Set(parts.all.map((a) => a.minor))].filter((a) => a !== total);
  if (others.length > MAX_PAIRWISE_AMOUNTS) return null;
  for (let i = 0; i < others.length; i += 1) {
    for (let j = 0; j < others.length; j += 1) {
      if (i !== j && (others[i]! + others[j]! === total || others[i]! - others[j]! === total)) return 'loose';
    }
  }
  return null;
}

/**
 * MUT-540 (E4, D6/D8): a card slip printed once is the total when nothing on the receipt says the payment was split: it
 * is the receipt's only card slip, no other total-labelled amount is printed, nothing is refunded, cancelled or paid as a
 * deposit, no row gives change, and no other tender (cash, a voucher, a cheque, Bit, points, another card) or balance
 * left to pay shows an amount other than the slip's. Then a till receipt whose own total lines OCR garbled still reads its total.
 */
function isLoneCardSlip(rows: readonly Row[], parts: Parts, row: Row, minor: bigint, exponent: number | null): boolean {
  if (!hasKeyword(row.folded, CARD_SLIP)) return false;
  // Another tender (cash, a voucher, a cheque, another card…) with an amount other than the slip's paid part of it.
  // A balance left to pay is part payment too (`יתרה 1500.00` beside a 500.00 slip).
  const otherPayment = (r: Row) => r !== row && (hasKeyword(r.folded, TENDERED) || hasKeyword(r.folded, OTHER_TENDER) || hasKeyword(r.folded, BALANCE)) && moneyIn(r.text, exponent, parts.integers).some((m) => m !== minor);
  const splitSign = (r: Row) => hasKeyword(r.folded, CHANGE) || hasKeyword(r.folded, REFUND) || hasKeyword(r.folded, DEPOSIT) || otherPayment(r);
  return rows.filter((r) => hasKeyword(r.folded, CARD_SLIP)).length === 1 && parts.labelled.every((c) => c.row === row) && !rows.some(splitSign);
}

function labelledTotal(rows: readonly Row[], parts: Parts, exponent: number | null, loneCardSlip: boolean): MoneyReading | null {
  const candidates = parts.labelled;
  // A total-labelled amount that a larger total-labelled one equals plus another amount the receipt prints (its VAT,
  // a service charge) is a subtotal whose own label OCR misread.
  // A total-labelled amount that another one plus a printed discount equals is the amount before the discount (MUT-504).
  const discounts = new Set(rows.filter((r) => hasKeyword(r.folded, DISCOUNT)).flatMap((r) => moneyIn(r.text, exponent, parts.integers)));
  // MUT-514: not change either (`Total 15.40` beside the 20.00 handed over and its 4.60 change).
  const payments = new Set(rows.filter(parts.kinds.isPayment).flatMap((r) => moneyIn(r.text, exponent, parts.integers)));
  const printed = new Set([...parts.all.map((a) => a.minor), ...(parts.vat ? [parts.vat.minor] : [])]);
  const isSubtotal = (minor: bigint) => candidates.some((c) => c.minor > minor && printed.has(c.minor - minor) && !discounts.has(c.minor - minor) && !payments.has(c.minor - minor));
  const isPreDiscount = (minor: bigint) => [...discounts].some((d) => candidates.some((c) => c.minor === minor - d));
  let best: MoneyReading | null = null;
  for (const { row, minor } of candidates) {
    if (isSubtotal(minor) || isPreDiscount(minor)) continue;
    const confirmed = confirmation(minor, parts);
    // A card slip alone can be one of two in a split payment: it is the total only when the receipt agrees with it, or
    // when nothing on it says the payment was split (MUT-540, E4).
    const agreed = confirmed !== null || rowsPrinting(parts, minor) >= MIN_REPEAT_ROWS || (loneCardSlip && isLoneCardSlip(rows, parts, row, minor, exponent));
    if (!hasKeyword(row.folded, TOTAL) && !agreed) continue;
    const rule = confirmed === 'guided' ? RULE_LABELLED_CONFIRMED : confirmed === 'loose' ? RULE_LABELLED_LOOSELY_CONFIRMED : RULE_LABELLED;
    // MUT-540: a card slip's label is its own box's, not the least sure speck on its row.
    const conf = Math.min(amountConf(row, minor, exponent, parts.integers), labelConf(row, hasKeyword(row.folded, TOTAL) ? TOTAL : CARD_SLIP));
    const better = !best || rule * conf > best.rule * best.conf || (rule * conf === best.rule * best.conf && minor > best.minor);
    if (better) best = { minor, rule, conf, row };
  }
  if (best && best.rule === RULE_LABELLED) return confirmedAlternative(rows, parts, exponent, best, (m) => isSubtotal(m) || isPreDiscount(m)) ?? best;
  return best;
}

/**
 * MUT-514 (T1, R8): a labelled total the receipt's arithmetic doesn't confirm loses to a different labelled amount
 * (on a total or balance row) that it does: by the labelled parts, or as an item amount plus its VAT at the rate (a
 * misread total beside its balance, `1050 + 18% = 1239`). A labelled total is never that base: a card's balance after
 * paying the total is not the total. With none, the unconfirmed one stands.
 */
function confirmedAlternative(rows: readonly Row[], parts: Parts, exponent: number | null, best: MoneyReading, skip: (minor: bigint) => boolean): MoneyReading | null {
  const totals = new Set(parts.labelled.map((t) => t.minor));
  const bases = [...new Set(parts.all.map((a) => a.minor))].filter((base) => !totals.has(base));
  const plusVat = (minor: bigint) => bases.some((base) => base < minor && parts.rates.some((rate) => near(base * (BASIS + BigInt(rate)), minor * BASIS, ROUNDING * BASIS)));
  const labelledRows = rows.filter((row) => parts.kinds.isTotal(row) || (hasKeyword(row.folded, BALANCE) && !parts.kinds.neverTotal(row) && !parts.kinds.isPayment(row)));
  for (const row of labelledRows) {
    for (const minor of moneyIn(row.text, exponent, parts.integers)) {
      if (minor === best.minor || skip(minor)) continue;
      if (confirmation(minor, parts) !== 'guided' && !plusVat(minor)) continue;
      const conf = Math.min(amountConf(row, minor, exponent, parts.integers), labelConf(row, hasKeyword(row.folded, BALANCE) ? BALANCE : TOTAL));
      return { minor, rule: RULE_LABELLED_CONFIRMED, conf, row };
    }
  }
  return null;
}

/**
 * No labelled total: subtotal + VAT, else cash − change, by their labels. MUT-514 (D9): subtotal + VAT only when the
 * VAT is the subtotal's at the rate; a misread VAT row would otherwise give a total and then confirm itself by it.
 */
function guidedTotal(parts: Parts): MoneyReading | null {
  if (parts.subtotal && parts.vat && parts.rates.some((rate) => vatOf(parts.vat!.minor, parts.subtotal!.minor, rate))) {
    return { minor: parts.subtotal.minor + parts.vat.minor, rule: RULE_SUBTOTAL_PLUS_VAT, conf: Math.min(parts.subtotal.conf, parts.vat.conf), row: null };
  }
  if (parts.cash && parts.change && parts.cash.minor > parts.change.minor) {
    return { minor: parts.cash.minor - parts.change.minor, rule: RULE_CASH_MINUS_CHANGE, conf: Math.min(parts.cash.conf, parts.change.conf), row: null };
  }
  return null;
}

/** An amount two others add up to (or differ by), at least twice. Tips, instalments, cash and change don't vote (MUT-514). */
function votedTotal(parts: Parts): MoneyReading | null {
  const votes = new Map<bigint, number>();
  const confByAmount = new Map(parts.voting.map((a) => [a.minor, a.conf]));
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
  // MUT-514: nor when it is printed as a tip or an instalment (three equal parts are not a total printed three times).
  if (readings.some((a) => parts.kinds.isPayment(a.row) || parts.kinds.neverTotal(a.row))) return null;
  return { minor, readings, rows: rowsPrinting(parts, minor) };
}

const surestOf = (readings: Parts['all']) => Math.max(...readings.map((a) => a.conf));

/**
 * MUT-504: the receipt's largest amount is two other printed amounts added up (a subtotal and its VAT whose labels OCR
 * garbled), and either it is printed on two rows or one of the two is the labelled subtotal.
 */
function sumOfTwo(largest: ReturnType<typeof largestReadings>, parts: Parts): MoneyReading | null {
  if (!largest) return null;
  const others = new Set(parts.voting.map((a) => a.minor).filter((a) => a !== largest.minor));
  if (others.size > MAX_PAIRWISE_AMOUNTS) return null;
  const subtotal = parts.subtotal?.minor;
  const adds = [...others].some((a) => {
    const b = largest.minor - a;
    return a < b && others.has(b) && (largest.rows >= MIN_REPEAT_ROWS || a === subtotal || b === subtotal);
  });
  return adds ? { minor: largest.minor, rule: RULE_SUM_OF_TWO, conf: surestOf(largest.readings), row: null } : null;
}

/** MUT-504: a statement lists a total per month; picking one would be a wrong total. */
function isStatement(rows: readonly Row[], parts: Parts, exponent: number | null): boolean {
  const totals = new Set(rows.filter(parts.kinds.isTotal).flatMap((row) => moneyIn(row.text, exponent, false).slice(-1)));
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
 * suggested. MUT-514 (T3): likewise when a looser rule's sure total and a later looser rule's sure total differ (a tip
 * two amounts differ by twice, against the card total printed on three rows): no rule is surer than the other.
 */
function firstSure(rules: ReadonlyArray<{ read: () => MoneyReading | null; binding: boolean }>): MoneyReading | null {
  let fallback: MoneyReading | null = null;
  const bound: MoneyReading[] = [];
  const sure = (reading: MoneyReading | null): reading is MoneyReading => reading !== null && isConfident(reading.rule * reading.conf);
  const disagrees = (reading: MoneyReading, other: MoneyReading | null) => sure(other) && !near(other.minor, reading.minor);
  for (const [i, { read, binding }] of rules.entries()) {
    const reading = read();
    if (sure(reading)) {
      const looserDisagrees = !binding && rules.slice(i + 1).some((later) => !later.binding && disagrees(reading, later.read()));
      return bound.every((b) => near(b.minor, reading.minor)) && !looserDisagrees ? reading : fallback;
    }
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

/**
 * MUT-514 (D5, D9): the VAT, only when something independent of the VAT row confirms it. First the VAT a labelled
 * total less a labelled subtotal gives, when the rate agrees (a VAT row that disagrees with it is a misread); else the
 * VAT row's amount, when it is the subtotal's or the total's at the rate, or the labelled total less the subtotal. A
 * total the arithmetic built from that VAT (`guidedTotal`) never confirms it.
 */
function readVat(parts: Parts, total: MoneyReading | null, exponent: number | null): MoneyReading | null {
  const printedTotal = total && total.row !== null ? total : null;
  const subtotal = parts.subtotal;
  const read = parts.vat;
  // A tip, a delivery fee or a service charge the size of the VAT is printed on its own row: then the difference is it.
  const printedApart = (minor: bigint) => parts.all.some((a) => a.minor === minor && !isVatRow(a.row) && vatRateOn(a.row) === null);
  if (printedTotal && subtotal && printedTotal.minor > subtotal.minor) {
    const derived = printedTotal.minor - subtotal.minor;
    if (plausibleVat(derived, printedTotal.minor) && !printedApart(derived) && parts.rates.some((rate) => vatOf(derived, subtotal.minor, rate))) {
      if (read && near(read.minor, derived)) return { minor: read.minor, rule: RULE_VAT_CONFIRMED, conf: read.conf, row: read.row };
      return { minor: derived, rule: RULE_VAT_DERIVED, conf: Math.min(printedTotal.conf, subtotal.conf), row: null };
    }
  }
  if (!read || (total && !plausibleVat(read.minor, total.minor))) return null;
  const independentTotal = total && total.rule !== RULE_SUBTOTAL_PLUS_VAT ? total : null;
  // A VAT row OCR joined with the subtotal row (a total label on it, the VAT its smaller amount): its other amount is
  // the subtotal, whose own label the join split.
  const joinedSubtotal = read.row && hasKeyword(read.row.folded, TOTAL) ? moneyIn(read.row.text, exponent, parts.integers).filter((m) => m !== read.minor) : [];
  const confirmed =
    (subtotal !== null && parts.rates.some((rate) => vatOf(read.minor, subtotal.minor, rate))) ||
    (independentTotal !== null && parts.rates.some((rate) => vatIn(read.minor, independentTotal.minor, rate))) ||
    (printedTotal !== null && [...(subtotal ? [subtotal.minor] : []), ...joinedSubtotal].some((base) => near(base + read.minor, printedTotal.minor)));
  return confirmed ? { minor: read.minor, rule: RULE_VAT_CONFIRMED, conf: read.conf, row: read.row } : null;
}

/** The printed rate, when the VAT filled is that rate of the subtotal or of the total (a misread rate stays out). */
function readRate(parts: Parts, vat: MoneyReading | null, total: MoneyReading | null): MoneyFields['vatRate'] {
  const rate = parts.rateBasisPoints;
  if (rate === null || !vat) return null;
  const agrees = (parts.subtotal && vatOf(vat.minor, parts.subtotal.minor, rate)) || (total && vatIn(vat.minor, total.minor, rate));
  return agrees ? { basisPoints: rate, rule: RULE_VAT_RATE, conf: vat.conf } : null;
}

export interface MoneyOptions {
  /** MUT-540 (D8): a lone card slip may be the total (E4). On by default; the benchmark turns it off to measure it alone. */
  loneCardSlip?: boolean | undefined;
}

/** `knownRates`: the VAT rates of the receipt's currency (`knownVatRates`), for a receipt that prints none. */
export function readMoney(rows: readonly Row[], exponent: number | null, knownRates: readonly number[] = [], options: MoneyOptions = {}): MoneyFields {
  const parts = partsOf(rows, exponent, knownRates);
  const largest = largestReadings(rows, parts);
  const total = isStatement(rows, parts, exponent)
    ? null
    : firstSure([
        { read: () => labelledTotal(rows, parts, exponent, options.loneCardSlip ?? true), binding: true },
        { read: () => guidedTotal(parts), binding: true },
        { read: () => votedTotal(parts), binding: false },
        { read: () => sumOfTwo(largest, parts), binding: false },
        { read: () => repeatedLargest(largest), binding: false },
      ]);
  const vat = readVat(parts, total, exponent);
  return { total, vat, vatRate: readRate(parts, vat, total) };
}
