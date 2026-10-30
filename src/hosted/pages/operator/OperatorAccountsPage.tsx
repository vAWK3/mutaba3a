import { useEffect, useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { useLanguage, useT } from '../../../lib/i18n/core';
import type { OperatorAccountListItem } from '../../api/client';
import { Empty, QueryView, Skeleton } from '../../components/QueryView';
import { useOperatorAccountList } from '../../data/operatorQueries';
import { useFeatureText } from '../../operator/featureNames';
import { agoText } from '../../operator/time';
import { AccountStatusBadge } from './AccountStatusBadge';

/** How long typing rests before the list is asked again. */
export const SEARCH_DEBOUNCE_MS = 300;
const SKELETON_ROWS = 5;

/**
 * MUT-527 (replacing MUT-461's exact-email search): every account, newest sign-in first, 50 at a time with "Load more".
 * The search box narrows it to any part of the email or name as you type (debounced); the query stays in the URL
 * (`?q=`), so Back and a shared link land on the same list. Each row says who, how they stand, when they last signed
 * in and which features are on, and opens the account.
 */
export function OperatorAccountsPage({ q, onSearch }: { q: string; onSearch: (q: string) => void }) {
  const t = useT();
  const [draft, setDraft] = useState(q);
  const [seenQ, setSeenQ] = useState(q);
  const query = useOperatorAccountList(q);

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
      <form className="hp-operator-search" role="search" onSubmit={submit}>
        <Input
          label={t('hosted.operator.accounts.searchLabel')}
          hint={t('hosted.operator.accounts.searchHint')}
          type="search"
          dir="auto"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </form>
      <QueryView
        queries={[query]}
        data={accounts}
        isEmpty={(list) => list.length === 0}
        loading={<Skeleton rows={SKELETON_ROWS} />}
        empty={q ? <Empty title={t('hosted.operator.accounts.noMatch', { q })} body={t('hosted.operator.accounts.noMatchBody')} /> : <Empty title={t('hosted.operator.accounts.empty')} />}
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
          <span className="hp-operator-chips">
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
