import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { useLanguage, useT } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import type { OperatorAccountListItem } from '../../api/client';
import { Empty, QueryView, Skeleton } from '../../components/QueryView';
import { useOperatorAccountList } from '../../data/operatorQueries';
import { useFeatureText } from '../../operator/featureNames';
import { pilotChipOf, rowPilotOf, type OperatorPilot } from '../../operator/pilot';
import { agoText, dayText } from '../../operator/time';
import { AccountStatusBadge } from './AccountStatusBadge';
import { SegmentedControl } from '../../../components/ui/SegmentedControl';
import { useSelfServiceDoors } from '../../session/selfServiceDoors';
import { SignupHistory } from './SignupHistory';

/** How long typing rests before the list is asked again. */
export const SEARCH_DEBOUNCE_MS = 300;
const SKELETON_ROWS = 5;

/**
 * MUT-527 (replacing MUT-461's exact-email search): every account, newest sign-in first, 50 at a time with "Load more".
 * The search box narrows it to any part of the email or name as you type (debounced); the query stays in the URL
 * (`?q=`), so Back and a shared link land on the same list. Each row says who, how they stand, when they last signed
 * in and which features are on, and opens the account.
 */
export function OperatorAccountsPage({ q, pilot = false, onSearch, onPilot, view, onView }: { q: string; pilot?: boolean; onSearch: (q: string) => void; onPilot?: (pilot: boolean) => void; view?: 'signups'; onView?: (view: 'all' | 'signups') => void }) {
  const t = useT();
  // MUT-737 (wireframe mut-737 A): with open sign-up, the sign-up history is a filter of this list.
  const openSignup = useSelfServiceDoors().openSignup;
  const filter = openSignup && onView && (
    <SegmentedControl
      className="hp-operator-filter"
      ariaLabel={t('hosted.operator.history.filterLabel')}
      value={view ?? 'all'}
      onChange={onView}
      options={[
        { value: 'all', label: t('hosted.operator.history.all') },
        { value: 'signups', label: t('hosted.operator.tabs.signups') },
      ]}
    />
  );
  if (openSignup && view === 'signups') {
    return (
      <>
        {filter}
        <SignupHistory />
      </>
    );
  }
  return <AccountsList q={q} pilot={pilot} onSearch={onSearch} onPilot={onPilot} filter={filter || null} />;
}

