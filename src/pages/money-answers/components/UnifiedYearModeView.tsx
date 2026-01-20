import { useT } from '../../../lib/i18n';
import { useYearSummaryBothCurrencies } from '../../../hooks/useMoneyAnswersQueries';
import { UnifiedYearKpiStrip } from './UnifiedYearKpiStrip';
import { UnifiedMonthlyTrendBars } from './UnifiedMonthlyTrendBars';
// TODO: Create UnifiedYearInsightsPanel component
// import { UnifiedYearInsightsPanel } from './UnifiedYearInsightsPanel';

interface UnifiedYearModeViewProps {
  year: number;
  includeReceivables: boolean;
  includeProjections: boolean;
  onMonthClick: (monthKey: string) => void;
}

export function UnifiedYearModeView({
  year,
  includeReceivables,
  includeProjections,
  onMonthClick,
}: UnifiedYearModeViewProps) {
  const t = useT();

  const { data: yearSummaries, isLoading } = useYearSummaryBothCurrencies(
    year,
    includeReceivables,
    includeProjections
  );

  if (isLoading) {
    return (
      <div className="year-mode-view">
        <UnifiedYearKpiStrip yearSummaryUSD={undefined} yearSummaryILS={undefined} />
        <div className="year-mode-content">
          <div className="loading-state">
            <span>{t('common.loading')}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="year-mode-view">
      {/* Year KPIs */}
      <UnifiedYearKpiStrip
        yearSummaryUSD={yearSummaries?.USD}
        yearSummaryILS={yearSummaries?.ILS}
      />

      {/* Monthly Trend Chart */}
      <section className="year-chart-section">
        <UnifiedMonthlyTrendBars
          monthsUSD={yearSummaries?.USD?.months || []}
          monthsILS={yearSummaries?.ILS?.months || []}
          year={year}
          onMonthClick={onMonthClick}
        />
      </section>

      {/* Year Insights - TODO: Create UnifiedYearInsightsPanel */}
      {/* <section className="year-insights-section">
        <UnifiedYearInsightsPanel
          yearSummaryUSD={yearSummaries?.USD}
          yearSummaryILS={yearSummaries?.ILS}
          onMonthClick={onMonthClick}
        />
      </section> */}
    </div>
  );
}
