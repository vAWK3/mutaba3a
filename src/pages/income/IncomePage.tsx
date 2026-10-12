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
 */

import { useMemo } from 'react';
import { TopBar } from '../../components/layout';
import { SearchInput, DateRangeControl } from '../../components/filters';
import { EmptyState, RowActionsMenu, RowActionsHeader, AmountWithConversion, PaymentStatusBadge, RecordPaymentButton } from '../../components/ui';
import { CheckIcon, CopyIcon } from '../../components/icons';
import { useOverviewTotalsByCurrency } from '../../hooks/useQueries';
import { useIncome } from '../../hooks/useIncomeQueries';
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
} from '../../lib/utils';
import { todayLocalISO, isOverdueReceivable } from '../../lib/dates';
import { resolveIncomeFilters, type IncomeStatusFilter } from '../../lib/incomeSearch';
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

  const { data: transactions = [], isLoading } = useIncome(queryFilters);

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
                  <th>{t('transactions.columns.date')}</th>
                  <th>{t('transactions.columns.client')}</th>
                  {!isCompact && <th>{t('transactions.columns.project')}</th>}
                  <th>{t('transactions.columns.status')}</th>
                  <th className="text-end">{t('transactions.columns.amount')}</th>
                  <RowActionsHeader />
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className="clickable"
                    onClick={() => handleRowClick(tx.id)}
                  >
                    <td>
                      {isCompact
                        ? formatDateCompact(tx.occurredAt)
                        : formatDate(tx.occurredAt, locale)}
                    </td>
                    <td>{tx.clientName || t('common.noClient')}</td>
                    {!isCompact && <td className="text-secondary">{tx.projectName || '-'}</td>}
                    <td>
                      {tx.paymentStatus ? (
                        <PaymentStatusBadge
                          paymentStatus={tx.paymentStatus}
                          amountMinor={tx.amountMinor}
                          receivedAmountMinor={tx.receivedAmountMinor}
                        />
                      ) : (
                        <span className={cn('status-badge', tx.status === 'paid' ? 'paid' : 'unpaid')}>
                          {tx.status === 'paid' ? t('transactions.status.paid') : t('transactions.status.unpaid')}
                        </span>
                      )}
                      {tx.daysOverdue !== undefined && tx.daysOverdue > 0 && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--error)', marginTop: '2px' }}>
                          {t('transactions.status.overdue', { days: tx.daysOverdue })}
                        </div>
                      )}
                    </td>
                    <td className="amount-cell">
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                        <AmountWithConversion
                          amountMinor={tx.amountMinor}
                          currency={tx.currency}
                          type="income"
                        />
                        {tx.receivedAmountMinor && tx.receivedAmountMinor > 0 && tx.paymentStatus === 'partial' && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                            {t('transactions.partialPayment.received')}: {formatAmount(tx.receivedAmountMinor, tx.currency, locale)}
                          </div>
                        )}
                      </div>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="row-actions-cell">
                        <RecordPaymentButton
                          transaction={tx}
                          onRecordPayment={() => openPartialPaymentDrawer({ transactionId: tx.id })}
                        />
                        <RowActionsMenu
                          actions={[
                            ...(tx.status === 'unpaid' && tx.paymentStatus !== 'paid'
                              ? [
                                  {
                                    label: t('common.markPaid'),
                                    icon: <CheckIcon size={16} />,
                                    // Opens the date-aware payment drawer (MUT-18)
                                    // instead of stamping today silently.
                                    onClick: () => openPartialPaymentDrawer({ transactionId: tx.id }),
                                  },
                                ]
                              : []),
                            {
                              label: t('common.duplicate'),
                              icon: <CopyIcon size={16} />,
                              onClick: () => handleDuplicate(tx.id),
                            },
                          ]}
                        />
                      </div>
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
