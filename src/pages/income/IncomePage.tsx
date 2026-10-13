/**
 * Income Page
 *
 * Dedicated income tracking page with question-first UX.
 * Shows income transactions with status-based filtering:
 * - All: All income transactions
 * - Unpaid: Outstanding receivables
 * - Received: Paid income
 * - Overdue: Past due date receivables
 *
 * Its filters are one model in the URL (MUT-83), so a link can open it
 * filtered: the clients index's "No client" and "Archived clients" rows open
 * the unpaid entries behind their figures.
 *
 * Each row shows what was done, the entry's title (MUT-62): the entry is the
 * work record (MUT-5). Rows are shaped once per result and the columns are one
 * stable list that drives the header and every row (incomeRows.ts).
 */

import { useMemo, type ReactNode } from 'react';
import { TopBar } from '../../components/layout';
import { SearchInput, DateRangeControl } from '../../components/filters';
import { EmptyState, RowActionsMenu, RowActionsHeader, AmountWithConversion, PaymentStatusBadge, RecordPaymentButton, TruncatedTitle } from '../../components/ui';
import { CheckIcon, CopyIcon } from '../../components/icons';
import { useOverviewTotalsByCurrency } from '../../hooks/useQueries';
import { useIncome } from '../../hooks/useIncomeQueries';
import { useSavedFlashRows } from '../../hooks/useSavedFlash';
import { useProfileFilter } from '../../hooks/useActiveProfile';
import { useIncomeFilters } from '../../hooks/useIncomeFilters';
import type { IncomeFilters } from '../../hooks/useIncomeQueries';
import { useIsCompactTable } from '../../hooks/useMediaQuery';
import { useDrawerStore } from '../../lib/stores';
import {
  formatDate,
  formatDateCompact,
  formatAmount,
  cn,
  EMPTY_CELL,
} from '../../lib/utils';
import { todayLocalISO, isOverdueReceivable } from '../../lib/dates';
import { resolveIncomeFilters, type IncomeStatusFilter } from '../../lib/incomeSearch';
import { toIncomeRow, incomeColumns, type IncomeColumnKey, type IncomeRow } from './incomeRows';
import { CurrencySummaryPopup } from '../../components/ui/CurrencySummaryPopup';
import { useT, useLanguage, getLocale } from '../../lib/i18n';

const STATUS_TABS: IncomeStatusFilter[] = ['all', 'unpaid', 'received', 'overdue'];

