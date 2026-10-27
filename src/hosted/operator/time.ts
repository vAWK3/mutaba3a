import { getLocale } from '../../lib/i18n/core';
import type { Language } from '../../lib/i18n/types';
import { waitingOf } from '../data/signupReviews';

/**
 * MUT-460/461: the operator console's times, with Western digits in both languages, as the rest of the portal's
 * figures. "3 hours ago" for how long since (a signup, a last sign-in); a date and time for an instant (a link's expiry).
 */
const latn = (language: Language) => `${getLocale(language)}-u-nu-latn`;

export function agoText(iso: string, now: Date, language: Language): string {
  const since = waitingOf(iso, now);
  return new Intl.RelativeTimeFormat(latn(language), { numeric: 'always' }).format(-since.count, since.unit);
}

export function instantText(iso: string, language: Language): string {
  return new Intl.DateTimeFormat(latn(language), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export function dayText(iso: string, language: Language): string {
  return new Intl.DateTimeFormat(latn(language), { dateStyle: 'medium' }).format(new Date(iso));
}
