import { useT } from '../../../lib/i18n';
import { useYearSummary } from '../../../hooks/useMoneyAnswersQueries';
import type { Currency } from '../../../types';
import { YearKpiStrip } from './YearKpiStrip';
import { MonthlyTrendBars } from './MonthlyTrendBars';
import { YearInsightsPanel } from './YearInsightsPanel';

interface YearModeViewProps {
  year: number;
  currency: Currency;
  includeReceivables: boolean;
  includeProjections: boolean;
  onMonthClick: (monthKey: string) => void;
}

export function YearModeView({
  year,
  currency,
  includeReceivables,
  includeProjections,
  onMonthClick,
}: YearModeViewProps) {
  const t = useT();

  const { data: yearSummary, isLoading } = useYearSummary(
    year,
    currency,
    includeReceivables,
    includeProjections
  );

  if (isLoading) {
    return (
      <div className="year-mode-view">
        <YearKpiStrip yearSummary={undefined} currency={currency} />
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
      <YearKpiStrip yearSummary={yearSummary} currency={currency} />

      {/* Monthly Trend Chart */}
      <section className="year-chart-section">
        <MonthlyTrendBars
          months={yearSummary?.months || []}
          currency={currency}
          year={year}
          onMonthClick={onMonthClick}
        />
      </section>

      {/* Year Insights */}
      <section className="year-insights-section">
        <YearInsightsPanel
          yearSummary={yearSummary}
          currency={currency}
          onMonthClick={onMonthClick}
        />
      </section>
    </div>
  );
}
