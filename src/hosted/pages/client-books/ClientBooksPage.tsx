import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
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
import { useAccountantCustomers } from '../../data/accountantCustomersQueries';
import { activatingIds, activationMarks, clearActivating } from '../../data/activating';
import { useClientBooks, useRemoveClientBook } from '../../data/clientBooksQueries';
import type { DeskSearch } from '../../data/filters';
import { PageHeader } from '../views/shared';
import { AddCustomerDrawer } from './AddCustomerDrawer';
import { CustomerDrawer } from './CustomerDrawer';
import { DeskActivating } from './DeskActivating';
import { DeskBadge } from './DeskBadge';
import { buildDeskRows, filterCounts, matchesDeskFilter, matchesDeskRow, nextActionOf, type DeskFilter, type DeskRow } from './deskRules';
import { addMonths, dayLabel, monthOfDate, periodLabel } from './clientBooksRules';

/**
 * `/client-books` (MUT-562, layout C1): the accountant's desk, every client book shared with them. MUT-768 (accountant
 * channel) adds the customers the accountant created: a state badge on every row (always the word), filter chips, ONE
 * next action per row (New code, Resend link, Take card), Add customer and the Customer drawer (`?newCustomer=`,
 * `?customer=`). An accountant the operator has not approved sees the desk as before: no chips, no Add customer.
 *
 * Owner, profile, entries this month and last activity per row (AC1); a row opens the client's book. An ended client
 * stays faded with "No longer shared" and Remove until removed (AW4). With none, the empty state says how a client invites
 * you (AW5), or, for an approved accountant, offers Add customer.
 *
 * Each readable row downloads last month's Excel report (Basel 13244: the report only). With MUT-565's fields: "{readable}
 * of {freeLimit} free client books" under the title while no plan covers, and a row past the free ones (`needsPlan`)
 * is faded with Subscribe (the Accountant plan, back to the desk).
 */
/** How often the page re-checks which customers are still inside their two-minute Activating window (DR-5). */
const ACTIVATING_TICK_MS = 5_000;

export function ClientBooksPage() {
  const { t } = useLanguage();
  const books = useClientBooks();
  const search = useSearch({ strict: false }) as DeskSearch;
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<DeskFilter>('all');
  const summary = clientBooksOf(useMe());
  const [subscribing, setSubscribing] = useState(false);

  // Activating (DR-5): the customers sent to Stripe in the last two minutes. MUT-770's poll (DeskActivating) re-reads
  // the list; this tick only re-evaluates who is still inside the window, so a row falls back to Needs card on time.
  const [now, setNow] = useState(() => Date.now());
  const activating = activatingIds(now);
  const marks = activationMarks();
  const waiting = activating.size > 0;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), ACTIVATING_TICK_MS);
    return () => clearInterval(timer);
  }, [waiting]);
  const customersQuery = useAccountantCustomers();
  const customers = customersQuery.data;
  const approved = customers?.approved === true;

  const activatingKey = [...activating].sort().join(',');
  const rows = useMemo(
    () => buildDeskRows(books.data?.items ?? [], customers?.items ?? [], new Set(activatingKey ? activatingKey.split(',') : [])),
    [books.data, customers, activatingKey],
  );
  const goTo = (next: DeskSearch, replace = false) => void navigate({ to: '/client-books', search: next, replace });
  const closeDrawers = () => goTo({}, true);
  const customerRow = search.customer ? rows.find((row) => row.customer?.userId === search.customer) : undefined;
  const addButton = approved ? (
    <Button type="button" onClick={() => goTo({ newCustomer: true })}>
      {t('hosted.desk.add')}
    </Button>
  ) : null;

  return (
    <div className="hp-desk">
      <PageHeader title={t('hosted.clientBooks.title')}>
        {rows.length > 0 && (
          <div className="hp-search">
            <SearchInput value={query} onChange={setQuery} placeholder={t('hosted.clientBooks.search')} />
          </div>
        )}
        {addButton}
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
      <DeskActivating
        rows={rows}
        marks={marks}
        poll={() => void customersQuery.refetch()}
        onClose={(userId) => {
          clearActivating(userId);
          setNow(Date.now());
        }}
      />
      {approved && rows.length > 0 && <DeskChips rows={rows} filter={filter} onFilter={setFilter} />}
      <QueryView
        queries={[books]}
        data={books.data ? rows : undefined}
        loading={<Skeleton rows={3} />}
        isEmpty={(items) => items.length === 0}
        empty={
          <div className="hp-empty hp-client-books-empty">
            <Scene name="client-books-empty" motion="drop-in" />
            <h2>{approved ? t('hosted.desk.emptyTitle') : t('hosted.clientBooks.empty.title')}</h2>
            {approved ? (
              <>
                {addButton}
                <p>{t('hosted.desk.emptyOr')}</p>
              </>
            ) : (
              <p>{t('hosted.clientBooks.empty.body')}</p>
            )}
          </div>
        }
      >
        {(items) => (
          <ClientBooksTable
            items={items}
            query={query}
            filter={approved ? filter : 'all'}
            onSubscribe={() => setSubscribing(true)}
            onOpen={(row, pane) => goTo({ customer: row.customer!.userId, ...(pane ? { pane } : {}) })}
          />
        )}
      </QueryView>
      {search.newCustomer && approved && <AddCustomerDrawer onClose={closeDrawers} />}
      {customerRow?.customer && <CustomerDrawer key={customerRow.key} row={customerRow} pane={search.pane} onClose={closeDrawers} onPane={(pane) => goTo({ customer: search.customer!, ...(pane ? { pane } : {}) }, true)} />}
    </div>
  );
}

