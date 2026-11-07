import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { SearchInput } from '../../../components/filters/SearchInput';
import { Button } from '../../../components/ui/Button';
import { useLanguage } from '../../../lib/i18n/core';
import { api, type AccountantClientWithStats, type ClientRowWithPlan } from '../../api/client';
import { trackPortal } from '../../analytics/portalAnalytics';
import { AccountantPlanOffer, clientBooksOf, planCovers } from '../../components/AccountantPlanOffer';
import { ProblemText } from '../../components/PeriodDownloads';
import { downloadProblem, submitDownload, type DownloadProblem } from '../../data/periodDownload';
import { useMe } from '../../session/me';
import { HostedTable, type Column } from '../../components/HostedTable';
import { InPlaceConfirm } from '../../components/InPlaceConfirm';
import { QueryView, Skeleton } from '../../components/QueryView';
import { Scene } from '../../components/Scene';
import { useClientBooks, useRemoveClientBook } from '../../data/clientBooksQueries';
import { PageHeader } from '../views/shared';
import { addMonths, dayLabel, isEnded, matchesClient, monthOfDate, periodLabel } from './clientBooksRules';

/**
 * `/client-books` (MUT-562, layout C1): the accountant's desk, every client book shared with them. Owner, profile,
 * entries this month and last activity per row (AC1); a row opens the client's book. An ended client stays faded with
 * "No longer shared" and Remove until removed (AW4). With none, the empty state says how a client invites you (AW5).
 *
 * Each readable row downloads last month's Excel report (Basel 13244: the report only). With MUT-565's fields: "{readable}
 * of {freeLimit} free client books" under the title while no plan covers, and a row past the free ones (`needsPlan`)
 * is faded with Subscribe (the Accountant plan, back to the desk).
 */
export function ClientBooksPage() {
  const { t } = useLanguage();
  const books = useClientBooks();
  const [query, setQuery] = useState('');
  const summary = clientBooksOf(useMe());
  const [subscribing, setSubscribing] = useState(false);

  return (
    <div className="hp-desk">
      <PageHeader title={t('hosted.clientBooks.title')}>
        {(books.data?.items.length ?? 0) > 0 && (
          <div className="hp-search">
            <SearchInput value={query} onChange={setQuery} placeholder={t('hosted.clientBooks.search')} />
          </div>
        )}
      </PageHeader>
      {summary && summary.cap !== null && !planCovers(summary) && (
        <p className="hp-free-books">{t('hosted.clientBooks.free', { readable: Math.min(summary.readable, summary.freeLimit), freeLimit: summary.freeLimit })}</p>
      )}
      {subscribing && (
        <section className="hp-card hp-plan-prompt" aria-label={t('hosted.accountantPlan.name')}>
          <p>{t('hosted.clientBooks.planPrompt', { count: summary?.freeLimit ?? 3 })}</p>
          <AccountantPlanOffer returnPath="/client-books" place="client_books" />
        </section>
      )}
      <QueryView
        queries={[books]}
        data={books.data?.items}
        loading={<Skeleton rows={3} />}
        isEmpty={(items) => items.length === 0}
        empty={
          <div className="hp-empty hp-client-books-empty">
            <Scene name="client-books-empty" motion="drop-in" />
            <h2>{t('hosted.clientBooks.empty.title')}</h2>
            <p>{t('hosted.clientBooks.empty.body')}</p>
          </div>
        }
      >
        {(items) => <ClientBooksTable items={items} query={query} onSubscribe={() => setSubscribing(true)} />}
      </QueryView>
    </div>
  );
}

const needsPlan = (row: AccountantClientWithStats) => (row as ClientRowWithPlan).needsPlan === true;

function ClientBooksTable({ items, query, onSubscribe }: { items: AccountantClientWithStats[]; query: string; onSubscribe: () => void }) {
  const { t, language } = useLanguage();
  const rows = useMemo(() => items.filter((client) => matchesClient(client, query)), [items, query]);
  const columns = useMemo<Column<AccountantClientWithStats>[]>(
    () => [
      { key: 'owner', header: t('hosted.clientBooks.cols.owner'), cell: (row) => <bdi dir="auto">{row.ownerName ?? '—'}</bdi> },
      {
        key: 'profile',
        header: t('hosted.clientBooks.cols.profile'),
        cell: (row) =>
          isEnded(row) || needsPlan(row) ? (
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
        cell: (row) =>
          isEnded(row) ? (
            <span className="hp-ended-note">{t('hosted.clientBooks.ended')}</span>
          ) : needsPlan(row) ? (
            <span className="hp-ended-note">{t('hosted.clientBooks.needsPlan')}</span>
          ) : (
            (row.entriesThisMonth ?? 0)
          ),
      },
      {
        key: 'lastActivity',
        header: t('hosted.clientBooks.cols.lastActivity'),
        cell: (row) => (row.lastActivityAt && !isEnded(row) ? dayLabel(row.lastActivityAt, language) : t('hosted.clientBooks.noActivity')),
      },
      {
        key: 'action',
        header: t('hosted.clientBooks.cols.action'),
        stickyEnd: true,
        cell: (row) =>
          isEnded(row) ? (
            <RemoveEnded client={row} />
          ) : needsPlan(row) ? (
            <Button variant="ghost" size="sm" onClick={onSubscribe} aria-label={t('hosted.clientBooks.subscribeAria', { profile: row.name })}>
              {t('hosted.accountantPlan.subscribe')}
            </Button>
          ) : (
            <LastMonthReport client={row} />
          ),
      },
    ],
    [t, language, onSubscribe],
  );
  if (rows.length === 0) return <p className="hp-muted">{t('hosted.clientBooks.searchEmpty', { query: query.trim() })}</p>;
  return <HostedTable columns={columns} rows={rows} rowKey={(row) => row.profileId} label={t('hosted.clientBooks.title')} rowClassName={(row) => (isEnded(row) ? 'hp-row-ended' : needsPlan(row) ? 'hp-row-ended hp-row-needs-plan' : undefined)} />;
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

/** Basel 13244: the row's "Download {last month}" is last month's Excel report only, straight to the stream. */
function LastMonthReport({ client }: { client: AccountantClientWithStats }) {
  const { t, language } = useLanguage();
  const [month] = useState(() => addMonths(monthOfDate(new Date()), -1));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<DownloadProblem | null>(null);
  const label = periodLabel(month, month, language).replace(/\s*\d{4}$/, '');
  async function download() {
    setBusy(true);
    setProblem(null);
    try {
      const ticket = await api.periodDownloadTicket(client.profileId, { type: 'report', from: month, to: month, lang: language });
      submitDownload(ticket.ticket);
      void trackPortal('period_downloaded', { place: 'client_books', file: 'report', months: 1 });
    } catch (error) {
      setProblem(downloadProblem(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="hp-row-download">
      <Button variant="ghost" size="sm" onClick={() => void download()} disabled={busy} aria-label={t('hosted.clientBooks.download.monthAria', { month: label, profile: client.name })}>
        {t('hosted.clientBooks.download.month', { month: label })}
      </Button>
      {problem && (
        <span className="hp-field-error" role="alert">
          <ProblemText problem={problem} />
        </span>
      )}
    </span>
  );
}
