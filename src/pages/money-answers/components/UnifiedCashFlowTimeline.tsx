import { useMemo } from 'react';
import { useT } from '../../../lib/i18n';
import { useDrawerStore } from '../../../lib/stores';
import { useFxRate } from '../../../hooks/useFxRate';
import { getUnifiedTotal } from '../../../lib/fx';
import { formatAmount } from '../../../lib/utils';
import { useLanguage, getLocale } from '../../../lib/i18n';
import type { DailyAggregate } from '../../../types';

interface UnifiedCashFlowTimelineProps {
  dailyAggregatesUSD: DailyAggregate[];
  dailyAggregatesILS: DailyAggregate[];
}

function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.getDate().toString();
}

function isToday(dateStr: string): boolean {
  const today = new Date().toISOString().split('T')[0];
  return dateStr === today;
}

export function UnifiedCashFlowTimeline({ dailyAggregatesUSD, dailyAggregatesILS }: UnifiedCashFlowTimelineProps) {
  const t = useT();
  const openDayDetailDrawer = useDrawerStore((s) => s.openDayDetailDrawer);
  const { rate } = useFxRate('USD', 'ILS');
  const { language } = useLanguage();
  const locale = getLocale(language);

  // Merge daily aggregates from both currencies into unified values
  const unifiedAggregates = useMemo(() => {
    // Create a map of dates to USD values
    const usdMap = new Map<string, DailyAggregate>();
    for (const day of dailyAggregatesUSD) {
      usdMap.set(day.date, day);
    }

    // Create a map of dates to ILS values
    const ilsMap = new Map<string, DailyAggregate>();
    for (const day of dailyAggregatesILS) {
      ilsMap.set(day.date, day);
    }

    // Get all unique dates
    const allDates = new Set([
      ...dailyAggregatesUSD.map(d => d.date),
      ...dailyAggregatesILS.map(d => d.date),
    ]);

    // Sort dates
    const sortedDates = Array.from(allDates).sort();

    // Calculate unified values for each date
    return sortedDates.map(date => {
      const usd = usdMap.get(date);
      const ils = ilsMap.get(date);

      const inflowMinor = getUnifiedTotal(
        usd?.inflowMinor || 0,
        ils?.inflowMinor || 0,
        'ILS',
        rate
      ) || 0;

      const outflowMinor = getUnifiedTotal(
        usd?.outflowMinor || 0,
        ils?.outflowMinor || 0,
        'ILS',
        rate
      ) || 0;

      const runningBalanceMinor = getUnifiedTotal(
        usd?.runningBalanceMinor || 0,
        ils?.runningBalanceMinor || 0,
        'ILS',
        rate
      ) || 0;

      return {
        date,
        inflowMinor,
        outflowMinor,
        runningBalanceMinor,
        // Keep original values for tooltip
        usdInflow: usd?.inflowMinor || 0,
        usdOutflow: usd?.outflowMinor || 0,
        ilsInflow: ils?.inflowMinor || 0,
        ilsOutflow: ils?.outflowMinor || 0,
        hasEvents: (usd?.events?.length || 0) + (ils?.events?.length || 0) > 0,
      };
    });
  }, [dailyAggregatesUSD, dailyAggregatesILS, rate]);

  // Calculate max values for scaling bars
  const maxValues = useMemo(() => {
    let maxInflow = 0;
    let maxOutflow = 0;
    let maxBalance = 0;
    let minBalance = 0;

    for (const day of unifiedAggregates) {
      maxInflow = Math.max(maxInflow, day.inflowMinor);
      maxOutflow = Math.max(maxOutflow, day.outflowMinor);
      maxBalance = Math.max(maxBalance, day.runningBalanceMinor);
      minBalance = Math.min(minBalance, day.runningBalanceMinor);
    }

    return {
      maxBar: Math.max(maxInflow, maxOutflow, 1), // Prevent division by zero
      maxBalance,
      minBalance,
      balanceRange: maxBalance - minBalance || 1,
    };
  }, [unifiedAggregates]);

  // Generate balance line path
  const balancePath = useMemo(() => {
    if (unifiedAggregates.length === 0) return '';

    const points: string[] = [];
    const width = 100 / unifiedAggregates.length;

    unifiedAggregates.forEach((day, index) => {
      const x = (index + 0.5) * width;
      const normalizedBalance = (day.runningBalanceMinor - maxValues.minBalance) / maxValues.balanceRange;
      const y = 100 - (normalizedBalance * 80 + 10); // Leave 10% margin top/bottom
      points.push(`${x},${y}`);
    });

    return `M ${points.join(' L ')}`;
  }, [unifiedAggregates, maxValues]);

  if (unifiedAggregates.length === 0) {
    return (
      <div className="timeline-container">
        <div className="timeline-empty">{t('moneyAnswers.noData')}</div>
      </div>
    );
  }

  const handleDayClick = (date: string) => {
    openDayDetailDrawer({ date });
  };

  return (
    <div className="timeline-container">
      <div className="timeline-chart">
        {unifiedAggregates.map((day) => {
          const inflowHeight = (day.inflowMinor / maxValues.maxBar) * 100;
          const outflowHeight = (day.outflowMinor / maxValues.maxBar) * 100;

          return (
            <div
              key={day.date}
              className={`timeline-day ${isToday(day.date) ? 'today' : ''}`}
              onClick={() => handleDayClick(day.date)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  handleDayClick(day.date);
                }
              }}
              aria-label={`${day.date}`}
            >
              <div className="timeline-bars">
                {inflowHeight > 0 && (
                  <div
                    className="timeline-bar inflow"
                    style={{ height: `${Math.max(inflowHeight, 2)}%` }}
                    title={`+${formatAmount(day.inflowMinor, 'ILS', locale)} (USD: ${formatAmount(day.usdInflow, 'USD', locale)}, ILS: ${formatAmount(day.ilsInflow, 'ILS', locale)})`}
                  />
                )}
                {outflowHeight > 0 && (
                  <div
                    className="timeline-bar outflow"
                    style={{ height: `${Math.max(outflowHeight, 2)}%` }}
                    title={`-${formatAmount(day.outflowMinor, 'ILS', locale)} (USD: ${formatAmount(day.usdOutflow, 'USD', locale)}, ILS: ${formatAmount(day.ilsOutflow, 'ILS', locale)})`}
                  />
                )}
                {!day.hasEvents && (
                  <div className="timeline-bar empty" style={{ height: '2px', opacity: 0.3 }} />
                )}
              </div>
              <div className="timeline-date">{formatShortDate(day.date)}</div>
            </div>
          );
        })}

        {/* Balance line overlay */}
        {balancePath && (
          <div className="timeline-balance-line">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              <path d={balancePath} />
            </svg>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="timeline-legend">
        <div className="legend-item">
          <div className="legend-color inflow" />
          <span>{t('moneyAnswers.legend.inflow')}</span>
        </div>
        <div className="legend-item">
          <div className="legend-color outflow" />
          <span>{t('moneyAnswers.legend.outflow')}</span>
        </div>
        <div className="legend-item">
          <div className="legend-line" />
          <span>{t('moneyAnswers.legend.runningBalance')}</span>
        </div>
        <div className="legend-item unified-note">
          <span>{t('moneyAnswers.unifiedNote')}</span>
        </div>
      </div>
    </div>
  );
}
