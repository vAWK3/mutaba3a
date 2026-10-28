import { DATE_LABEL, hasKeyword } from './keywords.js';
import { foldForMatch } from './normalize.js';
import type { Row } from './types.js';

/** MUT-441: the receipt's date, as YYYY-MM-DD. Day first, as IL, PS and JO receipts print it. Pure. */

const MONTH_NAMES: ReadonlyArray<[string, number]> = ([
  ...['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'].flatMap((m, i): Array<[string, number]> => [
    [m, i + 1],
    [m.slice(0, 3), i + 1],
  ]),
  ['sept', 9] as [string, number],
  ...['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'].map((m, i): [string, number] => [m, i + 1]),
  ['מרס', 3] as [string, number],
  ...['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'].map((m, i): [string, number] => [m, i + 1]),
  ['يونيه', 6] as [string, number],
  ['يوليه', 7] as [string, number],
  // Levantine names, as Palestinian and Jordanian receipts print them.
  ...['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'].map((m, i): [string, number] => [m, i + 1]),
] as Array<[string, number]>).map(([name, month]): [string, number] => [foldForMatch(name), month]);

const MONTH_BY_NAME = new Map(MONTH_NAMES);
/** Longest first, so "تشرين الاول" wins over a shorter name inside it. */
const MONTH_ALTERNATION = [...MONTH_BY_NAME.keys()].sort((a, b) => b.length - a.length).join('|');

const YMD = /(?<!\d)(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/;
const DMY = /(?<!\d)(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/;
/** `28 October 2026`, `5 בנובמבר 2026` (Hebrew's ב "in"), `3 تشرين الأول 2026`. */
const DAY_NAME_YEAR = new RegExp(`(?<!\\d)(\\d{1,2})\\s*(?:ב|-)?\\s*(${MONTH_ALTERNATION})(?![\\p{L}])\\.?,?\\s*(\\d{4})(?!\\d)`, 'u');
/** `Oct 28, 2026`. */
const NAME_DAY_YEAR = new RegExp(`(?<![\\p{L}])(${MONTH_ALTERNATION})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})(?!\\d)`, 'u');

const RULE_FULL = 0.85;
const RULE_TWO_DIGIT_YEAR = 0.75;
/** Day and month read the other way round (a middle number past 12): a US-style date. */
const SWAPPED_PENALTY = 0.1;
const LABELLED_BONUS = 0.1;
const RULE_CAP = 0.95;

export interface DateReading {
  iso: string;
  rule: number;
  conf: number;
}

function iso(year: number, month: number, day: number): string | null {
  const y = year < 100 ? 2000 + year : year;
  if (y < 2000 || y > 2099 || month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(y, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return date.toISOString().slice(0, 10);
}

function dateOn(row: Row): { iso: string; rule: number } | null {
  const ymd = YMD.exec(row.text);
  if (ymd) {
    const found = iso(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
    if (found) return { iso: found, rule: RULE_FULL };
  }
  const dmy = DMY.exec(row.text);
  if (dmy) {
    const [day, month, year] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
    const rule = dmy[3]!.length === 4 ? RULE_FULL : RULE_TWO_DIGIT_YEAR;
    const found = iso(year, month, day);
    if (found) return { iso: found, rule };
    const swapped = month > 12 ? iso(year, day, month) : null;
    if (swapped) return { iso: swapped, rule: rule - SWAPPED_PENALTY };
  }
  const named = DAY_NAME_YEAR.exec(row.folded);
  if (named) {
    const found = iso(Number(named[3]), MONTH_BY_NAME.get(named[2]!) ?? 0, Number(named[1]));
    if (found) return { iso: found, rule: RULE_FULL };
  }
  const english = NAME_DAY_YEAR.exec(row.folded);
  if (english) {
    const found = iso(Number(english[3]), MONTH_BY_NAME.get(english[1]!) ?? 0, Number(english[2]));
    if (found) return { iso: found, rule: RULE_FULL };
  }
  return null;
}

/** The surest date on the receipt: one after a date label beats a bare one; the first wins a tie. */
export function readDate(rows: readonly Row[]): DateReading | null {
  let best: DateReading | null = null;
  for (const row of rows) {
    const found = dateOn(row);
    if (!found) continue;
    const rule = Math.min(RULE_CAP, found.rule + (hasKeyword(row.folded, DATE_LABEL) ? LABELLED_BONUS : 0));
    if (!best || rule * row.conf > best.rule * best.conf) best = { iso: found.iso, rule, conf: row.conf };
  }
  return best;
}
