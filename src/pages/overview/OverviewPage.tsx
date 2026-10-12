import { useMemo, useState } from 'react';
import { TopBar } from '../../components/layout';
import { HomeNeedsAttention, HomeRecentPayments } from '../../components/home';
import { OwedNowSummary } from '../../components/clients/OwedNowSummary';
import { OnboardingOverlay } from '../../components/onboarding';
import { EmptyState } from '../../components/ui';
import { useTransactions, useClients } from '../../hooks/useQueries';
import { useReceivables } from '../../hooks/useIncomeQueries';
import { useOwedLens } from '../../hooks/useActiveProfile';
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
 *
 * With "All businesses" on (MUT-89, ADR-051) it reads every business, per
 * currency, never summed across currencies, and each row names its business.
 */
export function OverviewPage() {
  const { openIncomeDrawer } = useDrawerStore();
  const t = useT();
  const { skipped, isOnboardingComplete } = useOnboardingStore();
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  // The working business, or every business with All businesses on (MUT-89).
  // Nothing is read until the businesses are known: no scope means every record.
  const { scope, isAll, profilesById } = useOwedLens();
  const hasScope = scope !== undefined;
  const businesses = isAll ? profilesById : undefined;

  // A new user has no clients and no entries yet. Decided only once both
  // queries have answered, or the empty state and onboarding flash on every
  // load while Dexie is still reading. A query waiting for the scope is
  // pending but not loading (TanStack Query 5), so pending decides (D2).
  const { data: allClients = [], isPending: clientsPending } = useClients(scope, { enabled: hasScope });
  const { data: anyTransaction = [], isPending: entriesPending } = useTransactions(
    { limit: 1, profileId: scope },
    { enabled: hasScope }
  );
  const isDeciding = !hasScope || clientsPending || entriesPending;
  const isNewUser = !isDeciding && allClients.length === 0 && anyTransaction.length === 0;
  const showOnboarding = isNewUser && !skipped && !isOnboardingComplete() && !onboardingDismissed;

  // Owed now: every receivable in scope, one helper for every screen (ADR-033)
  const { data: receivables = [] } = useReceivables({ profileId: scope }, { enabled: hasScope });
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
        {isDeciding ? (
          <div className="loading">
            <div className="spinner" />
          </div>
        ) : isNewUser ? (
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
              <HomeNeedsAttention profileId={scope} businesses={businesses} />
              <HomeRecentPayments profileId={scope} businesses={businesses} />
            </div>
          </>
        )}
      </div>
    </>
  );
}
