import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import { useAllProfilesExpenseTotals } from '../../hooks/useExpenseQueries';
import { useDrawerStore } from '../../lib/stores';
import { formatAmount } from '../../lib/utils';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import './ExpensesPage.css';

export function ExpensesPage() {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const { openExpenseDrawer } = useDrawerStore();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);

  const { data: profileSummaries = [], isLoading } = useAllProfilesExpenseTotals(year);

  // Generate year options (current year and 5 years back)
  const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear - i);

  // Calculate grand totals
  const grandTotalUSD = profileSummaries.reduce((sum, p) => sum + p.totalMinorUSD, 0);
  const grandTotalILS = profileSummaries.reduce((sum, p) => sum + p.totalMinorILS, 0);

  return (
    <>
      <TopBar
        title={t('expenses.title')}
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
        {/* Quick Links */}
        <div className="expense-quick-links">
          <Link to="/expenses/overview" className="expense-quick-link">
            <OverviewIcon />
            <span>{t('expenses.allProfilesOverview')}</span>
          </Link>
          <Link to="/expenses/forecast" className="expense-quick-link">
            <ForecastIcon />
            <span>{t('expenses.forecast')}</span>
          </Link>
        </div>

        {/* Grand Totals */}
        {profileSummaries.length > 0 && (
          <div className="expense-grand-totals">
            <div className="expense-grand-total">
              <span className="expense-grand-total-label">{t('expenses.totalExpenses')} ({year})</span>
              <div className="expense-grand-total-amounts">
                {grandTotalUSD > 0 && (
                  <span className="amount-negative">{formatAmount(grandTotalUSD, 'USD', locale)}</span>
                )}
                {grandTotalILS > 0 && (
                  <span className="amount-negative">{formatAmount(grandTotalILS, 'ILS', locale)}</span>
                )}
                {grandTotalUSD === 0 && grandTotalILS === 0 && (
                  <span className="text-muted">-</span>
                )}
              </div>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="loading">
            <div className="spinner" />
          </div>
        ) : profileSummaries.length === 0 ? (
          <div className="empty-state">
            <h3 className="empty-state-title">{t('expenses.emptyProfiles')}</h3>
            <p className="empty-state-description">{t('expenses.emptyProfilesHint')}</p>
            <button
              className="btn btn-primary"
              onClick={() => openExpenseDrawer({ mode: 'create' })}
            >
              {t('expenses.addExpense')}
            </button>
          </div>
        ) : (
          <div className="expense-profile-cards">
            {profileSummaries.map((summary) => (
              <Link
                key={summary.profileId}
                to="/expenses/profile/$profileId"
                params={{ profileId: summary.profileId }}
                className="expense-profile-card"
              >
                <div className="expense-profile-card-header">
                  <h3 className="expense-profile-card-name">{summary.profileName}</h3>
                  <ChevronRightIcon />
                </div>
                <div className="expense-profile-card-stats">
                  <div className="expense-profile-card-stat">
                    <span className="expense-profile-card-stat-label">USD</span>
                    <span className="expense-profile-card-stat-value amount-negative">
                      {summary.totalMinorUSD > 0
                        ? formatAmount(summary.totalMinorUSD, 'USD', locale)
                        : '-'}
                    </span>
                  </div>
                  <div className="expense-profile-card-stat">
                    <span className="expense-profile-card-stat-label">ILS</span>
                    <span className="expense-profile-card-stat-value amount-negative">
                      {summary.totalMinorILS > 0
                        ? formatAmount(summary.totalMinorILS, 'ILS', locale)
                        : '-'}
                    </span>
                  </div>
                </div>
                <div className="expense-profile-card-receipts">
                  <Link
                    to="/expenses/profile/$profileId/receipts"
                    params={{ profileId: summary.profileId }}
                    className="expense-profile-card-receipts-link"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ReceiptIcon />
                    <span>{t('expenses.viewReceipts')}</span>
                  </Link>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function OverviewIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z"
      />
    </svg>
  );
}

function ForecastIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941"
      />
    </svg>
  );
}

function ReceiptIcon() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z"
      />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  );
}