export function IncomePage() {
  const { openTransactionDrawer, openPartialPaymentDrawer } = useDrawerStore();
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const isCompact = useIsCompactTable();
  const profileId = useProfileFilter();

  // One filters model, mirrored to the URL (MUT-83)
  const { search: urlSearch, setSearch: setUrlSearch } = useIncomeFilters();
  const filters = useMemo(() => resolveIncomeFilters(urlSearch), [urlSearch]);
  const { status: statusFilter, q: search, client: clientScope } = filters;
  const dateRange = useMemo(() => ({ dateFrom: filters.dateFrom, dateTo: filters.dateTo }), [filters]);
  const isFiltered = Boolean(search || clientScope);

  // Fetch totals for summary strip
  const { data: totals } = useOverviewTotalsByCurrency(dateRange.dateFrom, dateRange.dateTo, profileId);

  // Build query filters - income only (useIncome already filters by kind='income')
  const queryFilters = useMemo((): IncomeFilters => {
    const query: IncomeFilters = {
      profileId,
      dateFrom: dateRange.dateFrom,
      dateTo: dateRange.dateTo,
      search: search || undefined,
      sort: { by: 'occurredAt', dir: 'desc' },
      clientScope,
    };

    if (statusFilter === 'unpaid') {
      query.status = 'unpaid';
    } else if (statusFilter === 'received') {
      query.status = 'paid';
    } else if (statusFilter === 'overdue') {
      query.status = 'overdue';
    }

    return query;
  }, [profileId, dateRange, statusFilter, search, clientScope]);

  const { data: transactions = [], isLoading, isFetching } = useIncome(queryFilters);

  // Shaped once per result, so a render that isn't a new result reshapes nothing
  const rows = useMemo(() => transactions.map((tx) => toIncomeRow(tx)), [transactions]);
  const isFlashed = useSavedFlashRows(
    'income-page',
    rows.map((row) => row.id),
    { isLoading, isFetching }
  );
  // One of two module-level lists: the same objects on every render
  const columns = incomeColumns(isCompact);

  const handleRowClick = (id: string) => {
    openTransactionDrawer({ mode: 'edit', transactionId: id });
  };

  const handleDuplicate = (id: string) => {
    openTransactionDrawer({ mode: 'create', duplicateFromId: id });
  };

  const handleAddIncome = () => {
    openTransactionDrawer({ mode: 'create', defaultStatus: 'earned' });
  };

  // Status tab counts.
  //
  // The overdue count MUST use the same predicate as the repository's
  // 'overdue' status filter, or the badge disagrees with the list it opens.
  // It previously compared a date-only string against the current instant,
  // which counted items due today as overdue in every timezone.
  const counts = useMemo(() => {
    const today = todayLocalISO();
    const all = transactions.length;
    const unpaid = transactions.filter((tx) => tx.status === 'unpaid').length;
    const received = transactions.filter((tx) => tx.status === 'paid').length;
    const overdue = transactions.filter((tx) => isOverdueReceivable(tx, today)).length;
    return { all, unpaid, received, overdue };
  }, [transactions]);

  const rowActions = (row: IncomeRow) => [
    ...(row.canMarkPaid
      ? [
          {
            label: t('common.markPaid'),
            icon: <CheckIcon size={16} />,
            // Opens the date-aware payment drawer (MUT-18)
            // instead of stamping today silently.
            onClick: () => openPartialPaymentDrawer({ transactionId: row.id }),
          },
        ]
      : []),
    {
      label: t('common.duplicate'),
      icon: <CopyIcon size={16} />,
      onClick: () => handleDuplicate(row.id),
    },
  ];

  // What each column's cell shows for a row; the header comes from the same list
  const renderCell = (key: IncomeColumnKey, row: IncomeRow): ReactNode => {
    switch (key) {
      case 'date':
        return isCompact ? formatDateCompact(row.date) : formatDate(row.date, locale);
      case 'work':
        return row.title ? (
          <TruncatedTitle title={row.title} onOpen={() => handleRowClick(row.id)} />
        ) : (
          <span className="text-muted">{EMPTY_CELL}</span>
        );
      case 'client':
        return row.clientName || t('common.noClient');
      case 'project':
        return row.projectName || EMPTY_CELL;
      case 'status':
        return (
          <>
            {row.paymentStatus ? (
              <PaymentStatusBadge
                paymentStatus={row.paymentStatus}
                amountMinor={row.amountMinor}
                receivedAmountMinor={row.tx.receivedAmountMinor}
              />
            ) : (
              <span className={cn('status-badge', row.status === 'paid' ? 'paid' : 'unpaid')}>
                {row.status === 'paid' ? t('transactions.status.paid') : t('transactions.status.unpaid')}
              </span>
            )}
            {row.overdueDays !== undefined && (
              <div style={{ fontSize: 'var(--text-label)', color: 'var(--error)', marginTop: '2px' }}>
                {t('transactions.status.overdue', { days: row.overdueDays })}
              </div>
            )}
          </>
        );
      case 'amount':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
            <AmountWithConversion amountMinor={row.amountMinor} currency={row.currency} type="income" />
            {row.partialReceivedMinor !== undefined && (
              <div style={{ fontSize: 'var(--text-label)', color: 'var(--muted)' }}>
                {t('transactions.partialPayment.received')}: {formatAmount(row.partialReceivedMinor, row.currency, locale)}
              </div>
            )}
          </div>
        );
      case 'actions':
        return (
          <div className="row-actions-cell">
            <RecordPaymentButton
              transaction={row.tx}
              onRecordPayment={() => openPartialPaymentDrawer({ transactionId: row.id })}
            />
            <RowActionsMenu actions={rowActions(row)} />
          </div>
        );
    }
  };

  return (
    <>
      <TopBar
        title={t('nav.income')}
        filterSlot={
          <div className="filters-row" style={{ marginBottom: 0, marginInlineStart: 24, flexWrap: 'nowrap' }}>
            <DateRangeControl
              dateFrom={dateRange.dateFrom}
              dateTo={dateRange.dateTo}
              onChange={(from, to) => setUrlSearch({ dateFrom: from, dateTo: to })}
            />
          </div>
        }
      />
      <div className="page-content">
        {/* Summary Strip */}
        {totals && (
          <div className="income-summary-strip">
            <div className="income-summary-item">
              <span className="income-summary-label">{t('income.summary.received')}</span>
              <CurrencySummaryPopup
                usdAmountMinor={totals.USD.paidIncomeMinor}
                ilsAmountMinor={totals.ILS.paidIncomeMinor}
                eurAmountMinor={totals.EUR?.paidIncomeMinor ?? 0}
                type="income"
              />
            </div>
            <div className="income-summary-item">
              <span className="income-summary-label">{t('income.summary.unpaid')}</span>
              <CurrencySummaryPopup
                usdAmountMinor={totals.USD.unpaidIncomeMinor}
                ilsAmountMinor={totals.ILS.unpaidIncomeMinor}
                eurAmountMinor={totals.EUR?.unpaidIncomeMinor ?? 0}
                type="neutral"
              />
            </div>
          </div>
        )}

        {/* Status Tabs */}
        <div className="income-status-tabs" role="tablist">
          {STATUS_TABS.map((status) => (
            <button
              key={status}
              role="tab"
              aria-selected={statusFilter === status}
              className={cn('income-status-tab', statusFilter === status && 'income-status-tab-active')}
              onClick={() => setUrlSearch({ status: status === 'all' ? undefined : status })}
            >
              {t(`income.status.${status}`)}
              <span className="income-status-count">{counts[status]}</span>
            </button>
          ))}
        </div>

        {/* Search and filters row */}
        <div className="filters-row">
          <SearchInput
            value={search}
            onChange={(q) => setUrlSearch({ q })}
            placeholder={t('transactions.searchPlaceholder')}
          />
          {clientScope && (
            <button
              type="button"
              className="income-scope-chip"
              aria-label={t('income.clientScope.clear', { name: t(`income.clientScope.${clientScope}`) })}
              onClick={() => setUrlSearch({ client: undefined })}
            >
              {t(`income.clientScope.${clientScope}`)}
              <span aria-hidden="true" className="income-scope-chip-clear">×</span>
            </button>
          )}
        </div>

        {/* Income List */}
        {isLoading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--muted)' }}>
            {t('common.loading')}
          </div>
        ) : transactions.length === 0 ? (
          <EmptyState
            title={isFiltered ? t('transactions.emptySearch') : t('income.empty')}
            hint={isFiltered ? undefined : t('income.emptyHint')}
            actionLabel={!isFiltered ? t('income.addIncome') : undefined}
            onAction={!isFiltered ? handleAddIncome : undefined}
          />
        ) : (
          <div className="data-table">
            <table>
              <thead>
                <tr>
                  {columns.map((column) =>
                    column.headerKey ? (
                      <th key={column.key} className={column.headerClassName}>
                        {t(column.headerKey)}
                      </th>
                    ) : (
                      <RowActionsHeader key={column.key} />
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn('clickable', isFlashed(row.id) && 'row-flash')}
                    onClick={() => handleRowClick(row.id)}
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={column.cellClassName}
                        onClick={column.key === 'actions' ? (e) => e.stopPropagation() : undefined}
                      >
                        {renderCell(column.key, row)}
                      </td>
                    ))}
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
