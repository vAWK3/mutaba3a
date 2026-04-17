/**
 * PredictiveKpiStrip Component
 *
 * A row of 3 forecast KPI cards for the Home page:
 * 1. "Will I Make It?" - End-of-month projected position
 * 2. "Cash on Hand" - Current balance based on actuals
 * 3. "Coming / Leaving" - Expected inflows vs outflows
 *
 * Each card:
 * - Shows currency tabs (ILS, USD, Both)
 * - Never silently sums currencies
 * - Includes help tooltip explaining methodology
 *
 * Per design doc: Home shows current month only, no toggles.
 * Forecast always includes unpaid income and projected retainer.
 */

import { useState } from 'react';
import { formatAmount, cn } from '../../lib/utils';
import { getCurrentMonthKey } from '../../lib/monthDetection';
import { useLanguage, getLocale, useT } from '../../lib/i18n';
import { useFxRate } from '../../hooks/useFxRate';
import { useProfileFilter } from '../../hooks/useActiveProfile';
import { getUnifiedTotalWithEur } from '../../lib/fx';
import { useMonthKPIsBothCurrencies } from '../../hooks/useMoneyAnswersQueries';
import { InfoIcon } from '../icons';

type CurrencyView = 'ILS' | 'USD' | 'Both';

interface ForecastCardProps {
  label: string;
  helpText: string;
  subtitle: string;
  usdAmountMinor: number;
  ilsAmountMinor: number;
  type: 'forecast' | 'balance' | 'neutral';
  className?: string;
}

/**
 * Single forecast KPI card with currency tabs and help tooltip
 */
function ForecastCard({
  label,
  helpText,
  subtitle,
  usdAmountMinor,
  ilsAmountMinor,
  type,
  className,
}: ForecastCardProps) {
  const [currencyView, setCurrencyView] = useState<CurrencyView>('ILS');
  const [showHelp, setShowHelp] = useState(false);
  const { language } = useLanguage();
  const locale = getLocale(language);
  const { rate: usdToIlsRate } = useFxRate('USD', 'ILS');

  // Calculate unified ILS total (no EUR for forecast currently)
  const unifiedILS = getUnifiedTotalWithEur(usdAmountMinor, ilsAmountMinor, 0, usdToIlsRate, null) ?? 0;

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
    if (type === 'balance') return ''; // Neutral
    // For forecast, color depends on value
    return unifiedILS >= 0 ? 'amount-positive' : 'amount-negative';
  };

  const colorClass = getColorClass();

  return (
    <div className={cn('kpi-card kpi-card-tabbed kpi-card-forecast', className)}>
      <div className="kpi-label">
        {label}
        <button
          className="kpi-help-btn"
          onClick={() => setShowHelp(!showHelp)}
          aria-label={`Help: ${label}`}
          title={helpText}
        >
          <InfoIcon className="kpi-help-icon" />
        </button>
      </div>

      {/* Help tooltip */}
      {showHelp && (
        <div className="kpi-help-tooltip">
          {helpText}
        </div>
      )}

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

      {/* Subtitle */}
      <div className="kpi-subtitle">{subtitle}</div>
    </div>
  );
}

interface ComingLeavingCardProps {
  comingUsdMinor: number;
  comingIlsMinor: number;
  leavingUsdMinor: number;
  leavingIlsMinor: number;
  className?: string;
}

/**
 * Special "Coming / Leaving" card that shows both values
 */
