import { useMemo, useState } from 'react';
import { TopBar } from '../../components/layout';
import { HomeNeedsAttention, HomeRecentPayments } from '../../components/home';
import { OwedNowSummary } from '../../components/clients/OwedNowSummary';
import { OnboardingOverlay } from '../../components/onboarding';
import { EmptyState } from '../../components/ui';
import { useTransactions, useClients } from '../../hooks/useQueries';
import { useReceivables } from '../../hooks/useIncomeQueries';
import { useProfileFilter } from '../../hooks/useActiveProfile';
import { summarizeOwedByCurrency } from '../../db/aggregations';
import { useDrawerStore } from '../../lib/stores';
import { useOnboardingStore } from '../../lib/onboardingStore';
import { todayLocalISO } from '../../lib/dates';
import { useT } from '../../lib/i18n';

/**
 * OverviewPage (Home) — MUT-8 / ADR-036
 *
 * Answers, in order: how much am I owed (Owed now, per currency), who is late
 * (Needs attention: overdue or due within 7 days, oldest first), and what came
 * in (the last 10 payments). Every row opens its client. Nothing else lives
 * here: forecasting, month actuals and expenses are not core.
 */
export function OverviewPage() {
  const { openIncomeDrawer } = useDrawerStore();
  const t = useT();
  const { skipped, isOnboardingComplete } = useOnboardingStore();
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  // Active profile only (strict mode)
  const profileId = useProfileFilter();

  // A new user has no clients and no entries yet
  const { data: allClients = [] } = useClients(profileId);
  const { data: anyTransaction = [] } = useTransactions({ limit: 1, profileId });
  const isNewUser = allClients.length === 0 && anyTransaction.length === 0;
  const showOnboarding = isNewUser && !skipped && !isOnboardingComplete() && !onboardingDismissed;

  // Owed now: every receivable in the profile, one helper for every screen (ADR-033)
  const { data: receivables = [] } = useReceivables({ profileId });
  const today = todayLocalISO();
  const owed = useMemo(() => summarizeOwedByCurrency(receivables, today), [receivables, today]);

  if (showOnboarding) {
    return (
      <>
        <TopBar title={t('overview.title')} />
        <div className="page-content">
          <OnboardingOverlay onComplete={() => setOnboardingDismissed(true)} />
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar title={t('overview.title')} />
      <div className="page-content">
        {isNewUser ? (
          <EmptyState
            title={t('overview.empty.title')}
            description={t('overview.empty.description')}
            action={{ label: t('overview.empty.action'), onClick: () => openIncomeDrawer({ mode: 'create' }) }}
          />
        ) : (
          <>
            <div className="card home-owed">
              <OwedNowSummary owed={owed} />
            </div>
            <div className="home-two-column">
              <HomeNeedsAttention profileId={profileId} />
              <HomeRecentPayments profileId={profileId} />
            </div>
          </>
        )}
      </div>
    </>
  );
}
