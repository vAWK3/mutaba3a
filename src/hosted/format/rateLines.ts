import { getLocale } from '../../lib/i18n/core';
import type { Language } from '../../lib/i18n/types';
import type { Currency } from '../api/client';

/** Digits a rate shows ("1 JOD = 5.2238 ILS"). */
const RATE_DIGITS = 4;

/**
 * "1 USD = 3.7037 ILS", one per converted currency, with "(USD peg)" where the
 * rate is derived (ADR-087). Shared by an expense group's ≈ line and Reports'
 * ≈ breakdown (MUT-175 review: one builder, not two).
 */
export function rateLines(
  used: ReadonlyArray<{ currency: Currency; rate: number; derived: boolean }>,
  base: Currency,
  t: (key: string, vars?: Record<string, string | number>) => string,
  language: Language,
): string[] {
  const number = new Intl.NumberFormat(getLocale(language), { maximumFractionDigits: RATE_DIGITS });
  return used.map(({ currency, rate, derived }) => {
    const line = t('hosted.groups.detail.rateLine', { from: currency, rate: number.format(1 / rate), to: base });
    return derived ? `${line} (${t('hosted.groups.detail.peg')})` : line;
  });
}
