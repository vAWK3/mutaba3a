import { useMemo } from 'react';
import { useT } from '../../../lib/i18n';
import { useDrawerStore } from '../../../lib/stores';
import type { Currency, DailyAggregate } from '../../../types';

interface CashFlowTimelineProps {
  dailyAggregates: DailyAggregate[];
  currency: Currency;
}

function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.getDate().toString();
}

function isToday(dateStr: string): boolean {
  const today = new Date().toISOString().split('T')[0];
  return dateStr === today;
}

export function CashFlowTimeline({ dailyAggregates, currency }: CashFlowTimelineProps) {
  const t = useT();
  const openDayDetailDrawer = useDrawerStore((s) => s.openDayDetailDrawer);

  // Calculate max values for scaling bars
  const maxValues = useMemo(() => {
    let maxInflow = 0;
    let maxOutflow = 0;
    let maxBalance = 0;
    let minBalance = 0;

    for (const day of dailyAggregates) {
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
  }, [dailyAggregates]);

  // Generate balance line path
  const balancePath = useMemo(() => {
    if (dailyAggregates.length === 0) return '';

    const points: string[] = [];
    const width = 100 / dailyAggregates.length;

    dailyAggregates.forEach((day, index) => {
      const x = (index + 0.5) * width;
      const normalizedBalance = (day.runningBalanceMinor - maxValues.minBalance) / maxValues.balanceRange;
      const y = 100 - (normalizedBalance * 80 + 10); // Leave 10% margin top/bottom
      points.push(`${x},${y}`);
    });

    return `M ${points.join(' L ')}`;
  }, [dailyAggregates, maxValues]);

  if (dailyAggregates.length === 0) {
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
        {dailyAggregates.map((day) => {
          const inflowHeight = (day.inflowMinor / maxValues.maxBar) * 100;
          const outflowHeight = (day.outflowMinor / maxValues.maxBar) * 100;
          const hasEvents = day.events.length > 0;

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
              aria-label={`${day.date}: ${day.events.length} events`}
            >
              <div className="timeline-bars">
                {inflowHeight > 0 && (
                  <div
                    className="timeline-bar inflow"
                    style={{ height: `${Math.max(inflowHeight, 2)}%` }}
                    title={`+${currency} ${(day.inflowMinor / 100).toFixed(2)}`}
                  />
                )}
                {outflowHeight > 0 && (
                  <div
                    className="timeline-bar outflow"
                    style={{ height: `${Math.max(outflowHeight, 2)}%` }}
                    title={`-${currency} ${(day.outflowMinor / 100).toFixed(2)}`}
                  />
                )}
                {!hasEvents && (
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
      </div>
    </div>
  );
}
