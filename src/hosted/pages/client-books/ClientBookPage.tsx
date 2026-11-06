import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { SegmentedControl } from '../../../components/ui/SegmentedControl';
import { Button } from '../../../components/ui/Button';
import { useLanguage } from '../../../lib/i18n/core';
import { api, type AccountantClientWithStats, type ClientRowWithPlan } from '../../api/client';
import { AccountantPlanOffer } from '../../components/AccountantPlanOffer';
import { trackPortal } from '../../analytics/portalAnalytics';
import { PeriodDownloads } from '../../components/PeriodDownloads';
import { EntriesTable, deskRow, type EntryRow } from '../../components/EntriesTable';
import { Skeleton, Unreachable } from '../../components/QueryView';
import { DecimalAmount } from '../../format/DecimalAmount';
import { isClientGone, useClientBooks, useClientCategories, useClientEntries, useClientTotals, useForgetClient } from '../../data/clientBooksQueries';
import { ClientReceiptPane } from './ClientReceiptPane';
import {
  DESK_PAGE,
  dayLabel,
  isEnded,
  monthOfDate,
  monthsBetween,
  periodLabel,
  periodOf,
  periodSearch,
  presetPeriod,
  totalsOf,
  visibleRows,
  type ClientBookSearch,
  type Month,
  type Period,
  type Preset,
} from './clientBooksRules';

/**
 * `/client-books/$profileId` (MUT-562, layout C2/C3): one client's book, read-only. "{owner} · {profile}" with the
 * read-only line under it (AW2 = C); a steady side pane with the period (whole months), the type, the totals per
 * currency and the downloads; the entries table, a page of 100 at a time; a row's receipts in a pane. There is no
 * add, edit or delete anywhere (AC3), and the server refuses writes regardless (MUT-559). A read answering 404 means
 * the owner stopped sharing since the page opened: the "no longer shared" state.
 */

interface ClientBookPageProps {
  profileId: string;
  search: ClientBookSearch;
  setSearch: (next: ClientBookSearch) => void;
}

export function ClientBookPage({ profileId, search, setSearch }: ClientBookPageProps) {
  const books = useClientBooks();
  const client = books.data?.items.find((item) => item.profileId === profileId) ?? null;
  const [gone, setGone] = useState(false);
  const forget = useForgetClient();
  const onGone = useMemo(
    () => () => {
      setGone(true);
      forget(profileId);
    },
    [forget, profileId],
  );

  if (books.isPending) return <Skeleton rows={6} />;
  if (books.isError) return <Unreachable onRetry={() => void books.refetch()} />;
  // Not on the list (removed, never shared) or ended: the same answer as a 404 mid-session
  if (gone || !client || isEnded(client)) return <NoLongerShared client={client} />;
  // MUT-565: past the free client books, a client opens only with the Accountant plan (gated on the field)
  if ((client as ClientRowWithPlan).needsPlan === true) return <NeedsPlan client={client} />;
  return <ClientBook client={client} search={search} setSearch={setSearch} onGone={onGone} />;
}

function NeedsPlan({ client }: { client: AccountantClientWithStats }) {
  const { t } = useLanguage();
  return (
    <section className="hp-empty hp-client-gone" role="status">
      <h1>{t('hosted.clientBooks.needsPlanTitle', { profile: client.name })}</h1>
      <p>{t('hosted.clientBooks.planPrompt', { count: 3 })}</p>
      <AccountantPlanOffer returnPath={`/client-books/${client.profileId}`} />
      <Link to="/client-books" className="btn btn-secondary btn-md">
        {t('hosted.clientBooks.gone.back')}
      </Link>
    </section>
  );
}

function NoLongerShared({ client }: { client: AccountantClientWithStats | null }) {
  const { t } = useLanguage();
  const profile = client?.name ?? '';
  return (
    <section className="hp-empty hp-client-gone" role="status">
      {/* TODO(MUT-561): the `share-ended` scene once MUT-561's Scene renderer merges. */}
      <h1>{t('hosted.clientBooks.gone.title')}</h1>
      <p>{client?.ownerName ? t('hosted.clientBooks.gone.body', { owner: client.ownerName, profile }) : t('hosted.clientBooks.gone.bodyNoOwner', { profile })}</p>
      <Link to="/client-books" className="btn btn-primary btn-md">
        {t('hosted.clientBooks.gone.back')}
      </Link>
    </section>
  );
}

