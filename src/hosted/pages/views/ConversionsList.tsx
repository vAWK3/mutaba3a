import { useMemo } from 'react';
import { useLanguage } from '../../../lib/i18n/core';
import { Button } from '../../../components/ui/Button';
import type { Conversion } from '../../api/client';
import { CurrencyFilter, DateFilter, FilterBar } from '../../components/FilterControls';
import { HostedTable, type Column } from '../../components/HostedTable';
import { Empty, QueryView } from '../../components/QueryView';
import { ConversionDrawer } from '../../components/ConversionDrawer';
import { AnchoredNote, SavedNotice } from '../../components/SavedNotice';
import { useSavedFlashRows } from '../../../lib/useSavedFlash';
import { isNarrowed, type ConversionsPageSearch } from '../../data/filters';
import { useConversions } from '../../data/conversionQueries';
import { useAnchoredList } from '../../data/anchoredList';
import { DecimalAmount } from '../../format/DecimalAmount';
import { formatDay } from '../../format/dates';
import { useProfile } from '../../session/me';
import { saveFeedbackPreset } from '../../../lib/motion/saveFeedbackPreset';
import { NoMatch, PageHeader, ShowMore } from './shared';

/**
 * Conversions (MUT-161), the hosted counterpart of the local app's
 * /conversions page. List is read-only presentation; the drawer is the write
 * surface, opened via `?newConversion=1` to log one and, since MUT-194
 * (ADR-075), `?conversion=<id>` to edit or delete one — a row click, or Enter
 * on the row's button (HostedTable row-link), like the expenses list.
 */

interface ConversionRow {
  id: string;
  date: string;
  fromAmount: string;
  fromCurrency: Conversion['currency'];
  toAmount: string;
  toCurrency: Conversion['toCurrency'];
  notes: string;
}

function shape(items: Conversion[], language: 'en' | 'ar'): ConversionRow[] {
  return items.map((c) => ({
    id: c.id,
    date: formatDay(c.occurredOn, language),
    fromAmount: c.amount,
    fromCurrency: c.currency,
    toAmount: c.toAmount,
    toCurrency: c.toCurrency,
    notes: c.notes ?? '—',
  }));
}

export interface ConversionsListProps {
  filters: ConversionsPageSearch;
  setFilters: (next: ConversionsPageSearch) => void;
}

export function ConversionsList({ filters, setFilters }: ConversionsListProps) {
  const profile = useProfile();
  const { t, language } = useLanguage();
  const list = useConversions(profile.id, filters);

  const rows = useMemo(() => (list.data ? shape(list.data, language) : undefined), [list.data, language]);

  // After-save (MUT-91, eng review D7): the same claim as the expenses list.
  // A list in error shows no rows (QueryView), so its stale rows can't claim a save either.
  const ids = useMemo(() => (list.isError ? [] : rows?.map((r) => r.id) ?? []), [rows, list.isError]);
  const anchored = useAnchoredList(filters, setFilters, list.error);
  // The list's own filters only: opening the drawer is not a filter change.
  const filtersKey = JSON.stringify({ ...filters, newConversion: undefined, conversion: undefined });
  const flashed = useSavedFlashRows('hosted-conversions', ids, { isLoading: !rows && !list.isError, isFetching: list.isFetching });

  const columns = useMemo<Column<ConversionRow>[]>(
    () => [
      { key: 'date', header: t('hosted.conversions.columns.date'), cell: (r) => r.date },
      { key: 'from', header: t('hosted.conversions.columns.from'), numeric: true, cell: (r) => <DecimalAmount value={r.fromAmount} currency={r.fromCurrency} /> },
      { key: 'to', header: t('hosted.conversions.columns.to'), numeric: true, cell: (r) => <DecimalAmount value={r.toAmount} currency={r.toCurrency} /> },
      { key: 'notes', header: t('hosted.conversions.columns.notes'), cell: (r) => r.notes },
    ],
    [t],
  );

  const patch = (change: Partial<ConversionsPageSearch>) => setFilters({ ...filters, ...change });
  const openNew = () => setFilters({ ...filters, newConversion: true, conversion: undefined });
  const openEdit = (row: ConversionRow) => setFilters({ ...filters, conversion: row.id, newConversion: undefined });
  const closeDrawer = () => setFilters({ ...filters, newConversion: undefined, conversion: undefined });
  // An anchored list can't start at a record that no longer exists (the server would 404): drop the anchor with it.
  const afterDelete = (id: string) =>
    setFilters({ ...filters, newConversion: undefined, conversion: undefined, anchor: filters.anchor === id ? undefined : filters.anchor });

  const recordButton = (
    <Button variant="primary" size="sm" onClick={openNew}>
      {t('hosted.conversions.record')}
    </Button>
  );

  return (
    <>
      <PageHeader title={t('hosted.conversions.title')}>{recordButton}</PageHeader>
      <FilterBar>
        <CurrencyFilter value={filters.currency} onChange={(currency) => patch({ currency })} />
        <DateFilter label={t('hosted.filters.from')} value={filters.from} onChange={(from) => patch({ from })} />
        <DateFilter label={t('hosted.filters.to')} value={filters.to} onChange={(to) => patch({ to })} />
      </FilterBar>
      {filters.anchor && !anchored.staleAnchor && <AnchoredNote onShowLatest={anchored.showLatest} focusRequest={anchored.focusRequest} />}
      <QueryView
        queries={anchored.staleAnchor ? [] : [list]}
        data={anchored.staleAnchor ? undefined : rows}
        isEmpty={(r) => r.length === 0}
        empty={
          isNarrowed(filters, { newConversion: undefined, conversion: undefined }) ? (
            <NoMatch onClear={() => setFilters({})} />
          ) : (
            <Empty title={t('hosted.conversions.empty.title')} body={t('hosted.conversions.empty.body')} action={recordButton} />
          )
        }
      >
        {(r) => (
          <>
            <HostedTable
              label={t('hosted.conversions.title')}
              columns={columns}
              rows={r}
              rowKey={(row) => row.id}
              onRowClick={openEdit}
              rowClassName={(row) => (flashed(row.id) ? 'row-flash' : undefined)}
            />
            <ShowMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
          </>
        )}
      </QueryView>
      <SavedNotice kind="conversion" message={t('hosted.savedFlash.conversionSaved')} profileId={profile.id} onShow={anchored.show} anchor={filters.anchor} filtersKey={filtersKey} listInError={list.isError} preset={saveFeedbackPreset(profile)} />
      {filters.newConversion && <ConversionDrawer profileId={profile.id} timezone={profile.timezone} onClose={closeDrawer} />}
      {filters.conversion && (
        <ConversionDrawer key={filters.conversion} profileId={profile.id} mode="edit" conversionId={filters.conversion} timezone={profile.timezone} onClose={closeDrawer} onDeleted={afterDelete} />
      )}
    </>
  );
}

export function ConversionsPage(props: ConversionsListProps) {
  return <ConversionsList {...props} />;
}
