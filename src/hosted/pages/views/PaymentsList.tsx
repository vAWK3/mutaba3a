import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Button } from '../../../components/ui/Button';
import { SegmentedTabs } from '../../../components/filters/SegmentedTabs';
import { useLanguage } from '../../../lib/i18n/core';
import type { Allocation, Currency, Customer, Payment, Project } from '../../api/client';
import { ClientFilter, DateFilter, FilterBar } from '../../components/FilterControls';
import { HostedTable, type Column } from '../../components/HostedTable';
import { Empty, QueryView } from '../../components/QueryView';
import { ReadOnlyNotice } from '../../components/ReadOnlyNotice';
import { isNarrowed, splitIncomeDrawer, type PaymentFilters, type PaymentsPageSearch, type PaymentStatusFilter } from '../../data/filters';
import { canOpenPayment, incomeAffordancesFor, redateAffordancesFor } from '../../data/incomeAffordances';
import { ADD_BUTTON_ATTR, IncomeDrawerHost } from '../../components/IncomeDrawerHost';
import { useCustomerDirectory, usePayments, useProjectDirectory } from '../../data/queries';
import { DecimalAmount } from '../../format/DecimalAmount';
import { formatDay } from '../../format/dates';
import { useMe, useProfile, useWriteGate } from '../../session/me';
import { DeeperLinks } from '../../components/DeeperLinks';
import { NoMatch, PageHeader, ShowMore, StatusBadge } from './shared';

/**
 * Payments (hosted-portal.md §7.3): what was received, read-only; a row opens
 * to show which receivables it paid. The API has no currency filter, so each
 * payment shows its own currency.
 */

interface PaymentRow {
  id: string;
  number: string;
  client: string;
  received: string;
  method: string;
  currency: Currency;
  amount: string;
  unallocated: string;
  status: string;
  allocations: Allocation[];
  /** MUT-224: the user's own posted capture on a profile they own: its date can be changed. */
  redatable: boolean;
}

function shape(items: Payment[], customers: Map<string, Customer>, language: 'en' | 'ar', methodLabel: (method: string) => string, redatable: (p: Payment) => boolean): PaymentRow[] {
  return items.map((p) => ({
    id: p.id,
    number: p.number,
    client: (p.customerId ? customers.get(p.customerId)?.name : undefined) ?? '—',
    received: formatDay(p.receivedOn, language),
    method: methodLabel(p.method),
    currency: p.currency,
    amount: p.amount,
    unallocated: p.unallocated,
    status: p.status,
    allocations: p.allocations,
    redatable: redatable(p),
  }));
}

interface PaymentsListProps {
  filters: PaymentFilters;
  setFilters: (next: PaymentFilters) => void;
  fixedCustomerId?: string;
  /** The page's Add income button, repeated as the empty state's action (MUT-133). */
  addAction?: ReactNode;
  /** MUT-224: present where the gate offers re-dating; the user's own posted capture then opens `?payment=`. */
  onRedate?: (paymentId: string) => void;
}

