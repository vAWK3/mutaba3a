import { useLanguage, useT } from '../../lib/i18n/core';
import type { PriceLines } from '../data/billingPlans';
import { Amount } from './billingParts';

/**
 * MUT-750 slice A (wireframe mut-750a, variant A): the last lines before Checkout. For an Israeli address the price,
 * "VAT 18%" and the total, each one line of data; elsewhere the price alone. Announced when the country changes them.
 */
export function PriceLinesCard({ lines, currency, interval }: { lines: PriceLines; currency: 'ILS' | 'USD'; interval: 'month' | 'year' }) {
  const t = useT();
  const { language } = useLanguage();
  const per = t(interval === 'month' ? 'hosted.billing.plans.aMonth' : 'hosted.billing.plans.aYear');
  const amount = (minor: number) => <Amount minor={minor} currency={currency} language={language} />;
  return (
    <div className="hp-price-lines" aria-live="polite" data-testid="price-lines">
      {lines.vat ? (
        <>
          <div className="hp-price-line">
            <span>{t('hosted.billing.vat.price')}</span>
            {amount(lines.price)}
          </div>
          <div className="hp-price-line">
            <span>{t('hosted.billing.vat.line', { percent: String(lines.vat.percent) })}</span>
            {amount(lines.vat.amount)}
          </div>
          <div className="hp-price-line hp-price-total">
            <span>
              {t('hosted.billing.vat.total')} <span className="hp-price-per">{per}</span>
            </span>
            {amount(lines.total)}
          </div>
        </>
      ) : (
        <div className="hp-price-line hp-price-total">
          <span>
            {t('hosted.billing.vat.price')} <span className="hp-price-per">{per}</span>
          </span>
          {amount(lines.price)}
        </div>
      )}
    </div>
  );
}
