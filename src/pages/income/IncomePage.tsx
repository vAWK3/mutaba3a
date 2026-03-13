/**
 * Income Page
 *
 * Dedicated income tracking page with question-first UX.
 * Shows income transactions with status-based filtering:
 * - All: All income transactions
 * - Unpaid: Outstanding receivables
 * - Received: Paid income
 * - Overdue: Past due date receivables
 */

import { useState, useMemo } from 'react';
import { TopBar } from '../../components/layout';
import { SearchInput, DateRangeControl } from '../../components/filters';
import { EmptyState, RowActionsMenu, AmountWithConversion } from '../../components/ui';
import { CheckIcon, CopyIcon } from '../../components/icons';
import { TransactionStatusCell } from '../../components/transactions';
import { useOverviewTotalsByCurrency } from '../../hooks/useQueries';
import { useIncome, useMarkIncomePaid } from '../../hooks/useIncomeQueries';
import type { IncomeFilters } from '../../hooks/useIncomeQueries';
import { useIsCompactTable } from '../../hooks/useMediaQuery';
import { useDrawerStore } from '../../lib/stores';
import {
  formatDate,
  formatDateCompact,
  getDateRangePreset,
  cn,
} from '../../lib/utils';
import { CurrencySummaryPopup } from '../../components/ui/CurrencySummaryPopup';
import { useT, useLanguage, getLocale } from '../../lib/i18n';

type IncomeStatusFilter = 'all' | 'unpaid' | 'received' | 'overdue';

export function IncomePage() {
  const { openTransactionDrawer } = useDrawerStore();
  const markPaidMutation = useMarkIncomePaid();
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const isCompact = useIsCompactTable();

  const [dateRange, setDateRange] = useState(() => getDateRangePreset('this-month'));
  const [statusFilter, setStatusFilter] = useState<IncomeStatusFilter>('all');
  const [search, setSearch] = useState('');

  // Fetch totals for summary strip
  const { data: totals } = useOverviewTotalsByCurrency(dateRange.dateFrom, dateRange.dateTo);

  // Build query filters - income only (useIncome already filters by kind='income')
  const queryFilters = useMemo((): IncomeFilters => {
    const filters: IncomeFilters = {
      dateFrom: dateRange.dateFrom,
      dateTo: dateRange.dateTo,
      search: search || undefined,
      sort: { by: 'occurredAt', dir: 'desc' },
    };

    if (statusFilter === 'unpaid') {
      filters.status = 'unpaid';
    } else if (statusFilter === 'received') {
      filters.status = 'paid';
    } else if (statusFilter === 'overdue') {
      filters.status = 'overdue';
    }

    return filters;
  }, [dateRange, statusFilter, search]);

  const { data: transactions = [], isLoading } = useIncome(queryFilters);

  const handleRowClick = (id: string) => {
    openTransactionDrawer({ mode: 'edit', transactionId: id });
  };

  const handleMarkPaid = async (id: string) => {
    await markPaidMutation.mutateAsync(id);
  };

  const handleDuplicate = (id: string) => {
    openTransactionDrawer({ mode: 'create', duplicateFromId: id });
  };

  const handleAddIncome = () => {
    openTransactionDrawer({ mode: 'create', defaultStatus: 'earned' });
  };

  // Status tab counts
  const counts = useMemo(() => {
    const all = transactions.length;
    const unpaid = transactions.filter((tx) => tx.status === 'unpaid').length;
    const received = transactions.filter((tx) => tx.status === 'paid').length;
    const overdue = transactions.filter((tx) => {
      if (tx.status !== 'unpaid' || !tx.dueDate) return false;
      return new Date(tx.dueDate) < new Date();
    }).length;
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
              onChange={(from, to) => setDateRange({ dateFrom: from, dateTo: to })}
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
          {(['all', 'unpaid', 'received', 'overdue'] as IncomeStatusFilter[]).map((status) => (
            <button
              key={status}
              role="tab"
              aria-selected={statusFilter === status}
              className={cn('income-status-tab', statusFilter === status && 'income-status-tab-active')}
              onClick={() => setStatusFilter(status)}
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
            onChange={setSearch}
            placeholder={t('transactions.searchPlaceholder')}
          />
        </div>

        {/* Income List */}
        {isLoading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--muted)' }}>
            {t('common.loading')}
          </div>
        ) : transactions.length === 0 ? (
          <EmptyState
            title={search ? t('transactions.emptySearch') : t('income.empty')}
            hint={search ? undefined : t('income.emptyHint')}
            actionLabel={!search ? t('income.addIncome') : undefined}
            onAction={!search ? handleAddIncome : undefined}
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
                  <th style={{ width: 48 }}></th>
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
                      <TransactionStatusCell
                        kind="income"
                        status={tx.status}
                        dueDate={tx.dueDate}
                      />
                    </td>
                    <td className="amount-cell">
                      <AmountWithConversion
                        amountMinor={tx.amountMinor}
                        currency={tx.currency}
                        type="income"
                      />
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <RowActionsMenu
                        actions={[
                          ...(tx.status === 'unpaid'
                            ? [
                                {
                                  label: t('common.markPaid'),
                                  icon: <CheckIcon size={16} />,
                                  onClick: () => handleMarkPaid(tx.id),
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
