import type { Language } from '../../../lib/i18n/types';
import type { Schemas } from '../../api/client';
import { moneyDay, periodLabel } from './clientBooksRules';

/**
 * MUT-783 (MUT-782, ADR-343): the VAT period rules the desk and the client's home share, pure so each is a unit test.
 * The server sends months, not words: each person reads them in their own language.
 */
export type VatPeriodView = Schemas['VatPeriodView'];
export type VatState = Schemas['VatPeriodState'];
export type VatKind = Schemas['VatPeriodKind'];
export type ClientVat = Schemas['ClientVatPeriodsResponse']['items'][number];

export const VAT_STATES: readonly VatState[] = ['OPEN', 'CLIENT_DONE', 'CONFIRMED', 'MORE_NEEDED'];
/** The order the period select offers: the common one first. */
export const VAT_KINDS: readonly VatKind[] = ['BIMONTHLY', 'MONTHLY', 'YEARLY', 'NONE'];

/** The badge colour per state (DESIGN.md: one colour, one meaning; always with the word and its glyph). */
export const VAT_STATE_VARIANT: Record<VatState, 'neutral' | 'info' | 'success' | 'warning'> = {
  OPEN: 'neutral',
  CLIENT_DONE: 'info',
  CONFIRMED: 'success',
  MORE_NEEDED: 'warning',
};

/** A confirmed period stays on the client's home this long, as a quiet line, then goes. */
export const VAT_CONFIRMED_SHOWN_DAYS = 30;
const DAY_MS = 86_400_000;

const month = (year: number, m: number) => `${year}-${String(m).padStart(2, '0')}`;

/** "Jan – Feb 2026", "Oct 2026", or the year for a yearly period. */
export function vatPeriodWords(period: Pick<VatPeriodView, 'kind' | 'year' | 'firstMonth' | 'lastMonth'>, language: Language): string {
  if (period.kind === 'YEARLY') return String(period.year);
  return periodLabel(month(period.year, period.firstMonth), month(period.year, period.lastMonth), language);
}

/** The filing day as "Mar 15" (the language's own order), or null where none is stated (a yearly period). */
export function vatDueWords(due: string | null, language: Language): string | null {
  return due === null ? null : moneyDay(due, language);
}

/** Whether the client's home shows the period: anything not confirmed, and a confirmed one for a month. */
export function clientVatVisible(period: VatPeriodView | null, now: Date): boolean {
  if (period === null) return false;
  if (period.state !== 'CONFIRMED') return true;
  return now.getTime() - Date.parse(period.announcedAt) <= VAT_CONFIRMED_SHOWN_DAYS * DAY_MS;
}

/** The client can say Done on a period that is open, or that the accountant asked more for; never twice. */
export const canSayDone = (state: VatState): boolean => state === 'OPEN' || state === 'MORE_NEEDED';

/** The accountant can confirm or ask for more on any period not yet confirmed. */
export const canReview = (state: VatState): boolean => state !== 'CONFIRMED';

export type VatFilter = 'all' | VatState;
export const VAT_FILTERS: readonly VatFilter[] = ['all', ...VAT_STATES];

/** Clients per state (a client with no period counts only under All). */
export function vatFilterCounts(items: readonly ClientVat[]): Record<VatFilter, number> {
  const counts: Record<VatFilter, number> = { all: items.length, OPEN: 0, CLIENT_DONE: 0, CONFIRMED: 0, MORE_NEEDED: 0 };
  for (const item of items) if (item.period) counts[item.period.state] += 1;
  return counts;
}

export function matchesVatFilter(item: ClientVat | undefined, filter: VatFilter): boolean {
  if (filter === 'all') return true;
  return item?.period?.state === filter;
}

/** Every client that has a period has confirmed it (and there is at least one): the desk is clear. */
export function allVatConfirmed(items: readonly ClientVat[]): boolean {
  const withPeriod = items.filter((item) => item.period !== null);
  return withPeriod.length > 0 && withPeriod.every((item) => item.period!.state === 'CONFIRMED');
}