function ClientBook({ client, search, setSearch, onGone }: { client: AccountantClientWithStats; search: ClientBookSearch; setSearch: (next: ClientBookSearch) => void; onGone: () => void }) {
  const { t, language } = useLanguage();
  const [current] = useState(() => monthOfDate(new Date()));
  const period = periodOf(search, current);
  const profileId = client.profileId;
  const entries = useClientEntries(profileId, period, search.kind);
  const totals = useClientTotals(profileId, period);
  const categories = useClientCategories(profileId);
  const receiptsOnly = search.receipts === 'only';

  const goneError = [entries.error, totals.error].some(isClientGone);
  useEffect(() => {
    if (goneError) onGone();
  }, [goneError, onGone]);

  // "Only with a receipt" is filtered here, so a page can come back thin: keep loading until a page's worth shows
  const [target, setTarget] = useState(DESK_PAGE);
  const rows = useMemo(() => visibleRows(entries.data ?? [], receiptsOnly), [entries.data, receiptsOnly]);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = entries;
  useEffect(() => {
    if (receiptsOnly && rows.length < target && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [receiptsOnly, rows.length, target, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const tableRows = useMemo(() => rows.map((entry) => deskRow(entry, categories.data)), [rows, categories.data]);
  const update = (patch: Partial<ClientBookSearch>) => setSearch({ ...search, ...patch });
  const setPeriod = (next: Period) => {
    setTarget(DESK_PAGE);
    setSearch({ ...withoutPeriod(search), ...periodSearch(next) });
  };
  const openRow = (row: EntryRow) => row.receiptRef && update({ entry: row.receiptRef });

  return (
    <div className="hp-desk hp-client-book">
      <header className="hp-page-header hp-client-book-head">
        <Link to="/client-books" className="hp-back">
          {t('hosted.clientBooks.back')}
        </Link>
        <h1>
          {client.ownerName ? (
            <>
              <bdi dir="auto">{client.ownerName}</bdi> · <bdi dir="auto">{client.name}</bdi>
            </>
          ) : (
            <bdi dir="auto">{client.name}</bdi>
          )}
        </h1>
        <p className="hp-read-only-line">{t('hosted.clientBooks.readOnly', { date: dayLabel(client.sharedSince, language) })}</p>
      </header>

      <div className="hp-client-book-body">
        <aside className="hp-client-book-side" aria-label={t('hosted.clientBooks.filters.label')}>
          <PeriodFilter period={period} current={current} onChange={setPeriod} />
          <TypeFilter search={search} onChange={(patch) => update({ ...patch, entry: undefined })} />
          <section className="hp-client-book-totals" aria-label={t('hosted.clientBooks.totals.label', { period: periodLabel(period.from, period.to, language) })}>
            {totals.isPending ? (
              <Skeleton rows={2} />
            ) : totals.isError ? null : totalsOf(totals.data).length === 0 ? (
              <p className="hp-muted">{t('hosted.clientBooks.totals.none')}</p>
            ) : (
              totalsOf(totals.data).map((line) => (
                <dl key={line.currency} className="hp-client-book-currency">
                  <dt>{t('hosted.clientBooks.totals.spent')}</dt>
                  <dd>
                    <DecimalAmount value={line.spent} currency={line.currency} />
                  </dd>
                  <dt>{t('hosted.clientBooks.totals.received')}</dt>
                  <dd>
                    <DecimalAmount value={line.received} currency={line.currency} />
                  </dd>
                </dl>
              ))
            )}
          </section>
          {/* AW3/SL3 + Basel 13244: the downloads follow the period only (both sheets whatever the type filter) */}
          <PeriodDownloads
            key={`${period.from}…${period.to}`}
            mint={(type, asOf) => api.periodDownloadTicket(profileId, { type, from: period.from, to: period.to, lang: language, asOf })}
            onDownloaded={(file) => void trackPortal('period_downloaded', { place: 'client_books', file, months: monthsBetween(period.from, period.to) })}
          />
        </aside>

        <section className="hp-client-book-main">
          {entries.isError && !goneError ? (
            <Unreachable onRetry={() => void entries.refetch()} />
          ) : entries.isPending ? (
            <Skeleton rows={6} />
          ) : tableRows.length === 0 && !hasNextPage ? (
            <p className="hp-muted">{t(search.kind || receiptsOnly ? 'hosted.clientBooks.table.emptyFiltered' : 'hosted.clientBooks.table.empty')}</p>
          ) : (
            <>
              <EntriesTable rows={tableRows} label={t('hosted.clientBooks.table.label')} onOpenReceipt={openRow} openKey={search.entry ? `e:${search.entry}` : null} />
              {hasNextPage && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setTarget((n) => n + DESK_PAGE);
                    if (!receiptsOnly) void fetchNextPage();
                  }}
                  disabled={isFetchingNextPage}
                >
                  {t(isFetchingNextPage ? 'hosted.clientBooks.table.loading' : 'hosted.clientBooks.table.loadMore')}
                </Button>
              )}
            </>
          )}
        </section>
      </div>
      {search.entry && <ClientReceiptPane profileId={profileId} expenseId={search.entry} onClose={() => update({ entry: undefined })} onGone={onGone} />}
    </div>
  );
}

function withoutPeriod(search: ClientBookSearch): ClientBookSearch {
  const rest = { ...search };
  delete rest.preset;
  delete rest.from;
  delete rest.to;
  return rest;
}

function PeriodFilter({ period, current, onChange }: { period: Period; current: Month; onChange: (next: Period) => void }) {
  const { t } = useLanguage();
  const ids = useId();
  return (
    <fieldset className="hp-client-book-filter">
      <legend>{t('hosted.clientBooks.filters.period')}</legend>
      <SegmentedControl<Preset>
        ariaLabel={t('hosted.clientBooks.filters.period')}
        value={period.preset}
        onChange={(preset) => onChange(preset === 'custom' ? { ...period, preset } : presetPeriod(preset, current))}
        options={(['month', 'quarter', 'year', 'custom'] as const).map((value) => ({ value, label: t(`hosted.clientBooks.filters.${value}`) }))}
      />
      {period.preset === 'custom' && (
        <div className="hp-client-book-months">
          <label htmlFor={`${ids}-from`}>{t('hosted.clientBooks.filters.fromMonth')}</label>
          <input
            id={`${ids}-from`}
            className="input"
            type="month"
            dir="ltr"
            max={current}
            value={period.from}
            onChange={(e) => e.target.value && onChange({ ...period, from: e.target.value })}
          />
          <label htmlFor={`${ids}-to`}>{t('hosted.clientBooks.filters.toMonth')}</label>
          <input id={`${ids}-to`} className="input" type="month" dir="ltr" max={current} value={period.to} onChange={(e) => e.target.value && onChange({ ...period, to: e.target.value })} />
        </div>
      )}
    </fieldset>
  );
}

/** Expenses ☑ Income ☑ (at least one stays on), Only with a receipt ☐. */
function TypeFilter({ search, onChange }: { search: ClientBookSearch; onChange: (patch: Partial<ClientBookSearch>) => void }) {
  const { t } = useLanguage();
  const expenses = search.kind !== 'income';
  const income = search.kind !== 'expense';
  const kindOf = (e: boolean, i: boolean) => (e && i ? undefined : e ? ('expense' as const) : ('income' as const));
  return (
    <fieldset className="hp-client-book-filter">
      <legend>{t('hosted.clientBooks.filters.type')}</legend>
      <label className="hp-check-row">
        <input type="checkbox" checked={expenses} disabled={expenses && !income} onChange={(e) => onChange({ kind: kindOf(e.target.checked, income), ...(e.target.checked ? {} : { receipts: undefined }) })} />
        <span>{t('hosted.clientBooks.filters.expenses')}</span>
      </label>
      <label className="hp-check-row">
        <input type="checkbox" checked={income} disabled={income && !expenses} onChange={(e) => onChange({ kind: kindOf(expenses, e.target.checked) })} />
        <span>{t('hosted.clientBooks.filters.income')}</span>
      </label>
      <label className="hp-check-row">
        <input type="checkbox" checked={search.receipts === 'only'} disabled={!expenses} onChange={(e) => onChange({ receipts: e.target.checked ? 'only' : undefined })} />
        <span>{t('hosted.clientBooks.filters.withReceipt')}</span>
      </label>
    </fieldset>
  );
}
