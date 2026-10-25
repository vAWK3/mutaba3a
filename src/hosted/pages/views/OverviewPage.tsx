import { useMemo, useRef } from 'react';
import { MalafatCreatedNote } from '../../components/MalafatPortal';
import { FirmOnBanner } from '../../components/FirmOnBanner';
import { TrialBanner } from '../../components/TrialBanner';
import { PasskeySuggestion } from '../../components/PasskeySuggestion';
import { Link } from '@tanstack/react-router';
import { SegmentedTabs } from '../../../components/filters/SegmentedTabs';
import { useLanguage } from '../../../lib/i18n/core';
import type { Currency, CurrencySummary, OrganizationSummary } from '../../api/client';
import { HostedTable, type Column } from '../../components/HostedTable';
import { Empty, QueryView, Skeleton } from '../../components/QueryView';
import { useCustomerDirectory, useOrganizationSummary } from '../../data/queries';
import type { OverviewFilters } from '../../data/filters';
import { DecimalAmount, isZeroDecimal } from '../../format/DecimalAmount';
import { formatDay } from '../../format/dates';
import { useProfile } from '../../session/me';
import { DeeperLinks } from '../../components/DeeperLinks';
import { PageHeader, StatusBadge } from './shared';

/**
 * Overview (hosted-portal.md §7.3, M8 IA adapted): per currency, the strip
 * Owed · Overdue · Proposed and the clients behind it, overdue first. The
 * currency switch appears only when more than one currency has a figure (M8 D13).
 */

interface OverviewRow {
  id: string;
  name: string;
  outstanding: string;
  overdue: string;
  lastPaymentOn: string | null;
  status: string;
  rank: number;
}

const RANK = { overdue: 0, outstanding: 1, quiet: 2 } as const;

function hasFigures(block: CurrencySummary): boolean {
  const amounts = [block.outstanding, block.overdue, block.dueToday, block.notYetDue, block.unallocated, block.proposed];
  return amounts.some((amount) => !isZeroDecimal(amount)) || block.customers.length > 0;
}

function pickCurrency(blocks: CurrencySummary[], wanted: Currency | undefined, fallback: Currency): CurrencySummary | undefined {
  return blocks.find((b) => b.currency === wanted) ?? blocks.find((b) => b.currency === fallback) ?? blocks[0];
}

interface OverviewPageProps {
  filters: OverviewFilters;
  setFilters: (next: OverviewFilters) => void;
}

export function OverviewPage({ filters, setFilters }: OverviewPageProps) {
  const profile = useProfile();
  const { t } = useLanguage();
  const summary = useOrganizationSummary(profile.id);
  const directory = useCustomerDirectory(profile.id);
  const data = summary.data && directory.data ? { summary: summary.data, names: directory.data } : undefined;
  const heading = useRef<HTMLHeadingElement>(null);

  return (
    <>
      {/* MUT-424: today's Overview is the Owed destination */}
      <PageHeader title={t('hosted.destinations.owed')} headingRef={heading} />
      {/* MUT-418: the free trial's days left, until a card is on file */}
      <TrialBanner />
      {/* MUT-370: suggest a passkey, after the trial's first-run step and under its banner (D4) */}
      <PasskeySuggestion />
      {/* Right after a business profile is created, once (MUT-191); dismissed, focus goes to the heading */}
      <MalafatCreatedNote onGone={() => heading.current?.focus()} />
      {/* MUT-300 (DR5): once firm features are on, until dismissed */}
      <FirmOnBanner />
      <QueryView
        queries={[summary, directory]}
        data={data}
        loading={<Skeleton strip />}
        isEmpty={({ summary: s }) => !s.currencies.some(hasFigures)}
        empty={<Empty title={t('hosted.overview.empty.title')} body={t('hosted.overview.empty.body')} />}
      >
        {({ summary: s, names }) => (
          <OverviewBody summary={s} names={names} currency={filters.currency} onCurrency={(currency) => setFilters({ ...filters, currency })} />
        )}
      </QueryView>
      <DeeperLinks destination="owed" links={[{ key: 'receivables', to: `/p/${profile.id}/receivables` }]} />
    </>
  );
}

