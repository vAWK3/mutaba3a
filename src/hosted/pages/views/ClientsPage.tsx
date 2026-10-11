import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { SearchInput } from '../../../components/filters/SearchInput';
import { useLanguage } from '../../../lib/i18n/core';
import type { Currency, Customer, OrganizationSummary } from '../../api/client';
import { HostedTable, type Column } from '../../components/HostedTable';
import { Empty, QueryView } from '../../components/QueryView';
import type { ClientsFilters } from '../../data/filters';
import { useCustomerDirectory, useOrganizationSummary } from '../../data/queries';
import { DecimalAmount, isZeroDecimal } from '../../format/DecimalAmount';
import { formatDay } from '../../format/dates';
import { useProfile } from '../../session/me';
import { PageHeader, ShowMore, StatusBadge, laterDay } from './shared';

/**
 * Clients (hosted-portal.md §7.3): every client of the profile with what it owes
 * per currency. The directory is loaded whole (cursor pages of 200) so the name
 * search is instant; rows are revealed 50 at a time.
 */

interface ClientRow {
  id: string;
  name: string;
  amounts: { currency: Currency; outstanding: string; overdue: string }[];
  lastPaymentOn: string | null;
  status: string | null;
}

const CHUNK = 50;
const STATUS_WEIGHT: Record<string, number> = { OVERDUE: 3, OUTSTANDING: 2, UP_TO_DATE: 1, SETTLED: 0 };

function shape(customers: Map<string, Customer>, summary: OrganizationSummary, locale: string): ClientRow[] {
  const rows = new Map<string, ClientRow>();
  for (const customer of customers.values()) {
    rows.set(customer.id, { id: customer.id, name: customer.name, amounts: [], lastPaymentOn: null, status: null });
  }
  for (const block of summary.currencies) {
    for (const line of block.customers) {
      const row = rows.get(line.customerId);
      if (!row) continue;
      if (!isZeroDecimal(line.outstanding) || !isZeroDecimal(line.overdue)) {
        row.amounts.push({ currency: block.currency, outstanding: line.outstanding, overdue: line.overdue });
      }
      row.lastPaymentOn = laterDay(row.lastPaymentOn, line.lastPaymentOn);
      if (row.status === null || (STATUS_WEIGHT[line.status] ?? 0) > (STATUS_WEIGHT[row.status] ?? 0)) row.status = line.status;
    }
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, locale));
}

export function ClientsPage({ filters, setFilters }: { filters: ClientsFilters; setFilters: (next: ClientsFilters) => void }) {
  const profile = useProfile();
  const { t } = useLanguage();
  const directory = useCustomerDirectory(profile.id);
  const summary = useOrganizationSummary(profile.id);
  const data = directory.data && summary.data ? { customers: directory.data, summary: summary.data } : undefined;

  return (
    <>
      <PageHeader title={t('hosted.clients.title')}>
        <div className="hp-search">
          <SearchInput value={filters.q ?? ''} onChange={(q) => setFilters({ ...filters, q: q || undefined })} placeholder={t('hosted.clients.search')} />
        </div>
      </PageHeader>
      <QueryView
        queries={[directory, summary]}
        data={data}
        isEmpty={({ customers }) => customers.size === 0}
        empty={<Empty title={t('hosted.clients.empty.title')} body={t('hosted.clients.empty.body')} />}
      >
        {({ customers, summary: s }) => <ClientsTable customers={customers} summary={s} query={filters.q} />}
      </QueryView>
    </>
  );
}

function ClientsTable({ customers, summary, query }: { customers: Map<string, Customer>; summary: OrganizationSummary; query?: string }) {
  const profile = useProfile();
  const { t, language } = useLanguage();
  const [shown, setShown] = useState(CHUNK);

  const all = useMemo(() => shape(customers, summary, language), [customers, summary, language]);
  const rows = useMemo(() => {
    const needle = query?.trim().toLocaleLowerCase(language);
    return needle ? all.filter((row) => row.name.toLocaleLowerCase(language).includes(needle)) : all;
  }, [all, query, language]);

  const columns = useMemo<Column<ClientRow>[]>(
    () => [
      { key: 'name', header: t('hosted.clients.columns.name'), cell: (row) => <Link to={`/p/${profile.id}/clients/${row.id}`}>{row.name}</Link> },
      {
        key: 'outstanding',
        header: t('hosted.clients.columns.outstanding'),
        numeric: true,
        cell: (row) => (row.amounts.length ? row.amounts.map((a) => <div key={a.currency}><DecimalAmount value={a.outstanding} currency={a.currency} /></div>) : '—'),
      },
      {
        key: 'overdue',
        header: t('hosted.clients.columns.overdue'),
        numeric: true,
        cell: (row) => (row.amounts.length ? row.amounts.map((a) => <div key={a.currency}><DecimalAmount value={a.overdue} currency={a.currency} /></div>) : '—'),
      },
      { key: 'lastPayment', header: t('hosted.clients.columns.lastPayment'), cell: (row) => formatDay(row.lastPaymentOn, language) },
      { key: 'status', header: t('hosted.clients.columns.status'), cell: (row) => (row.status ? <StatusBadge family="customer" status={row.status} /> : '—') },
    ],
    [t, language, profile.id],
  );

  if (rows.length === 0) return <Empty title={t('hosted.clients.noMatch', { query: query ?? '' })} />;
  return (
    <>
      <HostedTable label={t('hosted.clients.title')} columns={columns} rows={rows.slice(0, shown)} rowKey={(row) => row.id} />
      <ShowMore hasMore={rows.length > shown} loading={false} onMore={() => setShown((n) => n + CHUNK)} />
    </>
  );
}
