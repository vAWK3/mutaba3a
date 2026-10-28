import { currencyExponent, type Currency } from '../../money.js';
import { decimalPlacesIn } from './amounts.js';
import { keywords as wordSet, hasKeyword, type KeywordSet } from './keywords.js';
import type { Row } from './types.js';

/** MUT-441: the currency a receipt names, by symbol, code or word. Only the API's currencies are ever suggested. */

const SUPPORTED: ReadonlyArray<[Currency, readonly string[], KeywordSet]> = [
  ['ILS', ['₪'], wordSet('ils', 'nis', 'ש"ח', 'שח', 'שקל', 'שקלים', 'شيكل', 'شيقل', 'ش.ج')],
  ['USD', ['$'], wordSet('usd', 'dollar', 'دولار', 'דולר')],
  ['EUR', ['€'], wordSet('eur', 'euro', 'יורו', 'يورو')],
  // The dinar and dirham abbreviations differ only in their alef (د.أ, د.إ), which folding merges: matched unfolded.
  ['JOD', ['د.أ', 'د.ا'], wordSet('jod', 'jd', 'دينار')],
];

/** Currencies the API doesn't take: named on a receipt, they make the currency unknown rather than a wrong one. */
const UNSUPPORTED: KeywordSet = wordSet('sar', 'aed', 'qar', 'bhd', 'omr', 'kwd', 'gbp', 'egp', 'ر.س', 'ريال', 'درهم', 'جنيه');
const UNSUPPORTED_SYMBOLS = ['£', 'د.إ'];

export function currenciesOn(row: Row): { supported: Currency[]; unsupported: boolean } {
  const supported = SUPPORTED.filter(([, symbols, words]) => symbols.some((s) => row.text.includes(s)) || hasKeyword(row.folded, words)).map(([code]) => code);
  // `$` inside "US$" or a dollar sign next to a dinar marker still counts once each; a row naming two is ambiguous.
  return { supported, unsupported: hasKeyword(row.folded, UNSUPPORTED) || UNSUPPORTED_SYMBOLS.some((s) => row.text.includes(s)) };
}

export interface CurrencyReading {
  code: Currency;
  rule: number;
  conf: number;
}

const ON_TOTAL_ROW = 0.92;
const ONLY_ONE_NAMED = 0.88;

/**
 * The receipt's currency: the one its total row names; else the only one any row names. Two different ones with
 * none on the total row, or any currency the API doesn't take, is no answer.
 */
export function readCurrency(rows: readonly Row[], totalRow: Row | null): CurrencyReading | null {
  if (totalRow) {
    const onTotal = currenciesOn(totalRow);
    if (onTotal.supported.length === 1 && !onTotal.unsupported) return { code: onTotal.supported[0]!, rule: ON_TOTAL_ROW, conf: totalRow.conf };
  }
  const found = new Map<Currency, Row>();
  for (const row of rows) {
    const named = currenciesOn(row);
    if (named.unsupported) return null;
    for (const code of named.supported) if (!found.has(code)) found.set(code, row);
  }
  if (found.size !== 1) return null;
  const [[code, row]] = [...found] as [[Currency, Row]];
  return { code, rule: ONLY_ONE_NAMED, conf: row.conf };
}

/** A receipt naming no currency, whose money is all printed with three decimals, is in dinars (see inferFromDecimals). */
const RULE_THREE_DECIMALS = 0.8;
/** At least this many three-decimal amounts, and none with one or two decimals. */
const MIN_THREE_DECIMAL_AMOUNTS = 3;

/**
 * MUT-441 benchmark: OCR often mangles the dinar's word or sign ("دينان", "(د.)"), and then nothing names the
 * currency. JOD is the only currency the API takes that prints three decimals, so a receipt naming none (not even one
 * the API doesn't take), with at least MIN_THREE_DECIMAL_AMOUNTS amounts all printed with three decimals, is read as
 * JOD; its confidence is the rule times the mean confidence of those rows.
 */
export function inferFromDecimals(rows: readonly Row[]): CurrencyReading | null {
  const confs: number[] = [];
  for (const row of rows) {
    const named = currenciesOn(row);
    if (named.unsupported || named.supported.length > 0) return null;
    for (const places of decimalPlacesIn(row.text)) {
      if (places === 1 || places === 2) return null;
      if (places === 3) confs.push(row.conf);
    }
  }
  if (confs.length < MIN_THREE_DECIMAL_AMOUNTS) return null;
  return { code: 'JOD', rule: RULE_THREE_DECIMALS, conf: confs.reduce((a, b) => a + b, 0) / confs.length };
}

export function exponentOf(reading: CurrencyReading | null): number | null {
  return reading ? currencyExponent(reading.code) : null;
}
