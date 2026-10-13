/**
 * Conversions Page (MUT-141)
 *
 * Logged currency-conversion events: date, from-amount/currency,
 * to-amount/currency, implied rate, optional note. Excluded from P&L by
 * construction (src/db/aggregations.ts, src/lib/aggregations.ts) -- this
 * page only lists/edits them, same single-list shape as ExpensesLedgerPage's
 * "list" view, without its category grouping (conversions have no category).
 */

import { useMemo, useRef, useState } from 'react';
import { TopBar } from '../../components/layout';
import { SearchInput, DateRangeControl, type SearchInputRef } from '../../components/filters';
import { EmptyState, RowActionsMenu } from '../../components/ui';
import { TrashIcon } from '../../components/icons';
import { useConversions, useDeleteConversion } from '../../hooks/useConversionQueries';
import { useProfileFilter } from '../../hooks/useActiveProfile';
import { useIsCompactTable } from '../../hooks/useMediaQuery';
import { useDrawerStore } from '../../lib/stores';
import { formatAmount, formatDate, formatDateCompact, currencyExponent, getDateRangePreset } from '../../lib/utils';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import type { TransactionDisplay } from '../../types';

function impliedRateLabel(tx: TransactionDisplay): string {
  if (!tx.toCurrency || tx.toAmountMinor === undefined) return '-';
  const fromMajor = tx.amountMinor / 10 ** currencyExponent(tx.currency);
  const toMajor = tx.toAmountMinor / 10 ** currencyExponent(tx.toCurrency);
  if (fromMajor <= 0) return '-';
  return (toMajor / fromMajor).toFixed(4);
}

export function ConversionsPage() {
  const { openConversionDrawer } = useDrawerStore();
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const isCompact = useIsCompactTable();
  const profileId = useProfileFilter();

  const [dateRange, setDateRange] = useState(() => getDateRangePreset('this-month'));
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<SearchInputRef>(null);

  const queryFilters = useMemo(() => ({
    profileId,
    dateFrom: dateRange.dateFrom,
    dateTo: dateRange.dateTo,
    search: search || undefined,
  }), [profileId, dateRange, search]);

  const { data: conversions = [], isLoading } = useConversions(queryFilters);
  const deleteMutation = useDeleteConversion();

  const handleAdd = () => openConversionDrawer({ mode: 'create', defaultProfileId: profileId });
  const handleRowClick = (id: string) => openConversionDrawer({ mode: 'edit', transactionId: id });
  const handleDelete = (tx: TransactionDisplay) => {
    if (!confirm(t('conversions.confirmDelete'))) return;
    deleteMutation.mutate(tx.id);
  };

  return (
    <>
      <TopBar
        title={t('conversions.title')}
        filterSlot={
          <div className="filters-row" style={{ marginBottom: 0, marginInlineStart: 24, flexWrap: 'nowrap' }}>
            <DateRangeControl
              dateFrom={dateRange.dateFrom}
              dateTo={dateRange.dateTo}
              onChange={(from, to) => setDateRange({ dateFrom: from, dateTo: to })}
            />
          </div>
        }
      />
      <div className="page-content">
        <div className="filters-row">
          <SearchInput
            ref={searchInputRef}
            value={search}
            onChange={setSearch}
            placeholder={t('transactions.searchPlaceholder')}
          />
        </div>

        {isLoading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--muted)' }}>
            {t('common.loading')}
          </div>
        ) : conversions.length === 0 ? (
          <EmptyState
            title={search ? t('transactions.emptySearch') : t('conversions.empty')}
            hint={search ? undefined : t('conversions.emptyHint')}
            actionLabel={!search ? t('conversions.addButton') : undefined}
            onAction={!search ? handleAdd : undefined}
          />
        ) : (
          <div className="data-table">
            <table>
              <thead>
                <tr>
                  <th>{t('conversions.columns.date')}</th>
                  <th>{t('conversions.columns.from')}</th>
                  <th>{t('conversions.columns.to')}</th>
                  {!isCompact && <th>{t('conversions.columns.rate')}</th>}
                  {!isCompact && <th>{t('conversions.columns.notes')}</th>}
                  <th style={{ width: 48 }}></th>
                </tr>
              </thead>
              <tbody>
                {conversions.map((tx) => (
                  <tr key={tx.id} className="clickable" onClick={() => handleRowClick(tx.id)}>
                    <td>
                      {isCompact ? formatDateCompact(tx.occurredAt) : formatDate(tx.occurredAt, locale)}
                    </td>
                    <td>{formatAmount(tx.amountMinor, tx.currency, locale)}</td>
                    <td>
                      {tx.toCurrency && tx.toAmountMinor !== undefined
                        ? formatAmount(tx.toAmountMinor, tx.toCurrency, locale)
                        : '-'}
                    </td>
                    {!isCompact && <td className="text-secondary">{impliedRateLabel(tx)}</td>}
                    {!isCompact && <td className="text-secondary">{tx.notes || '-'}</td>}
                    <td onClick={(e) => e.stopPropagation()}>
                      <RowActionsMenu
                        actions={[
                          {
                            label: t('common.delete'),
                            icon: <TrashIcon size={16} />,
                            onClick: () => handleDelete(tx),
                            variant: 'danger',
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
