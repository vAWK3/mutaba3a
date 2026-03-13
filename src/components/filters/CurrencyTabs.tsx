/**
 * CurrencyTabs - Currency selection tabs
 *
 * A component for switching between currency views (USD, ILS, or All).
 * Used for page-level currency filtering.
 */

import type { Currency } from '../../types';
import { cn } from '../../lib/utils';
import { useT } from '../../lib/i18n';

export interface CurrencyTabsProps {
  value: Currency | undefined;
  onChange: (value: Currency | undefined) => void;
  showAll?: boolean;
  className?: string;
}

export function CurrencyTabs({
  value,
  onChange,
  showAll = false,
  className,
}: CurrencyTabsProps) {
  const t = useT();

  const currencies: { value: Currency | undefined; labelKey: string }[] = [
    ...(showAll ? [{ value: undefined as Currency | undefined, labelKey: 'currency.all' }] : []),
    { value: 'USD' as Currency, labelKey: 'currency.USD' },
    { value: 'ILS' as Currency, labelKey: 'currency.ILS' },
  ];

  return (
    <div className={cn('currency-tabs', className)} role="tablist">
      {currencies.map((currency) => {
        const isSelected = currency.value === value;
        return (
          <button
            key={currency.labelKey}
            role="tab"
            aria-selected={isSelected}
            className={cn('currency-tab', isSelected && 'currency-tab-active')}
            onClick={() => onChange(currency.value)}
          >
            {t(currency.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
