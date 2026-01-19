import { useState, useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import { CurrencyTabs } from '../../components/filters';
import { useAllProfilesExpenseTotals } from '../../hooks/useExpenseQueries';
import { formatAmount, cn } from '../../lib/utils';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import type { Currency, ProfileExpenseSummary } from '../../types';
import './ExpensesOverviewPage.css';

export function ExpensesOverviewPage() {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);

  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [currency, setCurrency] = useState<Currency | undefined>(undefined);

  const { data: profileSummaries = [], isLoading } = useAllProfilesExpenseTotals(year);

  // Year options
  const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear - i);

  // Calculate totals
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

  // Get max for chart scaling
  const monthlyTotals = currency === 'ILS' ? totals.monthlyTotalsILS : totals.monthlyTotalsUSD;
  const maxMonthly = Math.max(...monthlyTotals, 1);
  const displayCurrency = currency || 'USD';
  const displayTotal = currency === 'ILS' ? totals.totalILS : totals.totalUSD;

  // Month names
  const monthNames = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const date = new Date(year, i, 1);
      return date.toLocaleDateString(locale, { month: 'short' });
    });
  }, [year, locale]);

  // Sort profiles by total
  const sortedProfiles = useMemo(() => {
    return [...profileSummaries].sort((a, b) => {
      const aTotal = currency === 'ILS' ? a.totalMinorILS : a.totalMinorUSD;
      const bTotal = currency === 'ILS' ? b.totalMinorILS : b.totalMinorUSD;
      return bTotal - aTotal;
    });
  }, [profileSummaries, currency]);

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
            <CurrencyTabs value={currency} onChange={setCurrency} />
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
              <div className="overview-grand-total-value amount-negative">
                {currency ? (
                  formatAmount(displayTotal, displayCurrency, locale)
                ) : (
                  <>
                    {totals.totalUSD > 0 && (
                      <span>{formatAmount(totals.totalUSD, 'USD', locale)}</span>
                    )}
                    {totals.totalILS > 0 && (
                      <span>{formatAmount(totals.totalILS, 'ILS', locale)}</span>
                    )}
                    {totals.totalUSD === 0 && totals.totalILS === 0 && <span>-</span>}
                  </>
                )}
              </div>
            </div>

            {/* Monthly Chart */}
            <div className="overview-chart-section">
              <h3 className="section-title">{t('expenses.overview.monthlyBreakdown')}</h3>
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
                          ? formatAmount(total, displayCurrency, locale)
                          : '-'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Profile Breakdown Table */}
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
                        {!currency && <th style={{ textAlign: 'end' }}>USD</th>}
                        {!currency && <th style={{ textAlign: 'end' }}>ILS</th>}
                        {currency && (
                          <th style={{ textAlign: 'end' }}>{t('expenses.overview.total')}</th>
                        )}
                        <th style={{ textAlign: 'end' }}>{t('expenses.overview.percentage')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedProfiles.map((summary: ProfileExpenseSummary) => {
                        const profileTotal = currency === 'ILS'
                          ? summary.totalMinorILS
                          : summary.totalMinorUSD;
                        const grandTotal = currency === 'ILS' ? totals.totalILS : totals.totalUSD;
                        const percentage = grandTotal > 0
                          ? ((profileTotal / grandTotal) * 100).toFixed(1)
                          : '0';

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
                            {!currency && (
                              <td className="amount-cell amount-negative">
                                {summary.totalMinorUSD > 0
                                  ? formatAmount(summary.totalMinorUSD, 'USD', locale)
                                  : '-'}
                              </td>
                            )}
                            {!currency && (
                              <td className="amount-cell amount-negative">
                                {summary.totalMinorILS > 0
                                  ? formatAmount(summary.totalMinorILS, 'ILS', locale)
                                  : '-'}
                              </td>
                            )}
                            {currency && (
                              <td className="amount-cell amount-negative">
                                {profileTotal > 0
                                  ? formatAmount(profileTotal, displayCurrency, locale)
                                  : '-'}
                              </td>
                            )}
                            <td className="amount-cell text-muted">
                              {profileTotal > 0 ? `${percentage}%` : '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td style={{ fontWeight: 600 }}>{t('expenses.overview.total')}</td>
                        {!currency && (
                          <td className="amount-cell amount-negative" style={{ fontWeight: 600 }}>
                            {totals.totalUSD > 0
                              ? formatAmount(totals.totalUSD, 'USD', locale)
                              : '-'}
                          </td>
                        )}
                        {!currency && (
                          <td className="amount-cell amount-negative" style={{ fontWeight: 600 }}>
                            {totals.totalILS > 0
                              ? formatAmount(totals.totalILS, 'ILS', locale)
                              : '-'}
                          </td>
                        )}
                        {currency && (
                          <td className="amount-cell amount-negative" style={{ fontWeight: 600 }}>
                            {displayTotal > 0
                              ? formatAmount(displayTotal, displayCurrency, locale)
                              : '-'}
                          </td>
                        )}
                        <td className="amount-cell text-muted">100%</td>
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
