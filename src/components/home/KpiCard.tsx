/**
 * KpiCard and KpiStrip Components
 *
 * Currency-aware KPI cards with tabbed currency display for the Home page.
 * Follows UX-REDESIGN-SPEC: Shows per currency by default, never silently mixes totals.
 */

import { useState } from 'react';
import { formatAmount, cn } from '../../lib/utils';
import { useLanguage, getLocale, useT } from '../../lib/i18n';
import { useFxRate } from '../../hooks/useFxRate';
import { getUnifiedTotalWithEur } from '../../lib/fx';

type CurrencyView = 'ILS' | 'USD' | 'Both';
type KpiType = 'income' | 'expense' | 'net' | 'neutral';

export interface KpiCardProps {
  label: string;
  usdAmountMinor: number;
  ilsAmountMinor: number;
  eurAmountMinor?: number;
  type?: KpiType;
  className?: string;
}

export function KpiCard({
  label,
  usdAmountMinor,
  ilsAmountMinor,
  eurAmountMinor = 0,
  type = 'neutral',
  className,
}: KpiCardProps) {
  const [currencyView, setCurrencyView] = useState<CurrencyView>('ILS');
  const { language } = useLanguage();
  const locale = getLocale(language);
  const { rate: usdToIlsRate } = useFxRate('USD', 'ILS');
  const { rate: eurToIlsRate } = useFxRate('EUR', 'ILS');

  // Calculate unified ILS total
  const unifiedILS = getUnifiedTotalWithEur(usdAmountMinor, ilsAmountMinor, eurAmountMinor, usdToIlsRate, eurToIlsRate) ?? 0;

  // Determine the display value based on currency view
  const getDisplayValue = () => {
    switch (currencyView) {
      case 'USD':
        return formatAmount(usdAmountMinor, 'USD', locale);
      case 'ILS':
        return formatAmount(unifiedILS, 'ILS', locale);
      case 'Both':
        return null; // Handled separately
    }
  };

  // Determine color class based on type and value
  const getColorClass = () => {
    if (type === 'income') return 'amount-positive';
    if (type === 'expense') return 'amount-negative';
    if (type === 'net') {
      // For net, determine based on the unified total
      return unifiedILS >= 0 ? 'amount-positive' : 'amount-negative';
    }
    return '';
  };

  const colorClass = getColorClass();

  return (
    <div className={cn('kpi-card kpi-card-tabbed', className)}>
      <div className="kpi-label">{label}</div>

      {/* Currency tabs */}
      <div className="kpi-tabs" role="tablist">
        {(['ILS', 'USD', 'Both'] as CurrencyView[]).map((view) => (
          <button
            key={view}
            role="tab"
            aria-selected={currencyView === view}
            className={cn('kpi-tab', currencyView === view && 'kpi-tab-active')}
            onClick={() => setCurrencyView(view)}
          >
            {view}
          </button>
        ))}
      </div>

      {/* Value display */}
      {currencyView === 'Both' ? (
        <div className="kpi-value-both" data-testid="kpi-value">
          <span className={cn('kpi-value-part', colorClass)}>
            {formatAmount(usdAmountMinor, 'USD', locale)}
          </span>
          <span className={cn('kpi-value-part', colorClass)}>
            {formatAmount(ilsAmountMinor, 'ILS', locale)}
          </span>
        </div>
      ) : (
        <div className={cn('kpi-value', colorClass)} data-testid="kpi-value">
          {getDisplayValue()}
        </div>
      )}
    </div>
  );
}

export interface ByCurrencyTotals {
  USD: {
    paidIncomeMinor: number;
    unpaidIncomeMinor: number;
    expensesMinor: number;
  };
  ILS: {
    paidIncomeMinor: number;
    unpaidIncomeMinor: number;
    expensesMinor: number;
  };
  EUR: {
    paidIncomeMinor: number;
    unpaidIncomeMinor: number;
    expensesMinor: number;
  };
}

export interface KpiStripProps {
  totals: ByCurrencyTotals | null | undefined;
  loading?: boolean;
  className?: string;
}

export function KpiStrip({ totals, loading, className }: KpiStripProps) {
  const t = useT();

  if (loading || !totals) {
    return (
      <div className={cn('kpi-row', className)}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="kpi-card">
            <div className="kpi-label">{t('common.loading')}</div>
            <div className="kpi-value">-</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn('kpi-row', className)}>
      <KpiCard
        label={t('overview.kpi.paidIncome')}
        usdAmountMinor={totals.USD.paidIncomeMinor}
        ilsAmountMinor={totals.ILS.paidIncomeMinor}
        eurAmountMinor={totals.EUR.paidIncomeMinor}
        type="income"
      />
      <KpiCard
        label={t('overview.kpi.unpaidReceivables')}
        usdAmountMinor={totals.USD.unpaidIncomeMinor}
        ilsAmountMinor={totals.ILS.unpaidIncomeMinor}
        eurAmountMinor={totals.EUR.unpaidIncomeMinor}
        type="neutral"
      />
      <KpiCard
        label={t('overview.kpi.expenses')}
        usdAmountMinor={totals.USD.expensesMinor}
        ilsAmountMinor={totals.ILS.expensesMinor}
        eurAmountMinor={totals.EUR.expensesMinor}
        type="expense"
      />
      <KpiCard
        label={t('overview.kpi.net')}
        usdAmountMinor={totals.USD.paidIncomeMinor - totals.USD.expensesMinor}
        ilsAmountMinor={totals.ILS.paidIncomeMinor - totals.ILS.expensesMinor}
        eurAmountMinor={totals.EUR.paidIncomeMinor - totals.EUR.expensesMinor}
        type="net"
      />
    </div>
  );
}
