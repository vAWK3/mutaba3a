import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { SearchInput } from '../../../components/filters/SearchInput';
import { Button } from '../../../components/ui/Button';
import { useLanguage } from '../../../lib/i18n/core';
import type { AccountantClientWithStats } from '../../api/client';
import { HostedTable, type Column } from '../../components/HostedTable';
import { InPlaceConfirm } from '../../components/InPlaceConfirm';
import { Empty, QueryView, Skeleton } from '../../components/QueryView';
import { useClientBooks, useRemoveClientBook } from '../../data/clientBooksQueries';
import { PageHeader } from '../views/shared';
import { dayLabel, isEnded, matchesClient } from './clientBooksRules';

/**
 * `/client-books` (MUT-562, layout C1): the accountant's desk, every client book shared with them. Owner, profile,
 * entries this month and last activity per row (AC1); a row opens the client's book. An ended client stays faded with
 * "No longer shared" and Remove until removed (AW4). With none, the empty state says how a client invites you (AW5).
 *
 * TODO(blocked-by MUT-314): each active row's "Download {last month}" (the Excel report only, Basel 13244) through
 * MUT-314's mint and periodDownload.
 * TODO(blocked-by MUT-565): "{used} of {cap} free client books" beside the search, once /v1/me carries the cap.
 */
export function ClientBooksPage() {
  const { t } = useLanguage();
  const books = useClientBooks();
  const [query, setQuery] = useState('');

  return (
    <div className="hp-desk">
      <PageHeader title={t('hosted.clientBooks.title')}>
        {(books.data?.items.length ?? 0) > 0 && (
          <div className="hp-search">
            <SearchInput value={query} onChange={setQuery} placeholder={t('hosted.clientBooks.search')} />
          </div>
        )}
      </PageHeader>
      <QueryView
        queries={[books]}
        data={books.data?.items}
        loading={<Skeleton rows={3} />}
        isEmpty={(items) => items.length === 0}
        // TODO(MUT-561): the `client-books-empty` scene above the title once MUT-561's Scene renderer merges.
        empty={<Empty title={t('hosted.clientBooks.empty.title')} body={t('hosted.clientBooks.empty.body')} />}
      >
        {(items) => <ClientBooksTable items={items} query={query} />}
      </QueryView>
    </div>
  );
}

function ClientBooksTable({ items, query }: { items: AccountantClientWithStats[]; query: string }) {
  const { t, language } = useLanguage();
  const rows = useMemo(() => items.filter((client) => matchesClient(client, query)), [items, query]);
  const columns = useMemo<Column<AccountantClientWithStats>[]>(
    () => [
      { key: 'owner', header: t('hosted.clientBooks.cols.owner'), cell: (row) => <bdi dir="auto">{row.ownerName ?? '—'}</bdi> },
      {
        key: 'profile',
        header: t('hosted.clientBooks.cols.profile'),
        cell: (row) =>
          isEnded(row) ? (
            <bdi dir="auto">{row.name}</bdi>
          ) : (
            <Link to="/client-books/$profileId" params={{ profileId: row.profileId }} aria-label={t('hosted.clientBooks.open', { profile: row.name })}>
              <bdi dir="auto">{row.name}</bdi>
            </Link>
          ),
      },
      {
        key: 'thisMonth',
        header: t('hosted.clientBooks.cols.thisMonth'),
        numeric: true,
        cell: (row) => (isEnded(row) ? <span className="hp-ended-note">{t('hosted.clientBooks.ended')}</span> : (row.entriesThisMonth ?? 0)),
      },
      {
        key: 'lastActivity',
        header: t('hosted.clientBooks.cols.lastActivity'),
        cell: (row) => (row.lastActivityAt && !isEnded(row) ? dayLabel(row.lastActivityAt, language) : t('hosted.clientBooks.noActivity')),
      },
      { key: 'action', header: t('hosted.clientBooks.cols.action'), stickyEnd: true, cell: (row) => (isEnded(row) ? <RemoveEnded client={row} /> : null) },
    ],
    [t, language],
  );
  if (rows.length === 0) return <p className="hp-muted">{t('hosted.clientBooks.searchEmpty', { query: query.trim() })}</p>;
  return <HostedTable columns={columns} rows={rows} rowKey={(row) => row.profileId} label={t('hosted.clientBooks.title')} rowClassName={(row) => (isEnded(row) ? 'hp-row-ended' : undefined)} />;
}

/** AW4: Remove on an ended row, confirmed in place (DESIGN.md › Destructive confirm). */
function RemoveEnded({ client }: { client: AccountantClientWithStats }) {
  const { t } = useLanguage();
  const remove = useRemoveClientBook();
  const [asking, setAsking] = useState(false);
  if (asking) {
    return (
      <InPlaceConfirm
        appearance="row"
        message={t('hosted.clientBooks.removeConfirm', { profile: client.name })}
        cancelLabel={t('hosted.clientBooks.removeNo')}
        confirmLabel={t('hosted.clientBooks.removeYes')}
        busy={remove.isPending}
        onCancel={() => setAsking(false)}
        onConfirm={() => remove.mutate(client.profileId)}
      >
        {remove.isError && (
          <p className="hp-field-error" role="alert">
            {t('hosted.clientBooks.removeFailed')}
          </p>
        )}
      </InPlaceConfirm>
    );
  }
  return (
    <Button variant="ghost" size="sm" aria-label={t('hosted.clientBooks.removeAria', { profile: client.name })} onClick={() => setAsking(true)}>
      {t('hosted.clientBooks.remove')}
    </Button>
  );
}
