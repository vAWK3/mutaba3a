import type { Currency } from '../../types';
import { cn } from '../../lib/utils';

interface CurrencyTabsProps {
  value?: Currency;
  onChange: (value?: Currency) => void;
  enabledCurrencies?: Currency[];
}

export function CurrencyTabs({ value, onChange, enabledCurrencies = ['USD', 'ILS'] }: CurrencyTabsProps) {
  return (
    <div className="segment-control">
      <button
        className={cn('segment-button', value === undefined && 'active')}
        onClick={() => onChange(undefined)}
      >
        All
      </button>
      {enabledCurrencies.map((currency) => (
        <button
          key={currency}
          className={cn('segment-button', value === currency && 'active')}
          onClick={() => onChange(currency)}
        >
          {currency}
        </button>
      ))}
    </div>
  );
}
