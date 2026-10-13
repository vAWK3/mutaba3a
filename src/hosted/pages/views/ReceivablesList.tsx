import { useMemo, type ReactNode } from 'react';
import { Button } from '../../../components/ui/Button';
import { SegmentedTabs } from '../../../components/filters/SegmentedTabs';
import { useLanguage } from '../../../lib/i18n/core';
import type { Currency, Customer, Project, Receivable } from '../../api/client';
import { ClientFilter, CurrencyFilter, DateFilter, FilterBar, MatterFilter } from '../../components/FilterControls';
import { HostedTable, type Column } from '../../components/HostedTable';
import { Empty, QueryView } from '../../components/QueryView';
import { ReadOnlyNotice } from '../../components/ReadOnlyNotice';
import { DEFAULT_RECEIVABLE_STATUS, isNarrowed, splitIncomeDrawer, type ReceivableFilters, type ReceivablesPageSearch, type ReceivableStatusFilter } from '../../data/filters';
import { incomeAffordancesFor, isSettleable } from '../../data/incomeAffordances';
import { IncomeDrawerHost, SETTLE_BUTTON_ATTR } from '../../components/IncomeDrawerHost';
import { useCustomerDirectory, useProjectDirectory, useReceivables } from '../../data/queries';
import { DecimalAmount, formatDecimal } from '../../format/DecimalAmount';
import { formatDay } from '../../format/dates';
import { useProfile } from '../../session/me';
import { NoMatch, PageHeader, ShowMore, StatusBadge } from './shared';

/**
 * Receivables (hosted-portal.md §7.3): what each client owes. Open by default.
 * Also the client-detail Receivables tab, with the client fixed. On the
 * signed-in user's personal profile (MUT-133) an open Owed row offers Record
 * payment in a sticky end column; the page that mounts the list owns the
 * drawer, so the list only reports which row was picked (eng review R1).
 */

interface ReceivableRow {
  id: string;
  client: string;
  matter: string;
  due: string;
  currency: Currency;
  gross: string;
  paid: string;
  outstanding: string;
  status: string;
  settleable: boolean;
}

function shape(items: Receivable[], customers: Map<string, Customer>, projects: Map<string, Project>, language: 'en' | 'ar'): ReceivableRow[] {
  return items.map((r) => ({
    id: r.id,
    client: customers.get(r.customerId)?.name ?? '—',
    matter: (r.projectId ? projects.get(r.projectId)?.name : undefined) ?? '—',
    due: formatDay(r.dueDate, language),
    currency: r.currency,
    gross: r.gross,
    paid: r.paid,
    outstanding: r.outstanding,
    status: r.status,
    settleable: isSettleable(r),
  }));
}

interface ReceivablesListProps {
  filters: ReceivableFilters;
  setFilters: (next: ReceivableFilters) => void;
  fixedCustomerId?: string;
  /** Present only where the gate offers settling: adds the Record payment column. */
  onRecordPayment?: (receivableId: string) => void;
  /** The page's Add income button, repeated as the empty state's action. */
  addAction?: ReactNode;
}

