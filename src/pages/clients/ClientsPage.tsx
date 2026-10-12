import { useState, useMemo, useCallback } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { TopBar } from '../../components/layout';
import { SearchInput } from '../../components/filters';
import { EmptyState, SortableHeader } from '../../components/ui';
import { OwedNowSummary } from '../../components/clients/OwedNowSummary';
import {
  toClientIndexRow,
  toOwedBucketRows,
  orderClientIndex,
  BUCKET_SCOPE,
  CLIENT_SORT_FIELDS,
  type ClientIndexItem,
  type ClientIndexRow,
  type ClientSortField,
  type OwedBucketRow,
  type RatesToIls,
} from '../../components/clients/clientIndexRows';
import { useClientOwedIndex, useClients, useBusinessProfiles } from '../../hooks/useQueries';
import { useFxRate } from '../../hooks/useFxRate';
import { getCrossProfileClientStats } from '../../db/crossProfileStats';
import { combineOwed } from '../../db/aggregations';
import { useSortState, type SortDir } from '../../hooks/useSortState';
import { useProfileFilter } from '../../hooks/useActiveProfile';
import { useDrawerStore } from '../../lib/stores';
import { owedEntriesSearch } from '../../lib/incomeSearch';
import { formatAmount, formatDate, formatRelativeDate } from '../../lib/utils';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import { useTp } from '../../lib/i18n/plural';
import type { ClientSummary, Currency } from '../../types';

/** Direction a column sorts in when first clicked: names A–Z, money and dates biggest/newest first. */
const FIRST_CLICK_DIR: Record<ClientSortField, SortDir> = {
  name: 'asc',
  owed: 'desc',
  overdue: 'desc',
  lastPayment: 'desc',
  activity: 'desc',
};

const NO_SUMMARIES: ClientSummary[] = [];

/**
 * The clients index (MUT-7): who owes me, and who is late. Owed now and
 * overdue are per currency and never combined; owed now is ordered by today's
 * exchange rate without showing anything converted (ADR-035).
 *
 * Its strip equals Home's Owed now (MUT-83, ADR-049): it counts this
 * business's entries only, and what belongs to no listed client shows in two
 * muted rows after the clients, "No client" and "Archived clients".
 */
