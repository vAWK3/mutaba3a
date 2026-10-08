/**
 * Calendar dates for the ledger (contract §1 "Dates": `date` fields are
 * YYYY-MM-DD in the organization's timezone). Every function here works on
 * ISO date strings, never on wall-clock `Date` arithmetic, so a due date can
 * never shift because of where the server runs.
 */
export type IsoDate = string;
export type IsoMonth = string;

export const PAYMENT_TERMS = ['IMMEDIATE', 'EOM', 'EOM_15', 'EOM_30', 'EOM_45', 'EOM_60'] as const;
export type PaymentTerms = (typeof PAYMENT_TERMS)[number];

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date at `now` in `timezone`, as YYYY-MM-DD. */
export function todayIn(timezone: string, now: Date): IsoDate {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function isIsoDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function isIsoMonth(value: string): boolean {
  const m = MONTH_RE.exec(value);
  if (!m) return false;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12;
}

export function compareIsoDates(a: IsoDate, b: IsoDate): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function split(date: IsoDate): [number, number, number] {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`not an ISO date: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function join(y: number, m: number, d: number): IsoDate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = split(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return join(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function endOfMonth(date: IsoDate): IsoDate {
  const [y, m] = split(date);
  return join(y, m, daysInMonth(y, m));
}

export function monthOf(date: IsoDate): IsoMonth {
  return date.slice(0, 7);
}

export function addMonths(month: IsoMonth, n: number): IsoMonth {
  const m = MONTH_RE.exec(month);
  if (!m) throw new Error(`not an ISO month: ${month}`);
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + n;
  const y = Math.floor(total / 12);
  const mo = (total % 12) + 1;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}`;
}

/** `day` clamped into `month` (a billing day of 28 is safe in every month; the clamp is defensive). */
export function clampDay(month: IsoMonth, day: number): IsoDate {
  const m = MONTH_RE.exec(month);
  if (!m) throw new Error(`not an ISO month: ${month}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return join(y, mo, Math.min(day, daysInMonth(y, mo)));
}

/** Due date for an item posted on `postingDate` under `terms` (brief rev. 2 §B). */
export function dueDateFor(postingDate: IsoDate, terms: PaymentTerms): IsoDate {
  switch (terms) {
    case 'IMMEDIATE':
      return postingDate;
    case 'EOM':
      return endOfMonth(postingDate);
    case 'EOM_15':
      return addDays(endOfMonth(postingDate), 15);
    case 'EOM_30':
      return addDays(endOfMonth(postingDate), 30);
    case 'EOM_45':
      return addDays(endOfMonth(postingDate), 45);
    case 'EOM_60':
      return addDays(endOfMonth(postingDate), 60);
  }
}