export function ReceivablesList({ filters, setFilters, fixedCustomerId, onRecordPayment, addAction }: ReceivablesListProps) {
  const profile = useProfile();
  const { t, language } = useLanguage();
  const effective = fixedCustomerId ? { ...filters, customerId: fixedCustomerId } : filters;
  const list = useReceivables(profile.id, effective);
  const customers = useCustomerDirectory(profile.id);
  const projects = useProjectDirectory(profile.id);

  const rows = useMemo(
    () => (list.data && customers.data && projects.data ? shape(list.data, customers.data, projects.data, language) : undefined),
    [list.data, customers.data, projects.data, language],
  );

  const columns = useMemo<Column<ReceivableRow>[]>(
    () => [
      ...(fixedCustomerId ? [] : [{ key: 'client', header: t('hosted.receivables.columns.client'), cell: (r: ReceivableRow) => r.client }]),
      { key: 'matter', header: t('hosted.receivables.columns.matter'), cell: (r) => r.matter },
      { key: 'due', header: t('hosted.receivables.columns.due'), cell: (r) => r.due },
      { key: 'gross', header: t('hosted.receivables.columns.gross'), numeric: true, cell: (r) => <DecimalAmount value={r.gross} currency={r.currency} /> },
      { key: 'paid', header: t('hosted.receivables.columns.paid'), numeric: true, cell: (r) => <DecimalAmount value={r.paid} currency={r.currency} /> },
      { key: 'outstanding', header: t('hosted.receivables.columns.outstanding'), numeric: true, cell: (r) => <DecimalAmount value={r.outstanding} currency={r.currency} /> },
      { key: 'status', header: t('hosted.receivables.columns.status'), cell: (r) => <StatusBadge family="item" status={r.status} /> },
      ...(onRecordPayment
        ? [
            {
              key: 'actions',
              header: t('hosted.settle.actions'),
              stickyEnd: true,
              cell: (r: ReceivableRow) =>
                r.settleable ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="hp-row-action"
                    {...{ [SETTLE_BUTTON_ATTR]: r.id }}
                    aria-label={t('hosted.settle.rowLabel', { amount: formatDecimal(r.outstanding, r.currency, language) })}
                    onClick={() => onRecordPayment(r.id)}
                  >
                    {t('hosted.settle.record')}
                  </Button>
                ) : null,
            },
          ]
        : []),
    ],
    [t, fixedCustomerId, onRecordPayment, language],
  );

  const status = filters.status ?? DEFAULT_RECEIVABLE_STATUS;
  const patch = (change: Partial<ReceivableFilters>) => setFilters({ ...filters, ...change });
  const matterOptions = useMemo(() => {
    const scope = fixedCustomerId ?? filters.customerId;
    if (!projects.data || !scope) return projects.data;
    return new Map([...projects.data].filter(([, p]) => p.customerId === scope));
  }, [projects.data, fixedCustomerId, filters.customerId]);

  return (
    <>
      <ReadOnlyNotice profile={profile} />
      <FilterBar>
        <SegmentedTabs<ReceivableStatusFilter>
          options={[
            { value: 'OPEN', label: t('hosted.status.open.OPEN') },
            { value: 'SETTLED', label: t('hosted.status.open.SETTLED') },
            { value: 'ALL', label: t('hosted.filters.all') },
          ]}
          value={status}
          onChange={(next) => patch({ status: next === DEFAULT_RECEIVABLE_STATUS ? undefined : next })}
        />
        {!fixedCustomerId && <ClientFilter value={filters.customerId} options={customers.data} onChange={(customerId) => patch({ customerId, projectId: undefined })} />}
        <MatterFilter value={filters.projectId} options={matterOptions} onChange={(projectId) => patch({ projectId })} />
        <CurrencyFilter value={filters.currency} onChange={(currency) => patch({ currency })} />
        <DateFilter label={t('hosted.receivables.dueFrom')} value={filters.dueFrom} onChange={(dueFrom) => patch({ dueFrom })} />
        <DateFilter label={t('hosted.receivables.dueTo')} value={filters.dueTo} onChange={(dueTo) => patch({ dueTo })} />
      </FilterBar>
      <QueryView
        queries={[list, customers, projects]}
        data={rows}
        isEmpty={(r) => r.length === 0}
        empty={
          isNarrowed(filters) ? (
            <NoMatch onClear={() => setFilters({})} />
          ) : (
            <Empty title={t('hosted.receivables.empty.title')} body={t('hosted.receivables.empty.body')} action={addAction} />
          )
        }
      >
        {(r) => (
          <>
            <HostedTable label={t('hosted.receivables.title')} columns={columns} rows={r} rowKey={(row) => row.id} />
            <ShowMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
          </>
        )}
      </QueryView>
    </>
  );
}

export function ReceivablesPage({ search, setSearch }: { search: ReceivablesPageSearch; setSearch: (next: ReceivablesPageSearch) => void }) {
  const profile = useProfile();
  const { t } = useLanguage();
  const { filters, drawer } = splitIncomeDrawer(search);
  const { kinds, canSettle } = incomeAffordancesFor(profile);
  const addButton =
    kinds.length > 0 ? (
      <Button variant="primary" size="sm" onClick={() => setSearch({ ...filters, newIncome: kinds.includes('owed') ? 'owed' : kinds[0] })}>
        {t('hosted.income.add')}
      </Button>
    ) : undefined;
  return (
    <>
      <PageHeader title={t('hosted.receivables.title')}>{addButton}</PageHeader>
      <ReceivablesList
        filters={filters}
        setFilters={setSearch}
        addAction={addButton}
        onRecordPayment={canSettle ? (receivableId) => setSearch({ ...filters, settle: receivableId }) : undefined}
      />
      <IncomeDrawerHost profile={profile} drawer={drawer} onClose={() => setSearch(filters)} />
    </>
  );
}