export function ClientsPage() {
  const { openClientDrawer } = useDrawerStore();
  const navigate = useNavigate();
  const t = useT();
  const tp = useTp();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const [search, setSearch] = useState('');

  const { sortField, sortDir, setSort } = useSortState<ClientSortField>({
    defaultField: 'owed',
    defaultDir: 'desc',
    validFields: CLIENT_SORT_FIELDS,
  });
  const handleSort = useCallback(
    (field: ClientSortField) =>
      setSort(field, field === sortField ? (sortDir === 'asc' ? 'desc' : 'asc') : FIRST_CLICK_DIR[field]),
    [setSort, sortField, sortDir]
  );

  // Active profile only (strict mode)
  const profileId = useProfileFilter();

  // All clients (every profile), to count the total behind a search
  const { data: allClients = [] } = useClients(undefined);

  const { data: index, isLoading } = useClientOwedIndex(profileId, search);

  // Cross-profile badges: only query if multiple profiles exist
  const { data: profiles = [] } = useBusinessProfiles();
  const hasMultipleProfiles = profiles.filter((p) => !p.archivedAt).length > 1;
  const { data: crossProfileStats } = useQuery({
    queryKey: ['crossProfileClientStats'],
    queryFn: getCrossProfileClientStats,
    enabled: hasMultipleProfiles,
  });

  // Today's rates, used only to order owed now across currencies (ADR-035)
  const { rate: usdRate } = useFxRate('USD', 'ILS');
  const { rate: eurRate } = useFxRate('EUR', 'ILS');
  const rates = useMemo((): RatesToIls => ({ USD: usdRate ?? undefined, EUR: eurRate ?? undefined }), [usdRate, eurRate]);

  const rows = useMemo(
    () => (index?.clients ?? NO_SUMMARIES).map((s) => toClientIndexRow(s, rates)),
    [index, rates]
  );
  // A search narrows the list to named clients: the muted rows hide and the
  // strip sums what is listed. Unsearched, the strip is Home's figure.
  const buckets = useMemo(() => (index && !search ? toOwedBucketRows(index) : []), [index, search]);
  const items = useMemo(
    () => orderClientIndex(rows, buckets, sortField, sortDir),
    [rows, buckets, sortField, sortDir]
  );
  const totalOwed = useMemo(
    () => (search ? combineOwed(rows.map((r) => r.owed)) : (index?.total ?? [])),
    [search, rows, index]
  );

  const columns = useMemo(
    () => [
      { field: 'name' as const, label: t('clients.columns.client') },
      { field: 'owed' as const, label: t('clients.columns.owedNow'), align: 'end' as const, title: t('clients.index.owedOrderHint') },
      { field: 'overdue' as const, label: t('clients.columns.overdue'), align: 'end' as const },
      { field: 'lastPayment' as const, label: t('clients.columns.lastPayment') },
      { field: 'activity' as const, label: t('clients.columns.lastActivity') },
    ],
    [t]
  );

  const amount = (amountMinor: number, currency: Currency, key: string) => (
    <bdi key={key} dir="ltr" className="client-index-amount" data-testid="client-amount">
      {formatAmount(amountMinor, currency, locale)}
    </bdi>
  );

  const renderOverdue = (overdue: ClientIndexRow['overdue'], oldestOverdueDays?: number) =>
    overdue.length === 0 ? (
      <span className="text-muted">—</span>
    ) : (
      <div className="client-index-lines text-danger">
        {overdue.map((o) => amount(o.amountMinor, o.currency, o.currency))}
        {oldestOverdueDays !== undefined && (
          <span className="client-index-subline">{t('clients.index.oldestOverdue', { days: oldestOverdueDays })}</span>
        )}
      </div>
    );

  const renderRow = (row: ClientIndexRow) => (
    <tr
      key={row.id}
      className={row.isSettled ? 'clickable client-index-settled-row' : 'clickable'}
      onClick={() => navigate({ to: '/clients/$clientId', params: { clientId: row.id } })}
    >
      <td>
        <Link
          to="/clients/$clientId"
          params={{ clientId: row.id }}
          className="client-index-name"
          onClick={(e) => e.stopPropagation()}
        >
          {row.name}
        </Link>
        {crossProfileStats?.has(row.id) && (
          <div className="cross-profile-badges">
            {crossProfileStats.get(row.id)!.map((stat) => (
              <span key={stat.profileId} className="cross-profile-badge" title={stat.profileName}>
                <span className="cross-profile-badge-initial">{stat.profileName.charAt(0).toUpperCase()}</span>
                {t('clients.crossProfileTxCount', { count: stat.txCount })}
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="amount-cell" data-testid="client-owed">
        {row.isSettled ? (
          <span className="client-index-settled">{t('clients.index.settled')}</span>
        ) : (
          <div className="client-index-lines">
            {row.owed.map((o) => amount(o.owedMinor, o.currency, o.currency))}
          </div>
        )}
      </td>
      <td className="amount-cell" data-testid="client-overdue">
        {renderOverdue(row.overdue, row.oldestOverdueDays)}
      </td>
      <td data-testid="client-last-payment">
        {row.lastPayment ? (
          <div className="client-index-lines">
            <span>{formatDate(row.lastPayment.paidAt, locale)}</span>
            <span className="client-index-subline">
              {amount(row.lastPayment.amountMinor, row.lastPayment.currency, 'last')}
            </span>
          </div>
        ) : (
          <span className="text-muted">{t('clients.index.neverPaid')}</span>
        )}
      </td>
      <td className="text-muted">{row.lastActivityAt ? formatRelativeDate(row.lastActivityAt, t) : '—'}</td>
    </tr>
  );

  /** A muted row: owed now of no listed client, opening /income on those entries. */
  const renderBucketRow = (bucket: OwedBucketRow) => {
    const entries = owedEntriesSearch(BUCKET_SCOPE[bucket.kind]);
    return (
      <tr
        key={bucket.kind}
        className="clickable client-index-bucket-row"
        onClick={() => navigate({ to: '/income', search: entries })}
      >
        <td>
          <Link to="/income" search={entries} className="client-index-name" onClick={(e) => e.stopPropagation()}>
            {tp(`clients.index.bucket.${bucket.kind}`, bucket.count)}
          </Link>
        </td>
        <td className="amount-cell" data-testid="client-owed">
          <div className="client-index-lines">{bucket.owed.map((o) => amount(o.owedMinor, o.currency, o.currency))}</div>
        </td>
        <td className="amount-cell" data-testid="client-overdue">
          {renderOverdue(bucket.overdue)}
        </td>
        <td />
        <td />
      </tr>
    );
  };

  const renderItem = (item: ClientIndexItem) =>
    item.type === 'client' ? renderRow(item.row) : renderBucketRow(item.row);

  const isSearchMiss = Boolean(search) && allClients.length > 0;

  return (
    <>
      <TopBar title={t('clients.title')} />
      <div className="page-content">
        <div className="filters-row">
          <SearchInput value={search} onChange={setSearch} placeholder={t('clients.searchPlaceholder')} />
        </div>

        {isLoading ? (
          <div className="loading">
            <div className="spinner" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title={isSearchMiss ? t('clients.emptyFiltered') : t('clients.empty')}
            description={
              isSearchMiss
                ? t('clients.emptyFilteredCount', { count: allClients.length })
                : search
                  ? t('clients.emptySearch')
                  : t('clients.emptyHint')
            }
            action={
              isSearchMiss
                ? { label: t('clients.clearSearch'), onClick: () => setSearch('') }
                : { label: t('clients.addClient'), onClick: () => openClientDrawer({ mode: 'create' }) }
            }
          />
        ) : (
          <>
            <div className="card clients-index-summary">
              <div className="clients-summary-count">
                {rows.length === 1
                  ? t('clients.summary.clientsCountOne')
                  : t('clients.summary.clientsCount', { count: rows.length })}
              </div>
              <OwedNowSummary owed={totalOwed} />
            </div>
            <div className="data-table clients-index-table">
              <table>
                <thead>
                  <tr>
                    {columns.map((column) => (
                      <SortableHeader
                        key={column.field}
                        {...column}
                        sortField={sortField}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>{items.map(renderItem)}</tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
