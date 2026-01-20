import { useT } from '../../../lib/i18n';
import type { Currency } from '../../../types';

interface KPIs {
  willMakeItMinor: number;
  cashOnHandMinor: number;
  comingMinor: number;
  leakingMinor: number;
  netForecastMinor: number;
}

interface KpiStripProps {
  kpis?: KPIs;
  currency: Currency;
}

function formatAmount(amountMinor: number, currency: Currency): string {
  const absAmount = Math.abs(amountMinor);
  const formatted = (absAmount / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${formatted}`;
}

export function KpiStrip({ kpis, currency }: KpiStripProps) {
  const t = useT();

  if (!kpis) {
    return (
      <div className="kpi-strip">
        <KpiCardSkeleton />
        <KpiCardSkeleton />
        <KpiCardSkeleton />
      </div>
    );
  }

  return (
    <div className="kpi-strip">
      {/* Will I Make It? */}
      <div className="kpi-card">
        <div className="kpi-card-label">{t('moneyAnswers.kpi.willMakeIt')}</div>
        <div className={`kpi-card-value ${kpis.willMakeItMinor >= 0 ? 'positive' : 'negative'}`}>
          {kpis.willMakeItMinor < 0 && '-'}
          {formatAmount(kpis.willMakeItMinor, currency)}
        </div>
        <div className="kpi-card-subtitle">{t('moneyAnswers.kpi.endOfMonthForecast')}</div>
      </div>

      {/* Cash on Hand */}
      <div className="kpi-card">
        <div className="kpi-card-label">{t('moneyAnswers.kpi.cashOnHand')}</div>
        <div className={`kpi-card-value ${kpis.cashOnHandMinor >= 0 ? 'positive' : 'negative'}`}>
          {kpis.cashOnHandMinor < 0 && '-'}
          {formatAmount(kpis.cashOnHandMinor, currency)}
        </div>
        <div className="kpi-card-subtitle">{t('moneyAnswers.kpi.currentBalance')}</div>
      </div>

      {/* Coming vs Leaking */}
      <div className="kpi-card">
        <div className="kpi-card-label">{t('moneyAnswers.kpi.comingVsLeaking')}</div>
        <div className="kpi-card-coming-leaking">
          <span className="kpi-incoming">
            <ArrowUpIcon />
            {formatAmount(kpis.comingMinor, currency)}
          </span>
          <span className="kpi-divider">/</span>
          <span className="kpi-outgoing">
            <ArrowDownIcon />
            {formatAmount(kpis.leakingMinor, currency)}
          </span>
        </div>
        <div className="kpi-card-subtitle">
          {t('moneyAnswers.kpi.netForecast')}: {' '}
          <span className={kpis.netForecastMinor >= 0 ? 'positive' : 'negative'}>
            {kpis.netForecastMinor >= 0 ? '+' : ''}
            {formatAmount(kpis.netForecastMinor, currency)}
          </span>
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
      <div className="kpi-card-subtitle skeleton" style={{ width: '50%', height: '12px', marginTop: '8px' }} />
    </div>
  );
}

function ArrowUpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" />
    </svg>
  );
}

function ArrowDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 4.5 15 15m0 0V8.25m0 11.25H8.25" />
    </svg>
  );
}
