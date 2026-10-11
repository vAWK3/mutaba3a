/**
 * OwedNowSummary
 *
 * "How much am I owed?" as the dominant figure (MUT-3): one amount per
 * currency, never converted or combined, with the overdue part called out
 * beneath it. Presentational -- callers compute the figures with
 * summarizeOwedByCurrency so every screen that shows Owed Now agrees.
 *
 * Usage:
 *   <OwedNowSummary owed={summarizeOwedByCurrency(receivables, today)} />
 */

import { formatAmount, cn } from '../../lib/utils';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import type { OwedByCurrency } from '../../db/aggregations';

export interface OwedNowSummaryProps {
  owed: OwedByCurrency[];
  className?: string;
}

/** Wrap text in a left-to-right isolate (U+2066 … U+2069) for use inside a translated sentence. */
const isolateLtr = (text: string) => `⁦${text}⁩`;

export function OwedNowSummary({ owed, className }: OwedNowSummaryProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);

  return (
    <section className={cn('owed-now', className)} aria-label={t('clients.profile.owedNow')}>
      <div className="owed-now-label">{t('clients.profile.owedNow')}</div>
      {owed.length === 0 ? (
        <div className="owed-now-settled">{t('clients.profile.nothingOwed')}</div>
      ) : (
        <div className="owed-now-currencies">
          {owed.map(({ currency, owedMinor, overdueMinor }) => (
            <div key={currency} className="owed-now-currency">
              <bdi dir="ltr" className="owed-now-amount" data-testid="owed-now-amount">
                {formatAmount(owedMinor, currency, locale)}
              </bdi>
              {overdueMinor > 0 ? (
                <div className="owed-now-overdue">
                  {t('clients.profile.overdueAmount', {
                    amount: isolateLtr(formatAmount(overdueMinor, currency, locale)),
                  })}
                </div>
              ) : (
                <div className="owed-now-on-time">{t('clients.profile.nothingOverdue')}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
