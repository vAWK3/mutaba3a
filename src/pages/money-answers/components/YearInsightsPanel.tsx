import { useT } from '../../../lib/i18n';
import type { Currency, YearSummary } from '../../../types';

interface YearInsightsPanelProps {
  yearSummary?: YearSummary;
  currency: Currency;
  onMonthClick: (monthKey: string) => void;
}

const MONTH_NAMES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_NAMES_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

function formatAmount(amountMinor: number, currency: Currency): string {
  const absAmount = Math.abs(amountMinor);
  const formatted = (absAmount / 100).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return `${currency} ${formatted}`;
}

function getMonthName(monthKey: string): string {
  const isRTL = document.documentElement.dir === 'rtl';
  const monthNames = isRTL ? MONTH_NAMES_AR : MONTH_NAMES_EN;
  const monthIndex = parseInt(monthKey.split('-')[1], 10) - 1;
  return monthNames[monthIndex];
}

export function YearInsightsPanel({ yearSummary, currency, onMonthClick }: YearInsightsPanelProps) {
  const t = useT();

  if (!yearSummary) {
    return (
      <div className="year-insights-panel">
        <div className="section-title">{t('moneyAnswers.yearMode.insights')}</div>
        <div className="insights-grid">
          <InsightCardSkeleton />
          <InsightCardSkeleton />
        </div>
      </div>
    );
  }

  const bestMonthData = yearSummary.bestMonth
    ? yearSummary.months.find(m => m.month === yearSummary.bestMonth)
    : null;
  const worstMonthData = yearSummary.worstMonth
    ? yearSummary.months.find(m => m.month === yearSummary.worstMonth)
    : null;

  // Calculate year trend (comparing first half vs second half)
  const firstHalf = yearSummary.months.slice(0, 6);
  const secondHalf = yearSummary.months.slice(6);
  const firstHalfNet = firstHalf.reduce((sum, m) => sum + m.netMinor, 0);
  const secondHalfNet = secondHalf.reduce((sum, m) => sum + m.netMinor, 0);
  const isUptrend = secondHalfNet >= firstHalfNet;

  return (
    <div className="year-insights-panel">
      <div className="section-title">{t('moneyAnswers.yearMode.insights')}</div>
      <div className="insights-grid">
        {/* Best Month */}
        <div
          className={`insight-card best ${yearSummary.bestMonth ? 'clickable' : ''}`}
          onClick={() => yearSummary.bestMonth && onMonthClick(yearSummary.bestMonth)}
        >
          <div className="insight-icon best">
            <TrophyIcon />
          </div>
          <div className="insight-content">
            <div className="insight-label">{t('moneyAnswers.yearMode.bestMonth')}</div>
            {bestMonthData ? (
              <>
                <div className="insight-value">{getMonthName(yearSummary.bestMonth!)}</div>
                <div className="insight-amount positive">
                  +{formatAmount(bestMonthData.netMinor, currency)}
                </div>
              </>
            ) : (
              <div className="insight-value muted">{t('moneyAnswers.noData')}</div>
            )}
          </div>
        </div>

        {/* Worst Month */}
        <div
          className={`insight-card worst ${yearSummary.worstMonth ? 'clickable' : ''}`}
          onClick={() => yearSummary.worstMonth && onMonthClick(yearSummary.worstMonth)}
        >
          <div className="insight-icon worst">
            <ChartDownIcon />
          </div>
          <div className="insight-content">
            <div className="insight-label">{t('moneyAnswers.yearMode.worstMonth')}</div>
            {worstMonthData ? (
              <>
                <div className="insight-value">{getMonthName(yearSummary.worstMonth!)}</div>
                <div className={`insight-amount ${worstMonthData.netMinor >= 0 ? 'positive' : 'negative'}`}>
                  {worstMonthData.netMinor >= 0 ? '+' : ''}{formatAmount(worstMonthData.netMinor, currency)}
                </div>
              </>
            ) : (
              <div className="insight-value muted">{t('moneyAnswers.noData')}</div>
            )}
          </div>
        </div>

        {/* Year Trend */}
        <div className="insight-card trend">
          <div className={`insight-icon ${isUptrend ? 'up' : 'down'}`}>
            {isUptrend ? <TrendUpIcon /> : <TrendDownIcon />}
          </div>
          <div className="insight-content">
            <div className="insight-label">{t('moneyAnswers.yearMode.yearTrend')}</div>
            <div className="insight-value">
              {isUptrend ? t('moneyAnswers.yearMode.trendUp') : t('moneyAnswers.yearMode.trendDown')}
            </div>
            <div className="insight-subtext">
              {t('moneyAnswers.yearMode.vsFirstHalf')}
            </div>
          </div>
        </div>

        {/* Retainer Health */}
        <div className="insight-card health">
          <div className={`insight-icon ${yearSummary.retainerStabilityPercent >= 80 ? 'good' : yearSummary.retainerStabilityPercent >= 50 ? 'warning' : 'bad'}`}>
            <HeartIcon />
          </div>
          <div className="insight-content">
            <div className="insight-label">{t('moneyAnswers.yearMode.retainerHealth')}</div>
            <div className="insight-value">{yearSummary.retainerStabilityPercent}%</div>
            <div className="insight-subtext">{t('moneyAnswers.yearMode.onTimePayments')}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InsightCardSkeleton() {
  return (
    <div className="insight-card">
      <div className="insight-icon skeleton" />
      <div className="insight-content">
        <div className="insight-label skeleton" style={{ width: '60%', height: '12px' }} />
        <div className="insight-value skeleton" style={{ width: '80%', height: '20px', marginTop: '8px' }} />
      </div>
    </div>
  );
}

function TrophyIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 0 1-.982-3.172M9.497 14.25a7.454 7.454 0 0 0 .981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 0 0 7.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0 1 16.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.997 6.997 0 0 1-2.52.952m0 0a7.024 7.024 0 0 1-2.5 0m0 0a6.997 6.997 0 0 1-2.52-.952" />
    </svg>
  );
}

function ChartDownIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6 9 12.75l4.286-4.286a11.948 11.948 0 0 1 4.306 6.43l.776 2.898m0 0 3.182-5.511m-3.182 5.51-5.511-3.181" />
    </svg>
  );
}

function TrendUpIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" />
    </svg>
  );
}

function TrendDownIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6 9 12.75l4.286-4.286a11.948 11.948 0 0 1 4.306 6.43l.776 2.898m0 0 3.182-5.511m-3.182 5.51-5.511-3.181" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
    </svg>
  );
}