/** Filter chips with counts (DR-2): All, Awaiting claim, Needs card, Active. */
function DeskChips({ rows, filter, onFilter }: { rows: DeskRow[]; filter: DeskFilter; onFilter: (filter: DeskFilter) => void }) {
  const { t } = useLanguage();
  const counts = filterCounts(rows);
  return (
    <div className="hp-desk-chips" role="group" aria-label={t('hosted.desk.filters.label')}>
      {(['all', 'awaiting', 'needcard', 'active'] as const).map((key) => (
        <button key={key} type="button" className="hp-chip" aria-pressed={filter === key} onClick={() => onFilter(key)}>
          {t(`hosted.desk.filters.${key}`)} <span className="hp-chip-count">{counts[key]}</span>
        </button>
      ))}
    </div>
  );
}

const needsPlan = (row: AccountantClientWithStats | null) => (row as ClientRowWithPlan | null)?.needsPlan === true;

interface TableProps {
  items: DeskRow[];
  query: string;
  filter: DeskFilter;
  onSubscribe: () => void;
  onOpen: (row: DeskRow, pane?: 'card') => void;
}

function ClientBooksTable({ items, query, filter, onSubscribe, onOpen }: TableProps) {
  const { t, language } = useLanguage();
  const rows = useMemo(() => items.filter((row) => matchesDeskFilter(row, filter) && matchesDeskRow(row, query)), [items, query, filter]);
  const columns = useMemo<Column<DeskRow>[]>(
    () => [
      {
        key: 'customer',
        header: t('hosted.desk.cols.customer'),
        cell: (row) => (
          <>
            {row.client && row.state !== 'ended' && !needsPlan(row.client) ? (
              <Link to="/client-books/$profileId" params={{ profileId: row.client.profileId }} aria-label={t('hosted.clientBooks.open', { profile: row.name })}>
                <bdi dir="auto">{row.name}</bdi>
              </Link>
            ) : (
              <bdi dir="auto">{row.name}</bdi>
            )}
            <div className="hp-muted">
              <bdi dir="auto">{row.ownerName ?? '—'}</bdi>
            </div>
          </>
        ),
      },
      {
        key: 'state',
        header: t('hosted.desk.cols.state'),
        cell: (row) => <DeskBadge state={row.state} />,
      },
      {
        key: 'thisMonth',
        header: t('hosted.clientBooks.cols.thisMonth'),
        numeric: true,
        cell: (row) => (needsPlan(row.client) ? <span className="hp-ended-note">{t('hosted.clientBooks.needsPlan')}</span> : row.client && row.state !== 'ended' ? (row.client.entriesThisMonth ?? 0) : '—'),
      },
      {
        key: 'lastActivity',
        header: t('hosted.clientBooks.cols.lastActivity'),
        cell: (row) => (row.client?.lastActivityAt && row.state !== 'ended' ? dayLabel(row.client.lastActivityAt, language) : t('hosted.clientBooks.noActivity')),
      },
      {
        key: 'action',
        header: t('hosted.clientBooks.cols.action'),
        stickyEnd: true,
        cell: (row) => {
          const next = nextActionOf(row.state);
          if (row.state === 'ended' && row.client) return <RemoveEnded client={row.client} />;
          if (needsPlan(row.client) && row.client) {
            return (
              <Button variant="ghost" size="sm" onClick={onSubscribe} aria-label={t('hosted.clientBooks.subscribeAria', { profile: row.name })}>
                {t('hosted.accountantPlan.subscribe')}
              </Button>
            );
          }
          if (next && row.customer) {
            return (
              <Button variant="ghost" size="sm" className="hp-desk-row-action" onClick={() => onOpen(row, next === 'takeCard' ? 'card' : undefined)} aria-label={t('hosted.desk.nextAria', { action: t(`hosted.desk.next.${next}`), profile: row.name })}>
                {t(`hosted.desk.next.${next}`)}
              </Button>
            );
          }
          return row.client ? <LastMonthReport client={row.client} /> : null;
        },
      },
    ],
    [t, language, onSubscribe, onOpen],
  );
  if (rows.length === 0) return <p className="hp-muted">{t('hosted.clientBooks.searchEmpty', { query: query.trim() })}</p>;
  return (
    <HostedTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.key}
      label={t('hosted.clientBooks.title')}
      rowClassName={(row) => (row.state === 'ended' ? 'hp-row-ended' : needsPlan(row.client) ? 'hp-row-ended hp-row-needs-plan' : undefined)}
    />
  );
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