function ComingLeavingCard({
  comingUsdMinor,
  comingIlsMinor,
  leavingUsdMinor,
  leavingIlsMinor,
  className,
}: ComingLeavingCardProps) {
  const [currencyView, setCurrencyView] = useState<CurrencyView>('ILS');
  const [showHelp, setShowHelp] = useState(false);
  const { language } = useLanguage();
  const locale = getLocale(language);
  const t = useT();
  const { rate: usdToIlsRate } = useFxRate('USD', 'ILS');

  // Calculate unified ILS totals
  const unifiedComingILS = getUnifiedTotalWithEur(comingUsdMinor, comingIlsMinor, 0, usdToIlsRate, null) ?? 0;
  const unifiedLeavingILS = getUnifiedTotalWithEur(leavingUsdMinor, leavingIlsMinor, 0, usdToIlsRate, null) ?? 0;

  const netUsdMinor = comingUsdMinor - leavingUsdMinor;
  const unifiedNetILS = unifiedComingILS - unifiedLeavingILS;

  // Format coming/leaving display
  const formatComingLeaving = (comingVal: number, leavingVal: number, currency: 'USD' | 'ILS') => {
    const coming = formatAmount(comingVal, currency, locale);
    const leaving = formatAmount(leavingVal, currency, locale);
    return { coming, leaving };
  };

  const getNetColorClass = (value: number) => {
    return value >= 0 ? 'amount-positive' : 'amount-negative';
  };

  const helpText = t('home.forecast.comingLeavingHelp');

  return (
    <div className={cn('kpi-card kpi-card-tabbed kpi-card-forecast kpi-card-dual', className)}>
      <div className="kpi-label">
        {t('home.forecast.comingLeaving')}
        <button
          className="kpi-help-btn"
          onClick={() => setShowHelp(!showHelp)}
          aria-label={`Help: ${t('home.forecast.comingLeaving')}`}
          title={helpText}
        >
          <InfoIcon className="kpi-help-icon" />
        </button>
      </div>

      {/* Help tooltip */}
      {showHelp && (
        <div className="kpi-help-tooltip">
          {helpText}
        </div>
      )}

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

      {/* Dual value display */}
      {currencyView === 'Both' ? (
        <div className="kpi-dual-values" data-testid="kpi-value">
          {/* USD row */}
          <div className="kpi-dual-row">
            <span className="kpi-dual-item amount-positive">
              ↑ {formatAmount(comingUsdMinor, 'USD', locale)}
            </span>
            <span className="kpi-dual-separator">/</span>
            <span className="kpi-dual-item amount-negative">
              ↓ {formatAmount(leavingUsdMinor, 'USD', locale)}
            </span>
          </div>
          {/* ILS row */}
          <div className="kpi-dual-row">
            <span className="kpi-dual-item amount-positive">
              ↑ {formatAmount(comingIlsMinor, 'ILS', locale)}
            </span>
            <span className="kpi-dual-separator">/</span>
            <span className="kpi-dual-item amount-negative">
              ↓ {formatAmount(leavingIlsMinor, 'ILS', locale)}
            </span>
          </div>
        </div>
      ) : (
        <div className="kpi-dual-values" data-testid="kpi-value">
          {currencyView === 'USD' ? (
            <>
              <div className="kpi-dual-main">
                <span className="kpi-dual-item amount-positive">
                  ↑ {formatComingLeaving(comingUsdMinor, leavingUsdMinor, 'USD').coming}
                </span>
                <span className="kpi-dual-separator">/</span>
                <span className="kpi-dual-item amount-negative">
                  ↓ {formatComingLeaving(comingUsdMinor, leavingUsdMinor, 'USD').leaving}
                </span>
              </div>
              <div className={cn('kpi-dual-net', getNetColorClass(netUsdMinor))}>
                {t('home.forecast.net')}: {formatAmount(netUsdMinor, 'USD', locale)}
              </div>
            </>
          ) : (
            <>
              <div className="kpi-dual-main">
                <span className="kpi-dual-item amount-positive">
                  ↑ {formatAmount(unifiedComingILS, 'ILS', locale)}
                </span>
                <span className="kpi-dual-separator">/</span>
                <span className="kpi-dual-item amount-negative">
                  ↓ {formatAmount(unifiedLeavingILS, 'ILS', locale)}
                </span>
              </div>
              <div className={cn('kpi-dual-net', getNetColorClass(unifiedNetILS))}>
                {t('home.forecast.net')}: {formatAmount(unifiedNetILS, 'ILS', locale)}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export interface PredictiveKpiStripProps {
  className?: string;
}

/**
 * PredictiveKpiStrip - 3 forecast cards for Home page
 *
 * Always shows current month forecast with:
 * - includeUnpaidIncome: true
 * - includeProjectedRetainer: true
 * (Home has no toggles - full picture always)
 */
export function PredictiveKpiStrip({ className }: PredictiveKpiStripProps) {
  const t = useT();
  const currentMonth = getCurrentMonthKey();
  const profileId = useProfileFilter();

  // Fetch forecast KPIs for current month (both currencies)
  // Home always includes unpaid income and projected retainer
  const { data: kpis, isLoading } = useMonthKPIsBothCurrencies(
    currentMonth,
    0, // opening balance USD
    0, // opening balance ILS
    true, // includeUnpaidIncome
    true, // includeProjectedRetainer
    profileId
  );

  if (isLoading || !kpis) {
    return (
      <div className={cn('kpi-row kpi-row-predictive', className)}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="kpi-card kpi-card-tabbed kpi-card-forecast">
            <div className="kpi-label">{t('common.loading')}</div>
            <div className="kpi-tabs" />
            <div className="kpi-value">-</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn('kpi-row kpi-row-predictive', className)}>
      {/* Card 1: Will I Make It? */}
      <ForecastCard
        label={t('home.forecast.willMakeIt')}
        helpText={t('home.forecast.willMakeItHelp')}
        subtitle={t('home.forecast.endOfMonth')}
        usdAmountMinor={kpis.USD.willMakeItMinor}
        ilsAmountMinor={kpis.ILS.willMakeItMinor}
        type="forecast"
      />

      {/* Card 2: Cash on Hand */}
      <ForecastCard
        label={t('home.forecast.cashOnHand')}
        helpText={t('home.forecast.cashOnHandHelp')}
        subtitle={t('home.forecast.currentBalance')}
        usdAmountMinor={kpis.USD.cashOnHandMinor}
        ilsAmountMinor={kpis.ILS.cashOnHandMinor}
        type="balance"
      />

      {/* Card 3: Coming / Leaving */}
      <ComingLeavingCard
        comingUsdMinor={kpis.USD.comingMinor}
        comingIlsMinor={kpis.ILS.comingMinor}
        leavingUsdMinor={kpis.USD.leakingMinor}
        leavingIlsMinor={kpis.ILS.leakingMinor}
      />
    </div>
  );
}