interface OverviewBodyProps {
  summary: OrganizationSummary;
  names: Map<string, { name: string }>;
  currency: Currency | undefined;
  onCurrency: (currency: Currency) => void;
}

function OverviewBody({ summary, names, currency, onCurrency }: OverviewBodyProps) {
  const profile = useProfile();
  const { t, language } = useLanguage();
  const withFigures = useMemo(() => summary.currencies.filter(hasFigures), [summary]);
  const block = useMemo(() => pickCurrency(withFigures, currency, profile.defaultCurrency), [withFigures, currency, profile.defaultCurrency]);

  const rows = useMemo<OverviewRow[]>(() => {
    if (!block) return [];
    return block.customers
      .map((row) => ({
        id: row.customerId,
        name: names.get(row.customerId)?.name ?? '—',
        outstanding: row.outstanding,
        overdue: row.overdue,
        lastPaymentOn: row.lastPaymentOn,
        status: row.status,
        rank: !isZeroDecimal(row.overdue) ? RANK.overdue : !isZeroDecimal(row.outstanding) ? RANK.outstanding : RANK.quiet,
      }))
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, language));
  }, [block, names, language]);

  const blockCurrency = block?.currency ?? profile.defaultCurrency;
  const columns = useMemo<Column<OverviewRow>[]>(
    () => [
      {
        key: 'client',
        header: t('hosted.overview.columns.client'),
        cell: (row) => <Link to={`/p/${profile.id}/clients/${row.id}`}>{row.name}</Link>,
      },
      { key: 'outstanding', header: t('hosted.overview.columns.outstanding'), numeric: true, cell: (row) => <DecimalAmount value={row.outstanding} currency={blockCurrency} /> },
      { key: 'overdue', header: t('hosted.overview.columns.overdue'), numeric: true, cell: (row) => <DecimalAmount value={row.overdue} currency={blockCurrency} /> },
      { key: 'lastPayment', header: t('hosted.overview.columns.lastPayment'), cell: (row) => formatDay(row.lastPaymentOn, language) },
      { key: 'status', header: t('hosted.overview.columns.status'), cell: (row) => <StatusBadge family="customer" status={row.status} /> },
    ],
    [t, language, profile.id, blockCurrency],
  );

  if (!block) return null;

  return (
    <>
      <div className="hp-strip-row">
        <div className="hp-strip" role="group" aria-label={block.currency}>
          <Stat label={t('hosted.overview.owed')} value={block.outstanding} currency={block.currency} />
          <Stat label={t('hosted.overview.overdue')} value={block.overdue} currency={block.currency} danger />
          <Stat label={t('hosted.overview.proposed')} value={block.proposed} currency={block.currency} />
        </div>
        {withFigures.length > 1 && (
          <SegmentedTabs<Currency>
            options={withFigures.map((b) => ({ value: b.currency, label: b.currency }))}
            value={block.currency}
            onChange={onCurrency}
          />
        )}
      </div>
      <p className="hp-asof">{t('hosted.overview.asOf', { date: formatDay(summary.asOf, language) })}</p>
      {rows.length > 0 && <HostedTable label={t('hosted.destinations.owed')} columns={columns} rows={rows} rowKey={(row) => row.id} />}
    </>
  );
}

function Stat({ label, value, currency, danger = false }: { label: string; value: string; currency: Currency; danger?: boolean }) {
  return (
    <div className="hp-stat">
      <span className="hp-stat-label">{label}</span>
      <span className={`hp-stat-value ${danger && !isZeroDecimal(value) ? 'hp-danger' : ''}`}>
        <DecimalAmount value={value} currency={currency} />
      </span>
    </div>
  );
}
