import { describe, it, expect } from 'vitest';
import { closingDayLabel } from '../../data/closeAccount';
import { inviteEnds } from '../../pages/accountant-invite/inviteState';
import { dayLabel, moneyDay, periodLabel } from '../../pages/client-books/clientBooksRules';
import { agoText, dayText, instantText } from '../../operator/time';
import { formatDay } from '../dates';

// MUT-587: every Arabic date that names a month uses the Levantine name, with Latin digits; numeric dates stay numeric.
const GREGORIAN = /يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر/;
const ARABIC_INDIC = /[٠-٩]/;

describe('Arabic dates read Levantine months (MUT-587)', () => {
  it('the close-account deletion day', () => {
    const day = closingDayLabel('2026-11-23T10:00:00Z', 'ar', 'Asia/Jerusalem');
    expect(day).toBe('23 تشرين الثاني 2026');
  });

  it("an accountant invite's end date", () => {
    expect(inviteEnds('2026-11-17T10:00:00Z', 'ar')).toBe('17 تشرين الثاني');
    expect(inviteEnds('2026-11-17T10:00:00Z', 'en')).toBe('Nov 17');
  });

  it("a client book's period, day and money day", () => {
    expect(periodLabel('2026-08', '2026-10', 'ar')).toBe('آب – تشرين الأول 2026');
    expect(dayLabel('2026-01-12T10:00:00Z', 'ar')).toBe('12 كانون الثاني 2026');
    expect(moneyDay('2026-10-30', 'ar')).toBe('30 تشرين الأول');
  });

  it('the operator console keeps Latin digits, no Gregorian names', () => {
    for (const text of [instantText('2026-02-03T10:00:00Z', 'ar'), dayText('2026-02-03T10:00:00Z', 'ar'), agoText('2026-11-11T07:00:00Z', new Date('2026-11-11T10:00:00Z'), 'ar')]) {
      expect(text).not.toMatch(GREGORIAN);
      expect(text).not.toMatch(ARABIC_INDIC);
    }
  });

  it('a numeric money day stays numeric', () => {
    expect(formatDay('2026-11-07', 'ar').replace(/\u200f/g, '')).toBe('07/11/2026');
  });
});
