import { describe, expect, it } from 'vitest';
import type { ClientVat, VatPeriodView } from '../vatPeriodRules';
import { allVatConfirmed, canReview, canSayDone, clientVatVisible, matchesVatFilter, vatDueWords, vatFilterCounts, vatPeriodWords, VAT_CONFIRMED_SHOWN_DAYS } from '../vatPeriodRules';

/** MUT-783: the VAT period rules, pure. */
const period = (over: Partial<VatPeriodView> = {}): VatPeriodView => ({
  periodKey: '2026-B5', kind: 'BIMONTHLY', year: 2026, firstMonth: 9, lastMonth: 10, startDate: '2026-09-01', endDate: '2026-10-31', due: '2026-11-15',
  state: 'OPEN', note: null, announcedAt: '2026-11-01T06:00:00.000Z', doneAt: null, ...over,
});
const item = (profileId: string, p: VatPeriodView | null): ClientVat => ({ profileId, kind: p ? p.kind : 'NONE', chosenKind: null, period: p });

describe('vatPeriodWords', () => {
  it('names two months, one month and the year', () => {
    expect(vatPeriodWords(period(), 'en')).toBe('Sep – Oct 2026');
    expect(vatPeriodWords(period({ kind: 'MONTHLY', firstMonth: 10, lastMonth: 10 }), 'en')).toBe('Oct 2026');
    expect(vatPeriodWords(period({ kind: 'YEARLY', firstMonth: 1, lastMonth: 12 }), 'en')).toBe('2026');
  });
  it('writes the months in Levantine Arabic', () => {
    expect(vatPeriodWords(period({ firstMonth: 1, lastMonth: 2 }), 'ar')).toContain('كانون الثاني');
  });
});

describe('vatDueWords', () => {
  it('writes the filing day, and none where none is stated', () => {
    expect(vatDueWords('2026-11-15', 'en')).toBe('Nov 15');
    expect(vatDueWords(null, 'en')).toBeNull();
  });
});

describe('clientVatVisible', () => {
  const now = new Date('2026-11-20T06:00:00.000Z');
  it('shows an open, done or more-needed period', () => {
    for (const state of ['OPEN', 'CLIENT_DONE', 'MORE_NEEDED'] as const) expect(clientVatVisible(period({ state }), now)).toBe(true);
  });
  it('shows nothing before the first period', () => {
    expect(clientVatVisible(null, now)).toBe(false);
  });
  it('shows a confirmed period for a month, then not', () => {
    const confirmed = period({ state: 'CONFIRMED' });
    expect(clientVatVisible(confirmed, now)).toBe(true);
    expect(clientVatVisible(confirmed, new Date(Date.parse(confirmed.announcedAt) + (VAT_CONFIRMED_SHOWN_DAYS + 1) * 86_400_000))).toBe(false);
  });
});

describe('what each side may do', () => {
  it('the client says Done on an open or asked-for-more period, never on a done or confirmed one', () => {
    expect([canSayDone('OPEN'), canSayDone('MORE_NEEDED'), canSayDone('CLIENT_DONE'), canSayDone('CONFIRMED')]).toEqual([true, true, false, false]);
  });
  it('the accountant reviews anything not confirmed', () => {
    expect([canReview('OPEN'), canReview('CLIENT_DONE'), canReview('MORE_NEEDED'), canReview('CONFIRMED')]).toEqual([true, true, true, false]);
  });
});

describe('the desk filter', () => {
  const items = [item('a', period({ state: 'OPEN' })), item('b', period({ state: 'CLIENT_DONE' })), item('c', period({ state: 'CONFIRMED' })), item('d', period({ state: 'CONFIRMED' })), item('e', null)];
  it('counts clients per state; one with no period counts only under All', () => {
    expect(vatFilterCounts(items)).toEqual({ all: 5, OPEN: 1, CLIENT_DONE: 1, CONFIRMED: 2, MORE_NEEDED: 0 });
  });
  it('matches by state; All matches every client, those with no period included', () => {
    expect(matchesVatFilter(items[0], 'OPEN')).toBe(true);
    expect(matchesVatFilter(items[0], 'CONFIRMED')).toBe(false);
    expect(matchesVatFilter(items[4], 'all')).toBe(true);
    expect(matchesVatFilter(items[4], 'OPEN')).toBe(false);
    expect(matchesVatFilter(undefined, 'OPEN')).toBe(false);
  });
  it('is all confirmed only when at least one client has a period and every period is confirmed', () => {
    expect(allVatConfirmed(items)).toBe(false);
    expect(allVatConfirmed([item('c', period({ state: 'CONFIRMED' })), item('e', null)])).toBe(true);
    expect(allVatConfirmed([item('e', null)])).toBe(false);
    expect(allVatConfirmed([])).toBe(false);
  });
});
