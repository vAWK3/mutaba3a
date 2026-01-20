import { useT } from '../../../lib/i18n';
import { CurrencySummaryPopup } from '../../../components/ui/CurrencySummaryPopup';
import type { YearSummary } from '../../../types';

interface UnifiedYearKpiStripProps {
  yearSummaryUSD?: YearSummary;
  yearSummaryILS?: YearSummary;
}

export function UnifiedYearKpiStrip({ yearSummaryUSD, yearSummaryILS }: UnifiedYearKpiStripProps) {
  const t = useT();

  if (!yearSummaryUSD || !yearSummaryILS) {
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

  // Average the stability percentages
  const avgStability = Math.round(
    (yearSummaryUSD.retainerStabilityPercent + yearSummaryILS.retainerStabilityPercent) / 2
  );

  return (
    <div className="year-kpi-strip">
      {/* Total Inflow */}
      <div className="kpi-card">
        <div className="kpi-card-label">{t('moneyAnswers.yearMode.totalInflow')}</div>
        <div className="kpi-card-value-unified">
          <CurrencySummaryPopup
            usdAmountMinor={yearSummaryUSD.totalInflowMinor}
            ilsAmountMinor={yearSummaryILS.totalInflowMinor}
            type="income"
            size="large"
          />
        </div>
      </div>

      {/* Total Outflow */}
      <div className="kpi-card">
        <div className="kpi-card-label">{t('moneyAnswers.yearMode.totalOutflow')}</div>
        <div className="kpi-card-value-unified">
          <CurrencySummaryPopup
            usdAmountMinor={yearSummaryUSD.totalOutflowMinor}
            ilsAmountMinor={yearSummaryILS.totalOutflowMinor}
            type="expense"
            size="large"
          />
        </div>
      </div>

      {/* Net Income */}
      <div className="kpi-card">
        <div className="kpi-card-label">{t('moneyAnswers.yearMode.netIncome')}</div>
        <div className="kpi-card-value-unified">
          <CurrencySummaryPopup
            usdAmountMinor={yearSummaryUSD.netMinor}
            ilsAmountMinor={yearSummaryILS.netMinor}
            type="net"
            size="large"
          />
        </div>
      </div>

      {/* Avg Awaiting */}
      <div className="kpi-card">
        <div className="kpi-card-label">{t('moneyAnswers.yearMode.avgAwaiting')}</div>
        <div className="kpi-card-value-unified">
          <CurrencySummaryPopup
            usdAmountMinor={yearSummaryUSD.avgAwaitingMinor}
            ilsAmountMinor={yearSummaryILS.avgAwaitingMinor}
            type="neutral"
            size="large"
          />
        </div>
      </div>

      {/* Retainer Stability */}
      <div className="kpi-card">
        <div className="kpi-card-label">{t('moneyAnswers.yearMode.retainerStability')}</div>
        <div className={`kpi-card-value ${avgStability >= 80 ? 'positive' : avgStability >= 50 ? '' : 'negative'}`}>
          {avgStability}%
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
