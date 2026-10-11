import { getLocale } from '../../lib/i18n/core';
import type { Language } from '../../lib/i18n/types';

/**
 * Two kinds of time on the wire (M6): calendar dates (`YYYY-MM-DD`, already in
 * the organization's calendar) and instants (ISO date-times). A calendar date is
 * formatted as that same day in UTC, so no zone can move it to the day before;
 * an instant is shown in the organization's own zone.
 */

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MISSING = '—';

export function formatDay(value: string | null | undefined, language: Language): string {
  if (!value || !CALENDAR_DATE.test(value)) return MISSING;
  return new Intl.DateTimeFormat(getLocale(language), { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}

export function formatInstant(value: string | null | undefined, language: Language, timeZone: string): string {
  if (!value) return MISSING;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return MISSING;
  return new Intl.DateTimeFormat(getLocale(language), { dateStyle: 'medium', timeZone }).format(date);
}

const KIB = 1024;
const MIB = KIB * KIB;

/** A file size for people: KB below a megabyte, MB with one decimal above. */
export function formatSize(bytes: number, language: Language): string {
  const locale = getLocale(language);
  if (bytes < MIB) {
    return new Intl.NumberFormat(locale, { style: 'unit', unit: 'kilobyte', maximumFractionDigits: 0 }).format(Math.max(1, Math.round(bytes / KIB)));
  }
  return new Intl.NumberFormat(locale, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 }).format(bytes / MIB);
}
