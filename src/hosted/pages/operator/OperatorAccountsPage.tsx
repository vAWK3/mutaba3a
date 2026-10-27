import { useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { useT } from '../../../lib/i18n/core';
import { Empty, QueryView, Skeleton } from '../../components/QueryView';
import { useOperatorAccountSearch } from '../../data/operatorQueries';
import { AccountStatusBadge } from './AccountStatusBadge';

/**
 * MUT-461 (design 17A, 3A): find an account by its exact email (ADR-212 D5). The address stays in the URL (`?email=`),
 * so Back and a shared link land on the same answer. A match is one row that opens the account; no match says so,
 * with the address as typed. The server normalises it, so case and spaces don't matter.
 */
export function OperatorAccountsPage({ email, onSearch }: { email: string; onSearch: (email: string) => void }) {
  const t = useT();
  const [draft, setDraft] = useState(email);
  const query = useOperatorAccountSearch(email);

  function submit(event: FormEvent) {
    event.preventDefault();
    const next = draft.trim();
    if (next) onSearch(next);
  }

  return (
    <>
      <form className="hp-operator-search" role="search" onSubmit={submit}>
        <Input
          label={t('hosted.operator.accounts.searchLabel')}
          hint={t('hosted.operator.accounts.searchHint')}
          type="email"
          dir="ltr"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          required
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit">{t('hosted.operator.accounts.search')}</Button>
      </form>
      {email && (
        <QueryView
          queries={[query]}
          data={query.data}
          isEmpty={(result) => result.account === null}
          loading={<Skeleton rows={1} />}
          empty={
            <Empty
              title={t('hosted.operator.accounts.noMatch')}
              action={
                <p dir="ltr" className="hp-operator-email">
                  {email}
                </p>
              }
            />
          }
        >
          {({ account }) =>
            account && (
              <ul className="hp-passkey-list hp-operator-list" aria-label={t('hosted.operator.accounts.resultsLabel')}>
                <li className="hp-passkey-row">
                  <Link className="hp-operator-account-link press" to="/operator/accounts/$userId" params={{ userId: account.id }}>
                    <span className="hp-passkey-text">
                      <span className="hp-passkey-name hp-operator-email" dir="ltr">
                        {account.email}
                      </span>
                      <span className="hp-option-sub" dir="auto">
                        {account.displayName}
                      </span>
                    </span>
                    <AccountStatusBadge status={account.status} />
                    <span className="hp-you-row-tail" aria-hidden="true">
                      ›
                    </span>
                  </Link>
                </li>
              </ul>
            )
          }
        </QueryView>
      )}
    </>
  );
}
