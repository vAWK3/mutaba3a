import { useMemo, useState } from 'react';
import { useT } from '../../../lib/i18n';
import type { Currency, MonthSummary } from '../../../types';

interface MonthlyTrendBarsProps {
  months: MonthSummary[];
  currency: Currency;
  year: number;
  onMonthClick: (monthKey: string) => void;
}

const MONTH_LABELS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LABELS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

function formatAmount(amountMinor: number, currency: Currency): string {
  const absAmount = Math.abs(amountMinor);
  const formatted = (absAmount / 100).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return `${currency} ${formatted}`;
}

export function MonthlyTrendBars({ months, currency, year, onMonthClick }: MonthlyTrendBarsProps) {
  const t = useT();
  const [hoveredMonth, setHoveredMonth] = useState<number | null>(null);

  // Determine if we're in RTL mode (Arabic)
  const isRTL = document.documentElement.dir === 'rtl';
  const monthLabels = isRTL ? MONTH_LABELS_AR : MONTH_LABELS_EN;

  // Calculate the max value for scaling bars
  const maxValue = useMemo(() => {
    let max = 0;
    for (const month of months) {
      max = Math.max(max, month.totalInflowMinor, month.totalOutflowMinor);
    }
    return max || 1; // Prevent division by zero
  }, [months]);

  // Get current month to highlight it
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed

  // Check if there's any data
  const hasData = months.some(m => m.totalInflowMinor > 0 || m.totalOutflowMinor > 0);

  if (!hasData) {
    return (
      <div className="monthly-trend-bars">
        <div className="section-title">{t('moneyAnswers.yearMode.monthlyTrend')}</div>
        <div className="trend-bars-empty">
          {t('moneyAnswers.yearMode.noDataForYear')}
        </div>
      </div>
    );
  }

  return (
    <div className="monthly-trend-bars">
      <div className="section-title">{t('moneyAnswers.yearMode.monthlyTrend')}</div>
      <div className="trend-bars-container">
        {months.map((month, index) => {
          const inflowHeight = (month.totalInflowMinor / maxValue) * 100;
          const outflowHeight = (month.totalOutflowMinor / maxValue) * 100;
          const isCurrentMonth = year === currentYear && index === currentMonth;
          const isHovered = hoveredMonth === index;

          return (
            <div
              key={month.month}
              className={`trend-bar-column ${isCurrentMonth ? 'current' : ''} ${isHovered ? 'hovered' : ''}`}
              onClick={() => onMonthClick(month.month)}
              onMouseEnter={() => setHoveredMonth(index)}
              onMouseLeave={() => setHoveredMonth(null)}
            >
              <div className="trend-bar-bars">
                <div
                  className="trend-bar inflow"
                  style={{ height: `${Math.max(inflowHeight, 2)}%` }}
                />
                <div
                  className="trend-bar outflow"
                  style={{ height: `${Math.max(outflowHeight, 2)}%` }}
                />
              </div>
              <div className="trend-bar-label">{monthLabels[index]}</div>

              {/* Tooltip */}
              {isHovered && (
                <div className="trend-bar-tooltip">
                  <div className="tooltip-title">{monthLabels[index]} {year}</div>
                  <div className="tooltip-row inflow">
                    <span>{t('moneyAnswers.legend.inflow')}:</span>
                    <span>{formatAmount(month.totalInflowMinor, currency)}</span>
                  </div>
                  <div className="tooltip-row outflow">
                    <span>{t('moneyAnswers.legend.outflow')}:</span>
                    <span>{formatAmount(month.totalOutflowMinor, currency)}</span>
                  </div>
                  <div className="tooltip-row net">
                    <span>{t('moneyAnswers.dayDetail.net')}:</span>
                    <span className={month.netMinor >= 0 ? 'positive' : 'negative'}>
                      {month.netMinor >= 0 ? '+' : ''}{formatAmount(month.netMinor, currency)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="trend-bars-legend">
        <div className="legend-item">
          <div className="legend-color inflow" />
          <span>{t('moneyAnswers.legend.inflow')}</span>
        </div>
        <div className="legend-item">
          <div className="legend-color outflow" />
          <span>{t('moneyAnswers.legend.outflow')}</span>
        </div>
      </div>
    </div>
  );
}
