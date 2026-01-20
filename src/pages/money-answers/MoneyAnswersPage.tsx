import { useMemo } from 'react';
import { useSearch, useNavigate } from '@tanstack/react-router';
import { useT } from '../../lib/i18n';
import { useDrawerStore } from '../../lib/stores';
import type { MoneyAnswersFilters } from '../../types';
import { useDailyAggregates, useGuidance, useMonthKPIsBothCurrencies } from '../../hooks/useMoneyAnswersQueries';
import { UnifiedKpiStrip } from './components/UnifiedKpiStrip';
import { UnifiedCashFlowTimeline } from './components/UnifiedCashFlowTimeline';
import { GuidanceFeed } from './components/GuidanceFeed';
import { UnifiedYearModeView } from './components/UnifiedYearModeView';
import { DayDetailDrawer } from '../../components/drawers/DayDetailDrawer';
import './MoneyAnswersPage.css';

// Mode type
type ViewMode = 'month' | 'year';

// Get current month in YYYY-MM format
function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Get current year
function getCurrentYear(): number {
  return new Date().getFullYear();
}

// Format month for display
function formatMonthDisplay(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// Navigate to previous/next month
function adjustMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function MoneyAnswersPage() {
  const t = useT();
  const navigate = useNavigate();
  const search = useSearch({ from: '/money-answers' });

  // Get drawer state
  const dayDetailDrawer = useDrawerStore((s) => s.dayDetailDrawer);
  const closeDayDetailDrawer = useDrawerStore((s) => s.closeDayDetailDrawer);

  // Derive mode from URL (default to month)
  const mode: ViewMode = (search.mode as ViewMode) || 'month';

  // Derive year from URL (default to current year)
  const year = search.year ? Number(search.year) : getCurrentYear();

  // Derive filters from URL search params with defaults
  const filters: MoneyAnswersFilters = useMemo(() => ({
    month: search.month || getCurrentMonth(),
    year,
    currency: 'USD', // Default, but we fetch both currencies
    includeReceivables: search.includeReceivables !== false,
    includeProjections: search.includeProjections !== false,
  }), [search.month, search.includeReceivables, search.includeProjections, year]);

  // Opening balance (could be stored in settings, for now default to 0)
  const openingBalanceMinorUSD = 0;
  const openingBalanceMinorILS = 0;

  // Fetch data for both currencies (unified display)
  const { data: kpis, isLoading: loadingKPIs } = useMonthKPIsBothCurrencies(
    filters.month!,
    openingBalanceMinorUSD,
    openingBalanceMinorILS,
    filters.includeReceivables ?? true,
    filters.includeProjections ?? true
  );

  // Fetch daily aggregates for both currencies
  const { data: dailyAggregatesUSD, isLoading: loadingAggregatesUSD } = useDailyAggregates(
    { ...filters, currency: 'USD' },
    openingBalanceMinorUSD
  );
  const { data: dailyAggregatesILS, isLoading: loadingAggregatesILS } = useDailyAggregates(
    { ...filters, currency: 'ILS' },
    openingBalanceMinorILS
  );

  const { data: guidance, isLoading: loadingGuidance } = useGuidance(filters);

  const isLoading = loadingAggregatesUSD || loadingAggregatesILS || loadingKPIs || loadingGuidance;

  // Handle filter changes
  const updateFilters = (updates: Partial<typeof search>) => {
    navigate({
      to: '/money-answers',
      search: { ...search, ...updates },
      replace: true,
    });
  };

  const handleMonthChange = (delta: number) => {
    const newMonth = adjustMonth(filters.month!, delta);
    updateFilters({ month: newMonth });
  };

  const handleModeChange = (newMode: ViewMode) => {
    updateFilters({ mode: newMode });
  };

  const handleYearChange = (delta: number) => {
    updateFilters({ year: year + delta });
  };

  const handleMonthClick = (monthKey: string) => {
    // Switch to month mode and navigate to the clicked month
    updateFilters({ mode: 'month', month: monthKey });
  };

  return (
    <div className="money-answers-page">
      {/* Header */}
      <header className="money-answers-header">
        <div className="header-left">
          <h1 className="page-title">{t('moneyAnswers.title')}</h1>
        </div>

        <div className="header-controls">
          {/* Mode Toggle */}
          <div className="mode-toggle">
            <button
              type="button"
              className={`mode-btn ${mode === 'month' ? 'active' : ''}`}
              onClick={() => handleModeChange('month')}
            >
              {t('moneyAnswers.mode.month')}
            </button>
            <button
              type="button"
              className={`mode-btn ${mode === 'year' ? 'active' : ''}`}
              onClick={() => handleModeChange('year')}
            >
              {t('moneyAnswers.mode.year')}
            </button>
          </div>

          {/* Period Navigator - Month or Year based on mode */}
          {mode === 'month' ? (
            <div className="month-navigator">
              <button
                type="button"
                className="month-nav-btn"
                onClick={() => handleMonthChange(-1)}
                aria-label={t('common.previous')}
              >
                <ChevronLeftIcon />
              </button>
              <span className="month-display">{formatMonthDisplay(filters.month!)}</span>
              <button
                type="button"
                className="month-nav-btn"
                onClick={() => handleMonthChange(1)}
                aria-label={t('common.next')}
              >
                <ChevronRightIcon />
              </button>
            </div>
          ) : (
            <div className="year-navigator">
              <button
                type="button"
                className="month-nav-btn"
                onClick={() => handleYearChange(-1)}
                aria-label={t('common.previous')}
              >
                <ChevronLeftIcon />
              </button>
              <span className="year-display">{year}</span>
              <button
                type="button"
                className="month-nav-btn"
                onClick={() => handleYearChange(1)}
                aria-label={t('common.next')}
              >
                <ChevronRightIcon />
              </button>
            </div>
          )}

          {/* Toggle Options */}
          <div className="toggle-options">
            <label className="toggle-option">
              <input
                type="checkbox"
                checked={filters.includeReceivables}
                onChange={(e) => updateFilters({ includeReceivables: e.target.checked })}
              />
              <span>{t('moneyAnswers.includeReceivables')}</span>
            </label>
            <label className="toggle-option">
              <input
                type="checkbox"
                checked={filters.includeProjections}
                onChange={(e) => updateFilters({ includeProjections: e.target.checked })}
              />
              <span>{t('moneyAnswers.includeProjections')}</span>
            </label>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="money-answers-content">
        {mode === 'year' ? (
          <UnifiedYearModeView
            year={year}
            includeReceivables={filters.includeReceivables ?? true}
            includeProjections={filters.includeProjections ?? true}
            onMonthClick={handleMonthClick}
          />
        ) : isLoading ? (
          <div className="loading-state">
            <span>{t('common.loading')}</span>
          </div>
        ) : (
          <>
            {/* KPI Strip */}
            <UnifiedKpiStrip kpis={kpis} />

            {/* Cash Flow Timeline */}
            <section className="timeline-section">
              <h2 className="section-title">{t('moneyAnswers.cashFlowTimeline')}</h2>
              <UnifiedCashFlowTimeline
                dailyAggregatesUSD={dailyAggregatesUSD || []}
                dailyAggregatesILS={dailyAggregatesILS || []}
              />
            </section>

            {/* Guidance Feed */}
            <section className="guidance-section">
              <h2 className="section-title">{t('moneyAnswers.guidanceTitle')}</h2>
              <GuidanceFeed items={guidance || []} />
            </section>
          </>
        )}
      </main>

      {/* Day Detail Drawer */}
      {dayDetailDrawer.isOpen && dayDetailDrawer.date && (
        <DayDetailDrawer
          date={dayDetailDrawer.date}
          onClose={closeDayDetailDrawer}
        />
      )}
    </div>
  );
}

// Icons
function ChevronLeftIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  );
}
