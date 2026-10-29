import { isConfident } from './confidence.js';
import { DATE_LABEL, hasKeyword, VALIDITY } from './keywords.js';
import { foldForMatch } from './normalize.js';
import { confOf } from './rows.js';
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
  // MUT-504: the abbreviations Israeli invoices print ("17-פבר-26"); מרץ and מאי are already whole.
  ...['ינו', 'פבר', '', 'אפר', '', 'יונ', 'יול', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'].flatMap((m, i): Array<[string, number]> => (m ? [[m, i + 1]] : [])),
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
/**
 * `28 October 2026`, `5 בנובמבר 2026` (Hebrew's ב "in"), `3 تشرين الأول 2026`, and with an abbreviated month and a
 * two-digit year, `17-פבר-26`, `5 נוב' 2026`, `17-Feb-26` (MUT-504). A two-digit year is never the start of a time.
 */
const DAY_NAME_YEAR = new RegExp(`(?<!\\d)(\\d{1,2})\\s*(?:ב|-)?\\s*(${MONTH_ALTERNATION})(?![\\p{L}])[.']?[\\s,-]*(\\d{4}|\\d{2})(?![\\d:])`, 'u');
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

/** A range of two dates (`20/07/26-19/08/26`, `2026-09-01 – 2026-09-30`): a billing period, never the receipt's date. */
const DATE_RANGE = /(?<!\d)(?:\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4})\s*[-–—]\s*(?:\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4})(?!\d)/g;

interface Found {
  iso: string;
  rule: number;
  /** What was printed, to find the box it was read from. */
  printed: string;
}

function dateIn(text: string, folded: string): Found | null {
  const ymd = YMD.exec(text);
  if (ymd) {
    const found = iso(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
    if (found) return { iso: found, rule: RULE_FULL, printed: ymd[0] };
  }
  const dmy = DMY.exec(text);
  if (dmy) {
    const [day, month, year] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
    const rule = dmy[3]!.length === 4 ? RULE_FULL : RULE_TWO_DIGIT_YEAR;
    const found = iso(year, month, day);
    if (found) return { iso: found, rule, printed: dmy[0] };
    const swapped = month > 12 ? iso(year, day, month) : null;
    if (swapped) return { iso: swapped, rule: rule - SWAPPED_PENALTY, printed: dmy[0] };
  }
  const named = DAY_NAME_YEAR.exec(folded);
  if (named) {
    const found = iso(Number(named[3]), MONTH_BY_NAME.get(named[2]!) ?? 0, Number(named[1]));
    if (found) return { iso: found, rule: named[3]!.length === 4 ? RULE_FULL : RULE_TWO_DIGIT_YEAR, printed: named[0] };
  }
  const english = NAME_DAY_YEAR.exec(folded);
  if (english) {
    const found = iso(Number(english[3]), MONTH_BY_NAME.get(english[1]!) ?? 0, Number(english[2]));
    if (found) return { iso: found, rule: RULE_FULL, printed: english[0] };
  }
  return null;
}

interface Candidate extends DateReading {
  labelled: boolean;
}

function candidateOn(row: Row): Candidate | null {
  // MUT-504: a card's or a contract's validity date is never the receipt's.
  if (hasKeyword(row.folded, VALIDITY)) return null;
  const found = dateIn(row.text.replace(DATE_RANGE, ' '), row.folded.replace(DATE_RANGE, ' '));
  if (!found) return null;
  const labelled = hasKeyword(row.folded, DATE_LABEL);
  const rule = Math.min(RULE_CAP, found.rule + (labelled ? LABELLED_BONUS : 0));
  const printed = foldForMatch(found.printed);
  return { iso: found.iso, rule, conf: confOf(row, (part) => part.folded.includes(printed)), labelled };
}

const score = (c: DateReading) => c.rule * c.conf;
const surest = (candidates: readonly Candidate[]) => candidates.reduce<Candidate | null>((best, c) => (!best || score(c) > score(best) ? c : best), null);

/**
 * The receipt's date. A sure date after a date label wins (an invoice's issue date over the dates it lists). With
 * none, the surest date, but only when every date on the receipt is the same day and the receipt prints no billing
 * period: a bill or a statement lists many dates (trips, earlier payments), and picking one would suggest a wrong
 * date (MUT-504). The first wins a tie.
 */
export function readDate(rows: readonly Row[]): DateReading | null {
  const candidates = rows.flatMap((row) => candidateOn(row) ?? []);
  const labelled = surest(candidates.filter((c) => c.labelled));
  if (labelled && isConfident(score(labelled))) return strip(labelled);
  const bill = rows.some((row) => new RegExp(DATE_RANGE.source).test(row.text));
  if (bill || new Set(candidates.map((c) => c.iso)).size > 1) return null;
  const best = surest(candidates);
  return best ? strip(best) : null;
}

const strip = ({ iso, rule, conf }: Candidate): DateReading => ({ iso, rule, conf });
