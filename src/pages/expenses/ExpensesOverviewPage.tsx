import { useState, useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import { CurrencySummaryPopup } from '../../components/ui/CurrencySummaryPopup';
import { useAllProfilesExpenseTotals } from '../../hooks/useExpenseQueries';
import { formatAmount, cn } from '../../lib/utils';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import type { ProfileExpenseSummary } from '../../types';
import './ExpensesOverviewPage.css';

export function ExpensesOverviewPage() {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);

  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);

  const { data: profileSummaries = [], isLoading } = useAllProfilesExpenseTotals(year);

  // Year options
  const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear - i);

  // Calculate totals - always show both currencies
  const totals = useMemo(() => {
    let totalUSD = 0;
    let totalILS = 0;
    const monthlyTotalsUSD = new Array(12).fill(0);
    const monthlyTotalsILS = new Array(12).fill(0);

    profileSummaries.forEach((summary) => {
      totalUSD += summary.totalMinorUSD;
      totalILS += summary.totalMinorILS;
      summary.monthlyBreakdown.forEach((m) => {
        monthlyTotalsUSD[m.month - 1] += m.totalMinorUSD;
        monthlyTotalsILS[m.month - 1] += m.totalMinorILS;
      });
    });

    return { totalUSD, totalILS, monthlyTotalsUSD, monthlyTotalsILS };
  }, [profileSummaries]);

  // For chart scaling, use USD totals as primary display
  const monthlyTotals = totals.monthlyTotalsUSD;
  const maxMonthly = Math.max(...monthlyTotals, 1);

  // Month names
  const monthNames = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const date = new Date(year, i, 1);
      return date.toLocaleDateString(locale, { month: 'short' });
    });
  }, [year, locale]);

  // Sort profiles by total (combined, using USD as proxy)
  const sortedProfiles = useMemo(() => {
    return [...profileSummaries].sort((a, b) => {
      const aTotal = a.totalMinorUSD + a.totalMinorILS;
      const bTotal = b.totalMinorUSD + b.totalMinorILS;
      return bTotal - aTotal;
    });
  }, [profileSummaries]);

  return (
    <>
      <TopBar
        title={t('expenses.overview.title')}
        breadcrumbs={[
          { label: t('nav.expenses'), href: '/expenses' },
          { label: t('expenses.overview.title') },
        ]}
        filterSlot={
          <div className="filters-row" style={{ marginBottom: 0, marginInlineStart: 24 }}>
            <select
              className="select"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        }
      />
      <div className="page-content">
        {isLoading ? (
          <div className="loading">
            <div className="spinner" />
          </div>
        ) : (
          <>
            {/* Grand Total */}
            <div className="overview-grand-total">
              <div className="overview-grand-total-label">
                {t('expenses.overview.totalExpenses')} ({year})
              </div>
              <CurrencySummaryPopup
                usdAmountMinor={totals.totalUSD}
                ilsAmountMinor={totals.totalILS}
                eurAmountMinor={0}
                type="expense"
                size="large"
              />
            </div>

            {/* Monthly Chart - shows USD totals */}
            <div className="overview-chart-section">
              <h3 className="section-title">{t('expenses.overview.monthlyBreakdown')} (USD)</h3>
              <div className="overview-bar-chart">
                {monthlyTotals.map((total, i) => {
                  const height = maxMonthly > 0 ? (total / maxMonthly) * 100 : 0;
                  return (
                    <div key={i} className="chart-bar-container">
                      <div className="chart-bar-wrapper">
                        <div
                          className={cn('chart-bar', total > 0 && 'has-value')}
                          style={{ height: `${Math.max(height, 2)}%` }}
                        />
                      </div>
                      <div className="chart-bar-label">{monthNames[i]}</div>
                      <div className="chart-bar-value">
                        {total > 0
                          ? formatAmount(total, 'USD', locale)
                          : '-'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Profile Breakdown Table - Always shows both currencies */}
            <div className="overview-breakdown-section">
              <h3 className="section-title">{t('expenses.overview.byProfile')}</h3>
              {sortedProfiles.length === 0 ? (
                <div className="empty-state">
                  <p className="text-muted">{t('expenses.overview.noProfiles')}</p>
                </div>
              ) : (
                <div className="data-table">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('expenses.overview.profile')}</th>
                        <th style={{ textAlign: 'end' }}>USD</th>
                        <th style={{ textAlign: 'end' }}>ILS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedProfiles.map((summary: ProfileExpenseSummary) => {
                        return (
                          <tr key={summary.profileId}>
                            <td>
                              <Link
                                to="/expenses/profile/$profileId"
                                params={{ profileId: summary.profileId }}
                                style={{ fontWeight: 500 }}
                              >
                                {summary.profileName}
                              </Link>
                            </td>
                            <td className="amount-cell amount-negative">
                              {summary.totalMinorUSD > 0
                                ? formatAmount(summary.totalMinorUSD, 'USD', locale)
                                : '-'}
                            </td>
                            <td className="amount-cell amount-negative">
                              {summary.totalMinorILS > 0
                                ? formatAmount(summary.totalMinorILS, 'ILS', locale)
                                : '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td style={{ fontWeight: 600 }}>{t('expenses.overview.total')}</td>
                        <td className="amount-cell amount-negative" style={{ fontWeight: 600 }}>
                          {totals.totalUSD > 0
                            ? formatAmount(totals.totalUSD, 'USD', locale)
                            : '-'}
                        </td>
                        <td className="amount-cell amount-negative" style={{ fontWeight: 600 }}>
                          {totals.totalILS > 0
                            ? formatAmount(totals.totalILS, 'ILS', locale)
                            : '-'}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
