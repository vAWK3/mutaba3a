import { useCallback, useMemo, useState } from 'react';
import { SegmentedTabs } from '../../../components/filters/SegmentedTabs';
import { useLanguage } from '../../../lib/i18n/core';
import type { Allocation, Currency, Customer, Payment, Project } from '../../api/client';
import { ClientFilter, DateFilter, FilterBar } from '../../components/FilterControls';
import { HostedTable, type Column } from '../../components/HostedTable';
import { Empty, QueryView } from '../../components/QueryView';
import { ReadOnlyNotice } from '../../components/ReadOnlyNotice';
import { isNarrowed, type PaymentFilters, type PaymentStatusFilter } from '../../data/filters';
import { useCustomerDirectory, usePayments, useProjectDirectory } from '../../data/queries';
import { DecimalAmount } from '../../format/DecimalAmount';
import { formatDay } from '../../format/dates';
import { useProfile } from '../../session/me';
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
}

function shape(items: Payment[], customers: Map<string, Customer>, language: 'en' | 'ar', methodLabel: (method: string) => string): PaymentRow[] {
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
  }));
}

interface PaymentsListProps {
  filters: PaymentFilters;
  setFilters: (next: PaymentFilters) => void;
  fixedCustomerId?: string;
}

export function PaymentsList({ filters, setFilters, fixedCustomerId }: PaymentsListProps) {
  const profile = useProfile();
  const { t, language } = useLanguage();
  const list = usePayments(profile.id, fixedCustomerId ? { ...filters, customerId: fixedCustomerId } : filters);
  const customers = useCustomerDirectory(profile.id);
  const projects = useProjectDirectory(profile.id);
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const rows = useMemo(
    () => (list.data && customers.data ? shape(list.data, customers.data, language, (m) => t(`hosted.payments.method.${m}`)) : undefined),
    [list.data, customers.data, language, t],
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
              className="hp-expand"
              aria-expanded={open.has(r.id)}
              aria-label={t(open.has(r.id) ? 'hosted.payments.hideAllocations' : 'hosted.payments.showAllocations')}
              onClick={() => toggle(r.id)}
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
            <Empty title={t('hosted.payments.empty.title')} body={t('hosted.payments.empty.body')} />
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

export function PaymentsPage(props: Omit<PaymentsListProps, 'fixedCustomerId'>) {
  const { t } = useLanguage();
  return (
    <>
      <PageHeader title={t('hosted.payments.title')} />
      <PaymentsList {...props} />
    </>
  );
}
