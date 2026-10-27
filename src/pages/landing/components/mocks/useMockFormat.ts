import { useMemo } from 'react';
import { getLocale, useLanguage } from '../../../../lib/i18n';
import { formatAmount, formatDateShort } from '../../../../lib/utils';
import type { Currency } from '../../../../lib/utils';

/** Money and date formatting for the mock-ups, in the visitor's language. */
export function useMockFormat() {
  const { language } = useLanguage();

  return useMemo(() => {
    const locale = getLocale(language);
    return {
      language,
      money: (amountMinor: number, currency: Currency) => formatAmount(amountMinor, currency, locale),
      // Noon keeps a fixed calendar date on the same day in every timezone.
      date: (isoDate: string) => formatDateShort(`${isoDate}T12:00:00`, locale),
    };
  }, [language]);
}