export function PaymentsList({ filters, setFilters, fixedCustomerId, addAction, onRedate }: PaymentsListProps) {
  const profile = useProfile();
  const userId = useMe().user.id;
  const { writable } = useWriteGate();
  const { t, language } = useLanguage();
  const list = usePayments(profile.id, fixedCustomerId ? { ...filters, customerId: fixedCustomerId } : filters);
  const customers = useCustomerDirectory(profile.id);
  const projects = useProjectDirectory(profile.id);
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const rows = useMemo(
    () =>
      list.data && customers.data
        ? shape(list.data, customers.data, language, (m) => t(`hosted.payments.method.${m}`), (p) => canOpenPayment(profile, p, userId, writable))
        : undefined,
    [list.data, customers.data, language, t, profile, userId, writable],
  );

  const toggle = useCallback(
    (id: string) =>
      setOpen((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );

  const columns = useMemo<Column<PaymentRow>[]>(
    () => [
      {
        key: 'number',
        header: t('hosted.payments.columns.number'),
        cell: (r) => (
          <span className="hp-expander">
            <button
              type="button"
              className="hp-expand press"
              aria-expanded={open.has(r.id)}
              aria-label={t(open.has(r.id) ? 'hosted.payments.hideAllocations' : 'hosted.payments.showAllocations')}
              onClick={(event) => {
                // MUT-224: the row opens the re-date drawer; the expander only shows where the money went.
                event.stopPropagation();
                toggle(r.id);
              }}
            >
              <span aria-hidden="true">{open.has(r.id) ? '▾' : '▸'}</span>
            </button>
            <bdi dir="ltr">{r.number}</bdi>
          </span>
        ),
      },
      ...(fixedCustomerId ? [] : [{ key: 'client', header: t('hosted.payments.columns.client'), cell: (r: PaymentRow) => r.client }]),
      { key: 'received', header: t('hosted.payments.columns.received'), cell: (r) => r.received },
      { key: 'method', header: t('hosted.payments.columns.method'), cell: (r) => r.method },
      { key: 'amount', header: t('hosted.payments.columns.amount'), numeric: true, cell: (r) => <DecimalAmount value={r.amount} currency={r.currency} /> },
      { key: 'unallocated', header: t('hosted.payments.columns.unallocated'), numeric: true, cell: (r) => <DecimalAmount value={r.unallocated} currency={r.currency} /> },
      { key: 'status', header: t('hosted.payments.columns.status'), cell: (r) => <StatusBadge family="payment" status={r.status} /> },
    ],
    [t, fixedCustomerId, open, toggle],
  );

  const status = filters.status ?? 'ALL';
  const patch = (change: Partial<PaymentFilters>) => setFilters({ ...filters, ...change });

  return (
    <>
      <ReadOnlyNotice profile={profile} />
      <FilterBar>
        <SegmentedTabs<PaymentStatusFilter>
          options={[
            { value: 'ALL', label: t('hosted.filters.all') },
            { value: 'POSTED', label: t('hosted.status.payment.POSTED') },
            { value: 'REVERSED', label: t('hosted.status.payment.REVERSED') },
          ]}
          value={status}
          onChange={(next) => patch({ status: next === 'ALL' ? undefined : next })}
        />
        {!fixedCustomerId && <ClientFilter value={filters.customerId} options={customers.data} onChange={(customerId) => patch({ customerId })} />}
        <DateFilter label={t('hosted.payments.receivedFrom')} value={filters.receivedFrom} onChange={(receivedFrom) => patch({ receivedFrom })} />
        <DateFilter label={t('hosted.payments.receivedTo')} value={filters.receivedTo} onChange={(receivedTo) => patch({ receivedTo })} />
      </FilterBar>
      <QueryView
        queries={[list, customers, projects]}
        data={rows && projects.data ? { rows, projects: projects.data } : undefined}
        isEmpty={({ rows: r }) => r.length === 0}
        empty={
          isNarrowed(filters) ? (
            <NoMatch onClear={() => setFilters({})} />
          ) : (
            <Empty title={t('hosted.payments.empty.title')} body={t('hosted.payments.empty.body')} action={addAction} />
          )
        }
      >
        {({ rows: r, projects: matters }) => (
          <>
            <HostedTable
              label={t('hosted.payments.title')}
              columns={columns}
              rows={r}
              rowKey={(row) => row.id}
              detail={(row) => (open.has(row.id) ? <Allocations row={row} matters={matters} /> : null)}
              onRowClick={onRedate ? (row) => onRedate(row.id) : undefined}
              // The first cell holds the expander, and a button can't nest a button (eng review R5).
              linkColumn="received"
              canOpen={(row) => row.redatable}
            />
            <ShowMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
          </>
        )}
      </QueryView>
    </>
  );
}

function Allocations({ row, matters }: { row: PaymentRow; matters: Map<string, Project> }) {
  const { t } = useLanguage();
  if (row.allocations.length === 0) return <p className="hp-muted">{t('hosted.payments.allocations.none')}</p>;
  return (
    <table className="table hp-subtable" aria-label={t('hosted.payments.allocations.title')}>
      <thead>
        <tr>
          <th scope="col">{t('hosted.payments.allocations.matter')}</th>
          <th scope="col" className="hp-num">
            {t('hosted.payments.allocations.amount')}
          </th>
          <th scope="col" className="hp-num">
            {t('hosted.payments.allocations.remaining')}
          </th>
        </tr>
      </thead>
      <tbody>
        {row.allocations.map((a) => (
          <tr key={a.id}>
            <td>{matters.get(a.projectId)?.name ?? '—'}</td>
            <td className="hp-num">
              <DecimalAmount value={a.amount} currency={row.currency} />
            </td>
            <td className="hp-num">
              <DecimalAmount value={a.receivableOutstanding} currency={row.currency} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PaymentsPage({ search, setSearch }: { search: PaymentsPageSearch; setSearch: (next: PaymentsPageSearch) => void }) {
  const profile = useProfile();
  const { t } = useLanguage();
  const { filters, drawer } = splitIncomeDrawer(search);
  // MUT-361: nothing to add or re-date on a read-only profile.
  const { writable } = useWriteGate();
  const { kinds } = incomeAffordancesFor(profile, writable);
  const redate = redateAffordancesFor(profile, writable);
  // The header copy carries ADD_BUTTON_ATTR (focus returns there after a save); the empty state reuses it without.
  const openAdd = () => setSearch({ ...filters, newIncome: kinds.includes('received') ? 'received' : kinds[0] });
  const addButton = (header: boolean) =>
    kinds.length > 0 ? (
      <Button variant="primary" size="sm" onClick={openAdd} {...(header ? { [ADD_BUTTON_ATTR]: '' } : {})}>
        {t('hosted.income.add')}
      </Button>
    ) : undefined;
  return (
    <>
      <PageHeader title={t('hosted.destinations.paid')}>{addButton(true)}</PageHeader>
      <PaymentsList
        filters={filters}
        setFilters={setSearch}
        addAction={addButton(false)}
        onRedate={redate.payments ? (paymentId) => setSearch({ ...filters, payment: paymentId }) : undefined}
      />
      <DeeperLinks destination="paid" links={[{ key: 'conversions', to: `/p/${profile.id}/conversions` }]} />
      <IncomeDrawerHost profile={profile} drawer={drawer} onClose={() => setSearch(filters)} onOpen={(next) => setSearch({ ...filters, ...next })} />
    </>
  );
}
