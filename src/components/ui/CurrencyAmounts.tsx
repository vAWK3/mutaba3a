/**
 * CurrencyAmounts
 *
 * Amounts in several currencies side by side, one per currency, never
 * converted or combined (ADR-004), like Owed now. Each amount is its own
 * left-to-right island (dir="ltr", MUT-109 brief D2), so "$240 ₪3,500" reads
 * the same inside Arabic.
 * Presentational: pass entries from `orderCurrencyAmounts` (non-zero, in
 * USD → ILS → EUR order).
 *
 * Usage:
 *   <CurrencyAmounts amounts={currencyTotals(groups)} />
 */

import { formatAmount, cn } from '../../lib/utils';
import { useLanguage, getLocale } from '../../lib/i18n';
import type { CurrencyAmount } from '../../lib/currencyAmounts';
import './CurrencyAmounts.css';

export interface CurrencyAmountsProps {
  amounts: readonly CurrencyAmount[];
  className?: string;
}

export function CurrencyAmounts({ amounts, className }: CurrencyAmountsProps) {
  const { language } = useLanguage();
  const locale = getLocale(language);

  return (
    <span className={cn('currency-amounts', className)}>
      {amounts.map(({ currency, amountMinor }) => (
        <bdi key={currency} dir="ltr" className="currency-amount" data-testid="currency-amount">
          {formatAmount(amountMinor, currency, locale)}
        </bdi>
      ))}
    </span>
  );
}
