import { useT } from '../../../lib/i18n';
import type { Currency, YearSummary } from '../../../types';

interface YearKpiStripProps {
  yearSummary?: YearSummary;
  currency: Currency;
}

function formatAmount(amountMinor: number, currency: Currency): string {
  const absAmount = Math.abs(amountMinor);
  const formatted = (absAmount / 100).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return `${currency} ${formatted}`;
}

export function YearKpiStrip({ yearSummary, currency }: YearKpiStripProps) {
  const t = useT();

  if (!yearSummary) {
    return (
      <div className="year-kpi-strip">
        <KpiCardSkeleton />
        <KpiCardSkeleton />
        <KpiCardSkeleton />
        <KpiCardSkeleton />
        <KpiCardSkeleton />
      </div>
    );
  }

  return (
    <div className="year-kpi-strip">
      {/* Total Inflow */}
      <div className="kpi-card">
        <div className="kpi-card-label">{t('moneyAnswers.yearMode.totalInflow')}</div>
        <div className="kpi-card-value positive">
          {formatAmount(yearSummary.totalInflowMinor, currency)}
        </div>
      </div>

      {/* Total Outflow */}
      <div className="kpi-card">
        <div className="kpi-card-label">{t('moneyAnswers.yearMode.totalOutflow')}</div>
        <div className="kpi-card-value negative">
          {formatAmount(yearSummary.totalOutflowMinor, currency)}
        </div>
      </div>

      {/* Net Income */}
      <div className="kpi-card">
        <div className="kpi-card-label">{t('moneyAnswers.yearMode.netIncome')}</div>
        <div className={`kpi-card-value ${yearSummary.netMinor >= 0 ? 'positive' : 'negative'}`}>
          {yearSummary.netMinor < 0 && '-'}
          {formatAmount(yearSummary.netMinor, currency)}
        </div>
      </div>

      {/* Avg Awaiting */}
      <div className="kpi-card">
        <div className="kpi-card-label">{t('moneyAnswers.yearMode.avgAwaiting')}</div>
        <div className="kpi-card-value">
          {formatAmount(yearSummary.avgAwaitingMinor, currency)}
        </div>
      </div>

      {/* Retainer Stability */}
      <div className="kpi-card">
        <div className="kpi-card-label">{t('moneyAnswers.yearMode.retainerStability')}</div>
        <div className={`kpi-card-value ${yearSummary.retainerStabilityPercent >= 80 ? 'positive' : yearSummary.retainerStabilityPercent >= 50 ? '' : 'negative'}`}>
          {yearSummary.retainerStabilityPercent}%
        </div>
      </div>
    </div>
  );
}

function KpiCardSkeleton() {
  return (
    <div className="kpi-card">
      <div className="kpi-card-label skeleton" style={{ width: '60%', height: '12px' }} />
      <div className="kpi-card-value skeleton" style={{ width: '80%', height: '28px', marginTop: '8px' }} />
    </div>
  );
}
