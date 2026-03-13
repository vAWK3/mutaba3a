/**
 * MonthActualsRow Component
 *
 * A collapsible row showing month-to-date actuals for the Home page:
 * - Received (paid income)
 * - Unpaid (unpaid income)
 * - Expenses
 * - Net (received - expenses)
 *
 * Per design doc:
 * - Collapsed by default on mobile
 * - Expanded by default on desktop
 * - Collapse state persisted in localStorage
 */

import { useState, useEffect } from 'react';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useMonthSummary } from '../../hooks/useMoneyAnswersQueries';
import { getCurrentMonthKey } from '../../lib/monthDetection';
import { formatAmount, cn } from '../../lib/utils';
import { useFxRate } from '../../hooks/useFxRate';
import { getUnifiedTotalWithEur } from '../../lib/fx';
import { ChevronDownIcon } from '../icons';

const STORAGE_KEY = 'home-actuals-expanded';

type CurrencyView = 'ILS' | 'USD' | 'Both';

export interface MonthActualsRowProps {
  className?: string;
}

/**
 * MonthActualsRow - Collapsible actuals summary for Home page
 */
export function MonthActualsRow({ className }: MonthActualsRowProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const { rate: usdToIlsRate } = useFxRate('USD', 'ILS');

  const currentMonth = getCurrentMonthKey();

  // Currency view state
  const [currencyView, setCurrencyView] = useState<CurrencyView>('ILS');

  // Initialize expanded state from localStorage, default based on screen size
  const [expanded, setExpanded] = useState(() => {
    if (typeof window === 'undefined') return !isMobile;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return stored === 'true';
    return !isMobile; // Default: expanded on desktop, collapsed on mobile
  });

  // Persist expanded state to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(expanded));
  }, [expanded]);

  // Fetch month summary for both currencies
  const { data: summaryUSD, isLoading: loadingUSD } = useMonthSummary({
    month: currentMonth,
    currency: 'USD',
    includeUnpaidIncome: true,
    includeProjectedRetainer: false, // Actuals only
  });

  const { data: summaryILS, isLoading: loadingILS } = useMonthSummary({
    month: currentMonth,
    currency: 'ILS',
    includeUnpaidIncome: true,
    includeProjectedRetainer: false, // Actuals only
  });

  const isLoading = loadingUSD || loadingILS;

  // Calculate values for display
  const receivedUSD = summaryUSD?.totalInflowMinor ?? 0;
  const receivedILS = summaryILS?.totalInflowMinor ?? 0;
  const unpaidUSD = summaryUSD?.awaitingMinor ?? 0;
  const unpaidILS = summaryILS?.awaitingMinor ?? 0;
  const expensesUSD = summaryUSD?.totalOutflowMinor ?? 0;
  const expensesILS = summaryILS?.totalOutflowMinor ?? 0;
  const netUSD = receivedUSD - expensesUSD;
  const netILS = receivedILS - expensesILS;

  // Calculate unified ILS totals
  const unifiedReceivedILS = getUnifiedTotalWithEur(receivedUSD, receivedILS, 0, usdToIlsRate, null) ?? receivedILS;
  const unifiedUnpaidILS = getUnifiedTotalWithEur(unpaidUSD, unpaidILS, 0, usdToIlsRate, null) ?? unpaidILS;
  const unifiedExpensesILS = getUnifiedTotalWithEur(expensesUSD, expensesILS, 0, usdToIlsRate, null) ?? expensesILS;
  const unifiedNetILS = unifiedReceivedILS - unifiedExpensesILS;

  const getAmountDisplay = (usdVal: number, _ilsVal: number, unifiedIlsVal: number) => {
    switch (currencyView) {
      case 'USD':
        return formatAmount(usdVal, 'USD', locale);
      case 'ILS':
        return formatAmount(unifiedIlsVal, 'ILS', locale);
      case 'Both':
        return null; // Handled separately
    }
  };

  const renderActualCard = (
    label: string,
    usdVal: number,
    ilsVal: number,
    unifiedVal: number,
    type: 'income' | 'expense' | 'net' | 'neutral'
  ) => {
    const getColorClass = () => {
      if (type === 'income') return 'amount-positive';
      if (type === 'expense') return 'amount-negative';
      if (type === 'net') {
        return unifiedVal >= 0 ? 'amount-positive' : 'amount-negative';
      }
      return '';
    };

    const colorClass = getColorClass();

    return (
      <div className="actuals-card">
        <div className="actuals-label">{label}</div>
        {currencyView === 'Both' ? (
          <div className="actuals-value-both">
            <span className={cn('actuals-value-part', colorClass)}>
              {formatAmount(usdVal, 'USD', locale)}
            </span>
            <span className={cn('actuals-value-part', colorClass)}>
              {formatAmount(ilsVal, 'ILS', locale)}
            </span>
          </div>
        ) : (
          <div className={cn('actuals-value', colorClass)}>
            {getAmountDisplay(usdVal, ilsVal, unifiedVal)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={cn('actuals-row', className)}>
      <button
        className="actuals-header"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls="actuals-content"
      >
        <ChevronDownIcon
          className={cn('actuals-chevron', expanded && 'actuals-chevron-open')}
        />
        <span className="actuals-title">{t('home.actuals.title')}</span>

        {/* Currency tabs in header */}
        <div className="actuals-tabs" role="tablist" onClick={(e) => e.stopPropagation()}>
          {(['ILS', 'USD', 'Both'] as CurrencyView[]).map((view) => (
            <button
              key={view}
              role="tab"
              aria-selected={currencyView === view}
              className={cn('actuals-tab', currencyView === view && 'actuals-tab-active')}
              onClick={(e) => {
                e.stopPropagation();
                setCurrencyView(view);
              }}
            >
              {view}
            </button>
          ))}
        </div>
      </button>

      {expanded && (
        <div id="actuals-content" className="actuals-content">
          {isLoading ? (
            <div className="actuals-loading">{t('common.loading')}</div>
          ) : (
            <div className="actuals-grid">
              {renderActualCard(t('home.actuals.received'), receivedUSD, receivedILS, unifiedReceivedILS, 'income')}
              {renderActualCard(t('home.actuals.unpaid'), unpaidUSD, unpaidILS, unifiedUnpaidILS, 'neutral')}
              {renderActualCard(t('home.actuals.expenses'), expensesUSD, expensesILS, unifiedExpensesILS, 'expense')}
              {renderActualCard(t('home.actuals.net'), netUSD, netILS, unifiedNetILS, 'net')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
