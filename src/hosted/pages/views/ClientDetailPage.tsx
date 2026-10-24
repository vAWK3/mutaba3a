import { useMemo, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { SegmentedTabs } from '../../../components/filters/SegmentedTabs';
import { Button } from '../../../components/ui/Button';
import { useLanguage } from '../../../lib/i18n/core';
import type { CustomerSummary, Project, ProjectSummary } from '../../api/client';
import { HostedTable, type Column } from '../../components/HostedTable';
import { Empty, QueryView, Skeleton } from '../../components/QueryView';
import { ReadOnlyNotice } from '../../components/ReadOnlyNotice';
import { splitIncomeDrawer, type ClientDetailSearch, type ClientTab } from '../../data/filters';
import { incomeAffordancesFor, redateAffordancesFor } from '../../data/incomeAffordances';
import { ADD_BUTTON_ATTR, IncomeDrawerHost } from '../../components/IncomeDrawerHost';
import { useCustomer, useCustomerSummary, useProjectDirectory } from '../../data/queries';
import { DecimalAmount } from '../../format/DecimalAmount';
import { formatDay } from '../../format/dates';
import { useProfile, useWriteGate } from '../../session/me';
import { DocumentsList } from './DocumentsList';
import { PaymentsList } from './PaymentsList';
import { ReceivablesList } from './ReceivablesList';
import { StatusBadge } from './shared';

/**
 * Client detail (hosted-portal.md §7.3): the per-currency summary and its
 * matters, then the client's receivables, payments and documents as the same
 * read-only lists, fixed to this client. The tab and the tab's filters live in
 * one search object.
 */

interface ClientDetailPageProps {
  customerId: string;
  search: ClientDetailSearch;
  setSearch: (next: ClientDetailSearch) => void;
}

export function ClientDetailPage({ customerId, search, setSearch }: ClientDetailPageProps) {
  const profile = useProfile();
  const { t } = useLanguage();
  const customer = useCustomer(profile.id, customerId);
  const tab: ClientTab = search.tab ?? 'summary';
  // MUT-133: drawer state lives beside the tab's filters, never in them (eng review R1).
  const { filters: rest, drawer } = splitIncomeDrawer(search);
  // MUT-361: nothing to add, settle or re-date on a read-only profile.
  const { writable } = useWriteGate();
  const { kinds, canSettle } = incomeAffordancesFor(profile, writable);
  const redate = redateAffordancesFor(profile, writable);
  // The header copy carries ADD_BUTTON_ATTR (focus returns there after a save); the empty state reuses it without.
  const openAdd = () => setSearch({ ...rest, newIncome: kinds.includes('owed') ? 'owed' : kinds[0] });
  const addButton = (header: boolean) =>
    kinds.length > 0 ? (
      <Button variant="primary" size="sm" onClick={openAdd} {...(header ? { [ADD_BUTTON_ATTR]: '' } : {})}>
        {t('hosted.income.add')}
      </Button>
    ) : undefined;

  const notFound = (
    <Empty
      title={t('hosted.client.notFound.title')}
      body={t('hosted.client.notFound.body')}
      action={<Link to={`/p/${profile.id}/clients`}>{t('hosted.client.back')}</Link>}
    />
  );

  return (
    <QueryView queries={[customer]} data={customer.data} loading={<Skeleton strip />} notFound={notFound}>
      {(client) => (
        <>
          <header className="hp-page-header">
            <Link to={`/p/${profile.id}/clients`} className="hp-back">
              {t('hosted.client.back')}
            </Link>
            <h1>{client.name}</h1>
            {addButton(true)}
          </header>
          <SegmentedTabs<ClientTab>
            className="hp-tabs"
            options={(['summary', 'receivables', 'payments', 'documents'] as const).map((value) => ({ value, label: t(`hosted.client.tabs.${value}`) }))}
            value={tab}
            onChange={(next) => setSearch({ tab: next === 'summary' ? undefined : next })}
          />
          {tab === 'summary' && <ClientSummary customerId={customerId} notFound={notFound} />}
          {tab === 'receivables' && (
            <ReceivablesList
              fixedCustomerId={customerId}
              filters={{ projectId: search.projectId, currency: search.currency, status: search.status, dueFrom: search.dueFrom, dueTo: search.dueTo }}
              setFilters={(f) => setSearch({ tab, projectId: f.projectId, currency: f.currency, status: f.status, dueFrom: f.dueFrom, dueTo: f.dueTo })}
              addAction={addButton(false)}
              onRecordPayment={canSettle ? (receivableId) => setSearch({ ...rest, settle: receivableId }) : undefined}
              onRedate={redate.owed ? (receivableId) => setSearch({ ...rest, income: receivableId }) : undefined}
            />
          )}
          {tab === 'payments' && (
            <PaymentsList
              fixedCustomerId={customerId}
              filters={{ status: search.paymentStatus, receivedFrom: search.receivedFrom, receivedTo: search.receivedTo }}
              setFilters={(f) => setSearch({ tab, paymentStatus: f.status, receivedFrom: f.receivedFrom, receivedTo: f.receivedTo })}
              addAction={addButton(false)}
              onRedate={redate.payments ? (paymentId) => setSearch({ ...rest, payment: paymentId }) : undefined}
            />
          )}
          {tab === 'documents' && (
            <DocumentsList fixedCustomerId={customerId} filters={{ kind: search.kind }} setFilters={(f) => setSearch({ tab, kind: f.kind })} />
          )}
          <IncomeDrawerHost
            profile={profile}
            drawer={drawer}
            defaultCustomerId={customerId}
            onClose={() => setSearch(rest)}
            onOpen={(next) => setSearch({ ...rest, ...next })}
            // Already on this client: "See this client's payments" is its own Payments tab.
            onSeePayments={() => setSearch({ tab: 'payments' })}
          />
        </>
      )}
    </QueryView>
  );
}

function ClientSummary({ customerId, notFound }: { customerId: string; notFound: ReactNode }) {
  const profile = useProfile();
  const { t, language } = useLanguage();
  const summary = useCustomerSummary(profile.id, customerId);
  const projects = useProjectDirectory(profile.id, customerId);
  const data = summary.data && projects.data ? { summary: summary.data, matters: projects.data } : undefined;

  return (
    <>
      <ReadOnlyNotice profile={profile} />
      <QueryView queries={[summary, projects]} data={data} loading={<Skeleton strip />} notFound={notFound}>
        {({ summary: s, matters }) => (
          <>
            <p className="hp-asof">
              {s.lastPaymentOn ? t('hosted.client.lastPayment', { date: formatDay(s.lastPaymentOn, language) }) : t('hosted.client.noPayments')}
            </p>
            {s.currencies.map((block) => (
              <CurrencyBlock key={block.currency} block={block} matters={matters} />
            ))}
          </>
        )}
      </QueryView>
    </>
  );
}

type CurrencyBlockData = CustomerSummary['currencies'][number];

interface MatterRow {
  id: string;
  name: string;
  agreed: string | null;
  posted: string;
  paid: string;
  outstanding: string;
  status: string;
}

function CurrencyBlock({ block, matters }: { block: CurrencyBlockData; matters: Map<string, Project> }) {
  const { t } = useLanguage();
  const rows = useMemo<MatterRow[]>(
    () =>
      block.projects.map((p: ProjectSummary) => ({
        id: p.projectId,
        name: matters.get(p.projectId)?.name ?? '—',
        agreed: p.agreed ?? p.monthly,
        posted: p.posted,
        paid: p.paid,
        outstanding: p.outstanding,
        status: p.status,
      })),
    [block.projects, matters],
  );

  const currency = block.currency;
  const columns = useMemo<Column<MatterRow>[]>(
    () => [
      { key: 'matter', header: t('hosted.client.matterColumns.matter'), cell: (r) => r.name },
      { key: 'agreed', header: t('hosted.client.matterColumns.agreed'), numeric: true, cell: (r) => (r.agreed ? <DecimalAmount value={r.agreed} currency={currency} /> : '—') },
      { key: 'posted', header: t('hosted.client.matterColumns.posted'), numeric: true, cell: (r) => <DecimalAmount value={r.posted} currency={currency} /> },
      { key: 'paid', header: t('hosted.client.matterColumns.paid'), numeric: true, cell: (r) => <DecimalAmount value={r.paid} currency={currency} /> },
      { key: 'outstanding', header: t('hosted.client.matterColumns.outstanding'), numeric: true, cell: (r) => <DecimalAmount value={r.outstanding} currency={currency} /> },
      { key: 'status', header: t('hosted.client.matterColumns.status'), cell: (r) => <StatusBadge family="project" status={r.status} /> },
    ],
    [t, currency],
  );

  return (
    <section className="hp-currency-block" aria-label={currency}>
      <div className="hp-strip" role="group" aria-label={currency}>
        {(['outstanding', 'overdue', 'dueToday', 'notYetDue', 'unallocated'] as const).map((key) => (
          <div className="hp-stat" key={key}>
            <span className="hp-stat-label">{t(`hosted.client.${key}`)}</span>
            <span className="hp-stat-value">
              <DecimalAmount value={block[key]} currency={currency} />
            </span>
          </div>
        ))}
        <span className="hp-strip-status">
          <StatusBadge family="customer" status={block.status} />
        </span>
      </div>
      {rows.length > 0 ? (
        <HostedTable label={t('hosted.client.matters')} columns={columns} rows={rows} rowKey={(r) => r.id} />
      ) : (
        <p className="hp-muted">{t('hosted.client.noMatters')}</p>
      )}
    </section>
  );
}
