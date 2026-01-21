import { useState, useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import {
  useExpenseForecast,
  useActiveRecurringRules,
} from '../../hooks/useExpenseQueries';
import { useBusinessProfiles } from '../../hooks/useQueries';
import { formatAmount, cn } from '../../lib/utils';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import type { Currency, ExpenseForecast } from '../../types';
import './ExpensesForecastPage.css';

export function ExpensesForecastPage() {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const [year, setYear] = useState(currentYear);
  // Default to ILS - forecast shows ILS-based projections
  const currency: Currency = 'ILS';

  const { data: profiles = [] } = useBusinessProfiles();
  const profileIds = useMemo(() => profiles.map((p) => p.id), [profiles]);

  const { data: forecasts = [], isLoading: forecastLoading } = useExpenseForecast(
    year,
    profileIds,
    currency
  );

  const { data: allActiveRules = [] } = useActiveRecurringRules();

  // Filter rules by currency
  const activeRules = useMemo(
    () => allActiveRules.filter((r) => r.currency === currency),
    [allActiveRules, currency]
  );

  // Year options
  const yearOptions = Array.from({ length: 3 }, (_, i) => currentYear + i - 1);

  // Aggregate forecast across all profiles
  const aggregatedForecast = useMemo(() => {
    if (forecasts.length === 0) return null;

    const breakdown: {
      month: number;
      projectedTotal: number;
      actualTotal: number;
      isPast: boolean;
    }[] = [];

    for (let m = 1; m <= 12; m++) {
      let projectedTotal = 0;
      let actualTotal = 0;
      let isPast = false;

      forecasts.forEach((f: ExpenseForecast) => {
        const monthData = f.breakdown.find((b) => b.month === m);
        if (monthData) {
          projectedTotal += monthData.projectedMinor;
          actualTotal += monthData.actualMinor || 0;
          isPast = monthData.isPast;
        }
      });

      breakdown.push({ month: m, projectedTotal, actualTotal, isPast });
    }

    // Calculate minimum needed (sum of future projected)
    const minimumNeeded = breakdown
      .filter((b) => !b.isPast)
      .reduce((sum, b) => sum + b.projectedTotal, 0);

    const grandTotal = breakdown.reduce((sum, b) => sum + b.projectedTotal, 0);

    return { breakdown, minimumNeeded, grandTotal };
  }, [forecasts]);

  // Month names
  const monthNames = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const date = new Date(year, i, 1);
      return date.toLocaleDateString(locale, { month: 'short' });
    });
  }, [year, locale]);

  return (
    <>
      <TopBar
        title={t('expenses.forecast.title')}
        breadcrumbs={[
          { label: t('nav.expenses'), href: '/expenses' },
          { label: t('expenses.forecast.title') },
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
        {forecastLoading ? (
          <div className="loading">
            <div className="spinner" />
          </div>
        ) : !aggregatedForecast ? (
          <div className="empty-state">
            <h3 className="empty-state-title">{t('expenses.forecast.empty')}</h3>
            <p className="empty-state-description">{t('expenses.forecast.emptyHint')}</p>
          </div>
        ) : (
          <>
            {/* Minimum Needed Card */}
            <div className="forecast-hero">
              <div className="forecast-hero-label">
                {t('expenses.forecast.minimumNeeded')}
              </div>
              <div className="forecast-hero-value amount-negative">
                {formatAmount(aggregatedForecast.minimumNeeded, currency, locale)}
              </div>
              <div className="forecast-hero-subtitle">
                {t('expenses.forecast.untilEndOfYear', { year })}
              </div>
            </div>

            {/* Summary Stats */}
            <div className="forecast-stats">
              <div className="forecast-stat">
                <span className="forecast-stat-label">{t('expenses.forecast.yearTotal')}</span>
                <span className="forecast-stat-value amount-negative">
                  {formatAmount(aggregatedForecast.grandTotal, currency, locale)}
                </span>
              </div>
              <div className="forecast-stat">
                <span className="forecast-stat-label">{t('expenses.forecast.activeRules')}</span>
                <span className="forecast-stat-value">{activeRules.length}</span>
              </div>
              <div className="forecast-stat">
                <span className="forecast-stat-label">{t('expenses.forecast.monthsRemaining')}</span>
                <span className="forecast-stat-value">
                  {year === currentYear ? 12 - currentMonth : year > currentYear ? 12 : 0}
                </span>
              </div>
            </div>

            {/* Forecast Table */}
            <div className="forecast-table-section">
              <h3 className="section-title">{t('expenses.forecast.monthlyForecast')}</h3>
              <div className="data-table">
                <table>
                  <thead>
                    <tr>
                      <th>{t('expenses.forecast.month')}</th>
                      <th style={{ textAlign: 'end' }}>{t('expenses.forecast.projected')}</th>
                      <th style={{ textAlign: 'end' }}>{t('expenses.forecast.actual')}</th>
                      <th style={{ textAlign: 'end' }}>{t('expenses.forecast.delta')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aggregatedForecast.breakdown.map((row, i) => {
                      const delta = row.isPast ? row.actualTotal - row.projectedTotal : 0;
                      const isCurrentMonth = year === currentYear && row.month === currentMonth;

                      return (
                        <tr
                          key={row.month}
                          className={cn(
                            isCurrentMonth && 'current-month',
                            !row.isPast && 'future-month'
                          )}
                        >
                          <td>
                            <span style={{ fontWeight: isCurrentMonth ? 600 : 400 }}>
                              {monthNames[i]}
                            </span>
                            {isCurrentMonth && (
                              <span className="current-badge">{t('expenses.forecast.current')}</span>
                            )}
                          </td>
                          <td className="amount-cell">
                            {row.projectedTotal > 0 ? (
                              <span className={row.isPast ? 'text-muted' : 'amount-negative'}>
                                {formatAmount(row.projectedTotal, currency, locale)}
                              </span>
                            ) : (
                              <span className="text-muted">-</span>
                            )}
                          </td>
                          <td className="amount-cell">
                            {row.isPast ? (
                              row.actualTotal > 0 ? (
                                <span className="amount-negative">
                                  {formatAmount(row.actualTotal, currency, locale)}
                                </span>
                              ) : (
                                <span className="text-muted">-</span>
                              )
                            ) : (
                              <span className="text-muted">-</span>
                            )}
                          </td>
                          <td className="amount-cell">
                            {row.isPast && row.projectedTotal > 0 ? (
                              <span
                                className={cn(
                                  delta > 0 && 'text-danger',
                                  delta < 0 && 'text-success',
                                  delta === 0 && 'text-muted'
                                )}
                              >
                                {delta > 0 ? '+' : ''}
                                {formatAmount(delta, currency, locale)}
                              </span>
                            ) : (
                              <span className="text-muted">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={{ fontWeight: 600 }}>{t('expenses.forecast.total')}</td>
                      <td className="amount-cell amount-negative" style={{ fontWeight: 600 }}>
                        {formatAmount(aggregatedForecast.grandTotal, currency, locale)}
                      </td>
                      <td className="amount-cell amount-negative" style={{ fontWeight: 600 }}>
                        {formatAmount(
                          aggregatedForecast.breakdown
                            .filter((b) => b.isPast)
                            .reduce((sum, b) => sum + b.actualTotal, 0),
                          currency,
                          locale
                        )}
                      </td>
                      <td className="amount-cell text-muted">-</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Active Recurring Rules */}
            {activeRules.length > 0 && (
              <div className="forecast-rules-section">
                <h3 className="section-title">
                  {t('expenses.forecast.activeRecurringRules')} ({activeRules.length})
                </h3>
                <div className="forecast-rules-list">
                  {activeRules.map((rule) => {
                    const profile = profiles.find((p) => p.id === rule.profileId);
                    return (
                      <div key={rule.id} className="forecast-rule-item">
                        <div className="forecast-rule-info">
                          <div className="forecast-rule-title">{rule.title}</div>
                          <div className="forecast-rule-meta">
                            <span className="text-muted">
                              {profile?.name || t('expenses.unknownProfile')}
                            </span>
                            <span className="text-muted">
                              {rule.frequency === 'monthly'
                                ? t('expenses.monthly')
                                : t('expenses.yearly')}
                            </span>
                          </div>
                        </div>
                        <div className="forecast-rule-amount amount-negative">
                          {formatAmount(rule.amountMinor, rule.currency, locale)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Per-Profile Forecasts */}
            {forecasts.length > 1 && (
              <div className="forecast-profiles-section">
                <h3 className="section-title">{t('expenses.forecast.byProfile')}</h3>
                <div className="forecast-profiles-list">
                  {forecasts.map((forecast: ExpenseForecast) => {
                    const minimumNeeded = forecast.breakdown
                      .filter((b) => !b.isPast)
                      .reduce((sum, b) => sum + b.projectedMinor, 0);

                    return (
                      <Link
                        key={forecast.profileId}
                        to="/expenses/profile/$profileId"
                        params={{ profileId: forecast.profileId }}
                        className="forecast-profile-card"
                      >
                        <div className="forecast-profile-name">{forecast.profileName}</div>
                        <div className="forecast-profile-stats">
                          <div className="forecast-profile-stat">
                            <span className="text-muted">{t('expenses.forecast.minimumNeeded')}</span>
                            <span className="amount-negative">
                              {formatAmount(minimumNeeded, currency, locale)}
                            </span>
                          </div>
                          <div className="forecast-profile-stat">
                            <span className="text-muted">{t('expenses.forecast.yearTotal')}</span>
                            <span className="amount-negative">
                              {formatAmount(forecast.projectedTotalMinor, currency, locale)}
                            </span>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
