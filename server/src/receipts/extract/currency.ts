import { currencyExponent, type Currency } from '../../money.js';
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

export function exponentOf(reading: CurrencyReading | null): number | null {
  return reading ? currencyExponent(reading.code) : null;
}
