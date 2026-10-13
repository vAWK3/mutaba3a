import { useMemo, useCallback, useEffect, useRef, type KeyboardEvent } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { SearchInput } from '../../components/filters';
import { EmptyState, SortableHeader } from '../../components/ui';
import { OwedNowSummary } from '../../components/clients/OwedNowSummary';
import {
  toClientIndexRow,
  toOwedBucketRows,
  toBusinessBucketRows,
  orderClientIndex,
  BUCKET_SCOPE,
  type ClientIndexItem,
  type ClientIndexRow,
  type ClientSortField,
  type OwedBucketRow,
  type RatesToIls,
} from '../../components/clients/clientIndexRows';
import { resolveClientsSearch } from '../../components/clients/clientsSearch';
import { useClientsSearch } from '../../components/clients/useClientsSearch';
import {
  listKeyAction,
  adjacentClientId,
  firstClientId,
  clientRowLink,
  hasModifier,
} from '../../components/clients/clientsSplitView';
import { useClientOwedIndex, useClients, useBusinessProfiles } from '../../hooks/useQueries';
import { useFxRate } from '../../hooks/useFxRate';
import { getRepositories } from '../../db';
import { combineOwed } from '../../db/aggregations';
import type { SortDir } from '../../hooks/useSortState';
import { useOwedLens } from '../../hooks/useActiveProfile';
import { useProfileStore } from '../../lib/profileStore';
import { BusinessTags } from '../../components/ui/ProfileBadge';
import { useDrawerStore } from '../../lib/stores';
import { owedEntriesSearch } from '../../lib/incomeSearch';
import { formatAmount, formatDate, formatRelativeDate, cn } from '../../lib/utils';
import { useT, useLanguage, useDirection, getLocale } from '../../lib/i18n';
import { useTp } from '../../lib/i18n/plural';
import type { ClientOwedIndexRow, Currency } from '../../types';

/** Direction a column sorts in when first clicked: names A–Z, money and dates biggest/newest first. */
const FIRST_CLICK_DIR: Record<ClientSortField, SortDir> = {
  name: 'asc',
  owed: 'desc',
  overdue: 'desc',
  lastPayment: 'desc',
  activity: 'desc',
};

const NO_SUMMARIES: ClientOwedIndexRow[] = [];

export interface ClientsPageProps {
  /** The client open beside the list or in place of it: its row is marked and its link is the current page (MUT-84) */
  openClientId?: string;
  /** Wide windows only: ↑/↓ on a client row open the previous/next client (the walk) */
  onWalk?: (clientId: string) => void;
  /** Wide windows with a client open: Enter on its row, or the arrow toward the profile, moves focus there */
  onEnterProfile?: () => void;
}

/**
 * The clients index (MUT-7): who owes me, and who is late. Owed now and
 * overdue are per currency and never combined; owed now is ordered by today's
 * exchange rate without showing anything converted (ADR-035).
 *
 * Its strip equals Home's Owed now (MUT-83, ADR-049): it counts this
 * business's entries only, and what belongs to no listed client shows in two
 * muted rows after the clients, "No client" and "Archived clients".
 *
 * With "All businesses" on (MUT-89, ADR-051) it counts every business: each
 * row names the businesses its entries are in, and the muted rows come one
 * per business, each opening Income in its own business (O4).
 *
 * Since MUT-84 (ADR-050) it is the Clients layout's list pane: the layout owns
 * the top bar and opens a client beside this list on a wide window. The search
 * and sort live in the URL (`useClientsSearch`) and every client link keeps
 * them, so they survive switching clients.
 */