function AccountsList({ q, pilot, onSearch, onPilot, filter }: { q: string; pilot: boolean; onSearch: (q: string) => void; onPilot?: (pilot: boolean) => void; filter: ReactNode }) {
  const t = useT();
  const [draft, setDraft] = useState(q);
  const [seenQ, setSeenQ] = useState(q);
  const query = useOperatorAccountList(q, pilot);

  // The address changed from outside the box (the Accounts tab, a link): the box follows it. Adjusted while rendering,
  // not in an effect, so the debounce below never sends the old text back.
  if (q !== seenQ) {
    setSeenQ(q);
    if (q !== draft.trim()) setDraft(q);
  }

  useEffect(() => {
    const next = draft.trim();
    if (next === q) return;
    const timer = setTimeout(() => onSearch(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, q, onSearch]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSearch(draft.trim());
  }

  const accounts = query.data?.pages.flatMap((page) => page.data);
  return (
    <>
      {filter}
      <form className="hp-operator-search" role="search" onSubmit={submit}>
        <Input
          label={t('hosted.operator.accounts.searchLabel')}
          type="search"
          dir="auto"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </form>
      {/* MUT-757 (5A): the Pilot filter: every account that ever held a pilot grant, with the two ticks. */}
      {onPilot && (
        <div className="hp-operator-filters">
          <Button type="button" variant="secondary" size="sm" aria-pressed={pilot} onClick={() => onPilot(!pilot)}>
            {t('hosted.operator.pilot.filter')}
          </Button>
        </div>
      )}
      <QueryView
        queries={[query]}
        data={accounts}
        isEmpty={(list) => list.length === 0}
        loading={<Skeleton rows={SKELETON_ROWS} />}
        empty={pilot && !q ? <Empty title={t('hosted.operator.pilot.empty')} /> : q ? <Empty title={t('hosted.operator.accounts.noMatch', { q })} body={t('hosted.operator.accounts.noMatchBody')} /> : <Empty title={t('hosted.operator.accounts.empty')} />}
      >
        {(list) => (
          <>
            <ul className="hp-passkey-list hp-operator-list" aria-label={t('hosted.operator.accounts.listLabel')} aria-busy={query.isPlaceholderData || undefined}>
              {list.map((account) => (
                <AccountRow key={account.id} account={account} />
              ))}
            </ul>
            {query.hasNextPage && (
              <div className="hp-operator-more">
                <Button type="button" variant="secondary" isLoading={query.isFetchingNextPage} keepLabelWhileLoading onClick={() => void query.fetchNextPage()}>
                  {t('hosted.operator.accounts.loadMore')}
                </Button>
              </div>
            )}
          </>
        )}
      </QueryView>
    </>
  );
}

function AccountRow({ account }: { account: OperatorAccountListItem }) {
  const t = useT();
  const { language } = useLanguage();
  const featureText = useFeatureText();
  const pilot = rowPilotOf(account);
  const signIn = account.lastSignInAt ? t('hosted.operator.accounts.lastSignIn', { time: agoText(account.lastSignInAt, new Date(), language) }) : t('hosted.operator.accounts.neverSignedIn');
  return (
    <li className="hp-passkey-row">
      <Link className="hp-operator-account-link press" to="/operator/accounts/$userId" params={{ userId: account.id }}>
        <span className="hp-passkey-text">
          <span className="hp-passkey-name hp-operator-email" dir="ltr">
            {account.email}
          </span>
          <span className="hp-option-sub">
            <bdi dir="auto">{account.displayName}</bdi> · {signIn}
          </span>
          {account.features.length > 0 && (
            <span className="hp-option-sub">{t('hosted.operator.accounts.featuresOn', { features: account.features.map((f) => featureText(f).label).join(' · ') })}</span>
          )}
          {pilot && <PilotLine pilot={pilot} milestones={account.milestones} />}
          <span className="hp-operator-chips">
            {pilot && <PilotChip pilot={pilot} />}
            <AccountStatusBadge status={account.status} />
            {account.operator && (
              <Badge variant="accent" size="sm">
                {t('hosted.operator.accounts.operatorBadge')}
              </Badge>
            )}
          </span>
        </span>
        <span className="hp-you-row-tail" aria-hidden="true">
          ›
        </span>
      </Link>
    </li>
  );
}

/** MUT-757 (P8): "Pilot · ends 27 Jan", "9 days left" (attention), "Ended". Words, never colour alone. */
function PilotChip({ pilot }: { pilot: OperatorPilot }) {
  const t = useT();
  const tp = useTp();
  const { language } = useLanguage();
  const chip = pilotChipOf(pilot, new Date());
  if (chip.kind === 'ended') return <Badge size="sm">{t('hosted.operator.pilot.ended')}</Badge>;
  if (chip.kind === 'daysLeft')
    return (
      <Badge variant="warning" size="sm">
        {tp('hosted.operator.pilot.daysLeft', chip.days)}
      </Badge>
    );
  return (
    <Badge variant="accent" size="sm">
      {t('hosted.operator.pilot.ends', { date: dayText(chip.endsAt, language) })}
    </Badge>
  );
}

/** MUT-757: the referring accountant, and with the Pilot filter on, the first scan and first invoice ticks. */
function PilotLine({ pilot, milestones }: { pilot: OperatorPilot; milestones: OperatorAccountListItem['milestones'] }) {
  const t = useT();
  const { language } = useLanguage();
  const parts: string[] = [];
  if (pilot.referredBy) parts.push(t('hosted.operator.pilot.accountant', { name: pilot.referredBy.displayName || pilot.referredBy.email }));
  // MUT-777 (ADR-333): whether the tester said yes to watched sessions, and when (a server older than 1.201.0 sends nothing).
  if (pilot.watchConsentAt !== undefined) {
    parts.push(pilot.watchConsentAt ? `✓ ${t('hosted.operator.pilot.watched', { date: dayText(pilot.watchConsentAt, language) })}` : `– ${t('hosted.operator.pilot.notWatched')}`);
  }
  if (milestones) {
    parts.push(`${milestones.firstScanAt ? '✓' : '–'} ${t('hosted.operator.pilot.scan')}`);
    parts.push(`${milestones.firstInvoiceAt ? '✓' : '–'} ${t('hosted.operator.pilot.invoice')}`);
  }
  if (parts.length === 0) return null;
  return (
    <span className="hp-option-sub" data-testid="pilot-line">
      {parts.join(' · ')}
    </span>
  );
}
