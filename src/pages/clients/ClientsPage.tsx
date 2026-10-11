import { useState, useMemo, useCallback } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { TopBar } from '../../components/layout';
import { SearchInput } from '../../components/filters';
import { EmptyState, SortableHeader } from '../../components/ui';
import { OrphanedRecordsModal } from '../../components/modals';
import { OwedNowSummary } from '../../components/clients/OwedNowSummary';
import {
  toClientIndexRow,
  compareClientRows,
  CLIENT_SORT_FIELDS,
  type ClientIndexRow,
  type ClientSortField,
  type RatesToIls,
} from '../../components/clients/clientIndexRows';
import { useClientSummaries, useClients, useBusinessProfiles } from '../../hooks/useQueries';
import { useFxRate } from '../../hooks/useFxRate';
import { getCrossProfileClientStats } from '../../db/crossProfileStats';
import { combineOwed } from '../../db/aggregations';
import { useSortState, type SortDir } from '../../hooks/useSortState';
import { useProfileFilter } from '../../hooks/useActiveProfile';
import { useDrawerStore } from '../../lib/stores';
import { formatAmount, formatDate, formatRelativeDate } from '../../lib/utils';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import type { Currency } from '../../types';

/** Direction a column sorts in when first clicked: names A–Z, money and dates biggest/newest first. */
const FIRST_CLICK_DIR: Record<ClientSortField, SortDir> = {
  name: 'asc',
  owed: 'desc',
  overdue: 'desc',
  lastPayment: 'desc',
  activity: 'desc',
};

/**
 * The clients index (MUT-7): who owes me, and who is late. Owed now and
 * overdue are per currency and never combined; owed now is ordered by today's
 * exchange rate without showing anything converted (ADR-035).
 */
export function ClientsPage() {
  const { openClientDrawer } = useDrawerStore();
  const navigate = useNavigate();
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const [search, setSearch] = useState('');
  const [showOrphanedModal, setShowOrphanedModal] = useState(false);

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

  // All clients, to spot orphaned records and to count the total behind a search
  const { data: allClients = [] } = useClients(undefined);
  const hasOrphanedClients = allClients.some((c) => !c.profileId && !c.archivedAt);
  if (hasOrphanedClients && !showOrphanedModal) {
    setShowOrphanedModal(true);
  }

  const { data: summaries = [], isLoading } = useClientSummaries(profileId, undefined, search);

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
    () => summaries.map((s) => toClientIndexRow(s, rates)).sort(compareClientRows(sortField, sortDir)),
    [summaries, rates, sortField, sortDir]
  );
  const totalOwed = useMemo(() => combineOwed(summaries.map((s) => s.owed)), [summaries]);

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
        {row.overdue.length === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <div className="client-index-lines text-danger">
            {row.overdue.map((o) => amount(o.amountMinor, o.currency, o.currency))}
            {row.oldestOverdueDays !== undefined && (
              <span className="client-index-subline">
                {t('clients.index.oldestOverdue', { days: row.oldestOverdueDays })}
              </span>
            )}
          </div>
        )}
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

  const isSearchMiss = Boolean(search) && allClients.length > 0;

  return (
    <>
      <OrphanedRecordsModal isOpen={showOrphanedModal} onClose={() => setShowOrphanedModal(false)} type="clients" />
      <TopBar title={t('clients.title')} />
      <div className="page-content">
        <div className="filters-row">
          <SearchInput value={search} onChange={setSearch} placeholder={t('clients.searchPlaceholder')} />
        </div>

        {isLoading ? (
          <div className="loading">
            <div className="spinner" />
          </div>
        ) : rows.length === 0 ? (
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
                <tbody>{rows.map(renderRow)}</tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
