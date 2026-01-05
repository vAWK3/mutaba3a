import type { CurrencyMode } from '../../types';
import { cn } from '../../lib/utils';
import { useT } from '../../lib/i18n';

interface CurrencyModeTabsProps {
  value: CurrencyMode;
  onChange: (value: CurrencyMode) => void;
}

export function CurrencyModeTabs({ value, onChange }: CurrencyModeTabsProps) {
  const t = useT();

  return (
    <div className="segment-control">
      <button
        className={cn('segment-button', value === 'USD' && 'active')}
        onClick={() => onChange('USD')}
      >
        USD
      </button>
      <button
        className={cn('segment-button', value === 'ILS' && 'active')}
        onClick={() => onChange('ILS')}
      >
        ILS
      </button>
      <button
        className={cn('segment-button', value === 'BOTH' && 'active')}
        onClick={() => onChange('BOTH')}
      >
        {t('reports.currencyMode.both')}
      </button>
    </div>
  );
}
