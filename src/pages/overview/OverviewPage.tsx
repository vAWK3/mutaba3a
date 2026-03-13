import { useState } from 'react';
import { TopBar } from '../../components/layout';
import { TransactionTypeBadge } from '../../components/transactions';
import {
  PredictiveKpiStrip,
  MonthActualsRow,
  AttentionFeed,
} from '../../components/home';
import { OnboardingOverlay } from '../../components/onboarding';
import {
  useTransactions,
  useClients,
} from '../../hooks/useQueries';
import { useProfileFilter } from '../../hooks/useActiveProfile';
import { useDrawerStore } from '../../lib/stores';
import { useOnboardingStore } from '../../lib/onboardingStore';
import { formatDate, getDateRangePreset } from '../../lib/utils';
import { AmountWithConversion } from '../../components/ui';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import type { TxKind } from '../../types';

/**
 * OverviewPage (Home)
 *
 * Per design doc: Current month operating view
 * - Answers "Am I okay?" via PredictiveKpiStrip
 * - Answers "What needs attention?" via AttentionFeed
 * - Shows month actuals in collapsible row
 * - Recent activity for context
 *
 * No date range selector - Home is always current month.
 */
export function OverviewPage() {
  const { openIncomeDrawer, openExpenseDrawer } = useDrawerStore();
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const { skipped, isOnboardingComplete } = useOnboardingStore();

  // Get active profile filter (undefined in "All Profiles" mode)
  const profileId = useProfileFilter();

  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  // Current month date range for recent activity
  const currentMonthRange = getDateRangePreset('this-month');

  // Check if user has any data (for empty state)
  const { data: allClients = [] } = useClients(profileId);

  // Fetch all transactions (no date filter) to check if user has any data
  const { data: allTransactions = [] } = useTransactions({ limit: 1, profileId });

  // Recent transactions for this month
  const { data: recentTransactions = [] } = useTransactions({
    dateFrom: currentMonthRange.dateFrom,
    dateTo: currentMonthRange.dateTo,
    profileId,
    limit: 10,
    sort: { by: 'occurredAt', dir: 'desc' },
  });

  // Determine if this is a new user (no clients and no transactions)
  const isNewUser = allClients.length === 0 && allTransactions.length === 0;

  // Show onboarding for new users who haven't skipped or completed it
  const showOnboarding = isNewUser && !skipped && !isOnboardingComplete() && !onboardingDismissed;

  const handleRowClick = (id: string, kind: TxKind) => {
    if (kind === 'expense') {
      openExpenseDrawer({ mode: 'edit', expenseId: id });
    } else {
      openIncomeDrawer({ mode: 'edit', transactionId: id });
    }
  };

  const handleOnboardingComplete = () => {
    setOnboardingDismissed(true);
  };

  // Render onboarding for new users
  if (showOnboarding) {
    return (
      <>
        <TopBar title={t('overview.title')} />
        <div className="page-content">
          <OnboardingOverlay onComplete={handleOnboardingComplete} />
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar title={t('overview.title')} />
      <div className="page-content">
        {/* Predictive KPI Strip - "Will I Make It?", "Cash on Hand", "Coming/Leaving" */}
        <PredictiveKpiStrip />

        {/* Month Actuals Row - Collapsible summary of actual received/unpaid/expenses/net */}
        <MonthActualsRow />

        {/* Two column layout: Attention Feed + Recent Activity */}
        <div className="home-two-column">
          {/* Needs Attention - Severity-sorted action items */}
          <AttentionFeed />

          {/* Recent Activity */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">{t('overview.recentActivity')}</h3>
            </div>
            {recentTransactions.length === 0 ? (
              <div className="card-empty">
                {t('overview.noRecent')}
              </div>
            ) : (
              <div className="data-table" style={{ border: 'none' }}>
                <table>
                  <tbody>
                    {recentTransactions.map((tx) => (
                      <tr
                        key={tx.id}
                        className="clickable"
                        onClick={() => handleRowClick(tx.id, tx.kind)}
                      >
                        <td style={{ width: 80 }}>{formatDate(tx.occurredAt, locale)}</td>
                        <td>
                          <TransactionTypeBadge kind={tx.kind} status={tx.status} />
                        </td>
                        <td
                          className="text-secondary"
                          style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}
                        >
                          {tx.clientName || tx.title || '-'}
                        </td>
                        <td className="amount-cell">
                          <AmountWithConversion
                            amountMinor={tx.amountMinor}
                            currency={tx.currency}
                            type={tx.kind === 'income' ? 'income' : 'expense'}
                            showExpenseSign={tx.kind === 'expense'}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