export function ClientsPage({ openClientId, onWalk, onEnterProfile }: ClientsPageProps = {}) {
  const { openClientDrawer } = useDrawerStore();
  const navigate = useNavigate();
  const t = useT();
  const tp = useTp();
  const direction = useDirection();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const tableRef = useRef<HTMLDivElement>(null);

  const { search: urlSearch, setSearch: setUrlSearch } = useClientsSearch();
  const { q: search, sort: sortField, dir: sortDir } = useMemo(() => resolveClientsSearch(urlSearch), [urlSearch]);
  const setSearch = useCallback((q: string) => setUrlSearch({ q }), [setUrlSearch]);
  const handleSort = useCallback(
    (field: ClientSortField) =>
      setUrlSearch({
        sort: field,
        dir: field === sortField ? (sortDir === 'asc' ? 'desc' : 'asc') : FIRST_CLICK_DIR[field],
      }),
    [setUrlSearch, sortField, sortDir]
  );

  // The working business, or every business with All businesses on (MUT-89).
  // Nothing is read until the businesses are known: no scope means every record.
  const { scope, isAll, profilesById } = useOwedLens();
  const setWorkingProfile = useProfileStore((s) => s.setWorkingProfile);

  // All clients (every profile), to count the total behind a search
  const { data: allClients = [] } = useClients(undefined);

  // Pending, not loading: a query waiting for the scope is not "loading" (D2)
  const { data: index, isPending } = useClientOwedIndex(scope, search, { enabled: scope !== undefined });

  // Cross-profile badges ("N entries" in other businesses): one business only.
  // Under All businesses the row's business tags say it instead.
  const { data: profiles = [] } = useBusinessProfiles();
  const hasMultipleProfiles = profiles.filter((p) => !p.archivedAt).length > 1;
  const { data: crossProfileStats } = useQuery({
    queryKey: ['crossProfileClientStats'],
    queryFn: () => getRepositories().base.clientSummaries.getCrossProfileStats(),
    enabled: hasMultipleProfiles && !isAll,
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
  const buckets = useMemo(() => {
    if (!index || search) return [];
    return isAll && index.byProfile ? toBusinessBucketRows(index.byProfile) : toOwedBucketRows(index);
  }, [index, search, isAll]);
  const items = useMemo(
    () => orderClientIndex(rows, buckets, sortField, sortDir),
    [rows, buckets, sortField, sortDir]
  );
  const totalOwed = useMemo(
    () => (search ? combineOwed(rows.map((r) => r.owed)) : (index?.total ?? [])),
    [search, rows, index]
  );

  // Keep the open client's row in view when it changes from outside the list
  // (a deep link, Back) and when the rows first arrive. A background refresh
  // doesn't move the list.
  const hasItems = items.length > 0;
  useEffect(() => {
    if (hasItems) clientRowLink(tableRef.current, openClientId)?.scrollIntoView?.({ block: 'nearest' });
  }, [openClientId, hasItems]);

  /** Open a client from the keyboard and keep focus on its row, so the next arrow walks on from there. */
  const walkTo = (clientId: string) => {
    onWalk?.(clientId);
    clientRowLink(tableRef.current, clientId)?.focus();
  };

  // The walk (MUT-84): on a client row ↑/↓ open the previous/next client,
  // skipping the muted rows and stopping at either end; Enter on the open
  // client, or the arrow toward the profile, moves focus into it.
  const handleRowKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!onWalk || event.defaultPrevented || hasModifier(event)) return;
    const rowId = (event.target as HTMLElement).closest<HTMLElement>('tr[data-client-id]')?.dataset.clientId;
    if (!rowId) return;
    const action = listKeyAction(event.key, direction);
    if (action === 'previous' || action === 'next') {
      event.preventDefault();
      const nextId = adjacentClientId(items, rowId, action === 'next' ? 1 : -1);
      if (nextId) walkTo(nextId);
    } else if (action === 'toProfile' && onEnterProfile && (event.key !== 'Enter' || rowId === openClientId)) {
      event.preventDefault();
      onEnterProfile();
    }
  };

  // ↓ in the search box moves to the open client's row, or opens the first client
  const handleSearchKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!onWalk || event.key !== 'ArrowDown' || hasModifier(event)) return;
    const openRow = clientRowLink(tableRef.current, openClientId);
    const targetId = openRow ? openClientId : firstClientId(items);
    if (!targetId) return;
    event.preventDefault();
    if (openRow) openRow.focus();
    else walkTo(targetId);
  };

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
      data-client-id={row.id}
      className={cn('clickable', row.isSettled && 'client-index-settled-row', row.id === openClientId && 'client-index-row-open')}
      onClick={() => navigate({ to: '/clients/$clientId', params: { clientId: row.id }, search: true })}
    >
      <td>
        <Link
          to="/clients/$clientId"
          params={{ clientId: row.id }}
          search
          className="client-index-name"
          aria-current={row.id === openClientId ? 'page' : undefined}
          onClick={(e) => e.stopPropagation()}
        >
          {row.name}
        </Link>
        {isAll ? (
          <BusinessTags profileIds={row.profileIds} profilesById={profilesById} className="client-index-businesses" />
        ) : crossProfileStats?.has(row.id) && (
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
      <td className="text-muted">{row.lastActivityAt ? formatRelativeDate(row.lastActivityAt, t, locale) : '—'}</td>
    </tr>
  );

  /**
   * A muted row: owed now of no listed client, opening /income on those
   * entries. Under All businesses the row covers one business, and Income
   * opens in it, keeping All businesses on for Home and Clients (O4).
   */
  const renderBucketRow = (bucket: OwedBucketRow) => {
    const entries = owedEntriesSearch(BUCKET_SCOPE[bucket.kind]);
    const workInBucketBusiness = () => {
      if (bucket.profileId) setWorkingProfile(bucket.profileId);
    };
    return (
      <tr
        key={`${bucket.kind}:${bucket.profileId ?? ''}`}
        className="clickable client-index-bucket-row"
        onClick={() => {
          workInBucketBusiness();
          navigate({ to: '/income', search: entries });
        }}
      >
        <td>
          <Link
            to="/income"
            search={entries}
            className="client-index-name"
            onClick={(e) => {
              e.stopPropagation();
              workInBucketBusiness();
            }}
          >
            {tp(`clients.index.bucket.${bucket.kind}`, bucket.count)}
            {bucket.profileId && (
              <BusinessTags profileIds={[bucket.profileId]} profilesById={profilesById} className="client-index-businesses" />
            )}
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
    <div className="page-content">
      <div className="filters-row" onKeyDown={handleSearchKeyDown}>
        <SearchInput value={search} onChange={setSearch} placeholder={t('clients.searchPlaceholder')} />
      </div>

      {isPending ? (
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
          <div ref={tableRef} className="data-table clients-index-table" onKeyDown={handleRowKeyDown}>
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
  );
}
