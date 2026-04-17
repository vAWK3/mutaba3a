/**
 * Expenses Ledger Page
 *
 * Question-first UX for expense tracking with view toggles:
 * - List: Standard table view of all expenses
 * - By Category: Grouped by expense category with subtotals
 * - By Project: Grouped by project with subtotals
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import { SearchInput, DateRangeControl, type SearchInputRef } from '../../components/filters';
import { EmptyState, RowActionsMenu, AmountWithConversion, RecurringOccurrenceList } from '../../components/ui';
import { RecurringConfirmModal, RecurringSnoozeModal } from '../../components/modals';
import { CopyIcon, TrashIcon } from '../../components/icons';
import {
  useOverviewTotalsByCurrency,
} from '../../hooks/useQueries';
import { useExpenses, useDeleteExpense } from '../../hooks/useExpenseQueries';
import {
  useDueOccurrences,
  useVirtualOccurrences,
  useConfirmRecurringPayment,
  useSkipRecurringOccurrence,
  useSnoozeRecurringOccurrence,
} from '../../hooks/useRecurringExpenseQueries';
import { useActiveProfile, useProfileFilter } from '../../hooks/useActiveProfile';
import { useIsCompactTable } from '../../hooks/useMediaQuery';
import { useDrawerStore } from '../../lib/stores';
import {
  formatAmount,
  formatDate,
  formatDateCompact,
  getDateRangePreset,
  cn,
} from '../../lib/utils';
import { CurrencySummaryPopup } from '../../components/ui/CurrencySummaryPopup';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import type { ExpenseFilters, ExpenseDisplay, VirtualOccurrenceDisplay } from '../../types';

type ExpenseView = 'list' | 'byCategory';

interface GroupedExpenses {
  id: string;
  name: string;
  expenses: ExpenseDisplay[];
  totalsByCurrency: Record<string, number>; // Currency -> totalMinor
}

export function ExpensesLedgerPage() {
  const { openExpenseDrawer } = useDrawerStore();
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const isCompact = useIsCompactTable();

  // Get active profile - STRICT MODE: always operates on active profile only
  const { activeProfile } = useActiveProfile();
  const profileId = useProfileFilter();

  // Validate that we have a valid profile
  if (!activeProfile || !profileId) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--muted)' }}>
          {t('expenses.noProfileSelected')}
        </p>
      </div>
    );
  }

  const [dateRange, setDateRange] = useState(() => getDateRangePreset('this-month'));
  const [viewMode, setViewMode] = useState<ExpenseView>('list');
  const [search, setSearch] = useState('');
  const [showDueOccurrences, setShowDueOccurrences] = useState(true);
  const [showForecast, setShowForecast] = useState(false); // Collapsed by default
  const [confirmModalOccurrence, setConfirmModalOccurrence] = useState<VirtualOccurrenceDisplay | null>(null);
  const [snoozeModalOccurrence, setSnoozeModalOccurrence] = useState<VirtualOccurrenceDisplay | null>(null);

  // Ref for search input (keyboard shortcut focus)
  const searchInputRef = useRef<SearchInputRef>(null);

  // Keyboard shortcuts: N (new), / (search)
  // Note: Esc is already handled by Drawer component
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't trigger shortcuts if user is typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      switch (e.key) {
        case 'n':
        case 'N':
          e.preventDefault();
          openExpenseDrawer({ mode: 'create' });
          break;
        case '/':
          e.preventDefault();
          searchInputRef.current?.focus();
          break;
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [openExpenseDrawer]);

  // Fetch totals for summary strip
  const { data: totals } = useOverviewTotalsByCurrency(dateRange.dateFrom, dateRange.dateTo, profileId);

  // Recurring expense occurrences for active profile
  const { data: dueOccurrences = [] } = useDueOccurrences(profileId);
  const { data: allOccurrences = [] } = useVirtualOccurrences(
    profileId,
    dateRange.dateFrom,
    dateRange.dateTo
  );

  // Filter to only projected occurrences for the forecast
  const forecastOccurrences = useMemo(() => {
    return allOccurrences.filter(occ => occ.computedState === 'projected');
  }, [allOccurrences]);

  // Recurring occurrence mutations
  const confirmPaymentMutation = useConfirmRecurringPayment();
  const skipOccurrenceMutation = useSkipRecurringOccurrence();
  const snoozeOccurrenceMutation = useSnoozeRecurringOccurrence();

  // Build query filters - expenses only
  const queryFilters = useMemo((): ExpenseFilters => {
    return {
      dateFrom: dateRange.dateFrom,
      dateTo: dateRange.dateTo,
      profileId,
      search: search || undefined,
      sort: { by: 'occurredAt', dir: 'desc' },
    };
  }, [dateRange, profileId, search]);

  const { data: expenses = [], isLoading } = useExpenses(queryFilters);

  // Group expenses by category
  const expensesByCategory = useMemo((): GroupedExpenses[] => {
    const groups = new Map<string, GroupedExpenses>();

    for (const expense of expenses) {
      const categoryId = expense.categoryId || 'uncategorized';
      const categoryName = expense.categoryName || t('common.noCategory');

      if (!groups.has(categoryId)) {
        groups.set(categoryId, {
          id: categoryId,
          name: categoryName,
          expenses: [],
          totalsByCurrency: {},
        });
      }

      const group = groups.get(categoryId)!;
      group.expenses.push(expense);

      // Accumulate totals by currency
      const currency = expense.currency;
      group.totalsByCurrency[currency] = (group.totalsByCurrency[currency] || 0) + expense.amountMinor;
    }

    // Sort by total amount (sum all currencies for comparison)
    return Array.from(groups.values()).sort((a, b) => {
      const totalA = Object.values(a.totalsByCurrency).reduce((sum, val) => sum + val, 0);
      const totalB = Object.values(b.totalsByCurrency).reduce((sum, val) => sum + val, 0);
      return totalB - totalA;
    });
  }, [expenses, t]);

  // Delete mutation
  const deleteExpenseMutation = useDeleteExpense();

  const handleRowClick = (id: string) => {
    openExpenseDrawer({ mode: 'edit', expenseId: id });
  };

  const handleDuplicate = (expense: ExpenseDisplay) => {
    openExpenseDrawer({
      mode: 'create',
      defaultProfileId: expense.profileId,
      prefillData: {
        amountMinor: expense.amountMinor,
        currency: expense.currency,
        vendor: expense.vendor,
        vendorId: expense.vendorId,
        categoryId: expense.categoryId,
        title: expense.title,
        // Note: Don't copy id, occurredAt (use today), or notes
      },
    });
  };

  const handleDelete = async (expense: ExpenseDisplay) => {
    const message = expense.isFromRecurring
      ? t('expenses.confirmDeleteFromRecurring')
      : t('expenses.confirmDelete');

    if (confirm(message)) {
      try {
        await deleteExpenseMutation.mutateAsync(expense.id);
      } catch (error) {
        console.error('Failed to delete expense:', error);
      }
    }
  };

  const handleAddExpense = () => {
    openExpenseDrawer({ mode: 'create' });
  };

  // Recurring occurrence handlers
  const handleMarkPaid = (occurrence: VirtualOccurrenceDisplay) => {
    setConfirmModalOccurrence(occurrence);
  };

  const handleSkip = (occurrence: VirtualOccurrenceDisplay) => {
    if (confirm(t('expenses.recurring.occurrence.confirmSkip'))) {
      skipOccurrenceMutation.mutate({
        ruleId: occurrence.ruleId,
        profileId: occurrence.profileId,
        expectedDate: occurrence.expectedDate,
      });
    }
  };

  const handleSnooze = (occurrence: VirtualOccurrenceDisplay) => {
    setSnoozeModalOccurrence(occurrence);
  };

  const handleConfirmPayment = (params: {
    ruleId: string;
    profileId: string;
    expectedDate: string;
    amountMinor?: number;
    actualPaidDate?: string;
    notes?: string;
  }) => {
    confirmPaymentMutation.mutate(params, {
      onSuccess: () => {
        setConfirmModalOccurrence(null);
      },
    });
  };

  const handleConfirmSnooze = (params: {
    ruleId: string;
    profileId: string;
    expectedDate: string;
    snoozeUntil: string;
    notes?: string;
  }) => {
    snoozeOccurrenceMutation.mutate(params, {
      onSuccess: () => {
        setSnoozeModalOccurrence(null);
      },
    });
  };

  return (
    <>
      <TopBar
        title={t('nav.expenses')}
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
          <div className="expenses-summary-strip">
            <div className="expenses-summary-item">
              <span className="expenses-summary-label">{t('expenses.summary.total')}</span>
              <CurrencySummaryPopup
                usdAmountMinor={totals.USD.expensesMinor}
                ilsAmountMinor={totals.ILS.expensesMinor}
                eurAmountMinor={totals.EUR?.expensesMinor ?? 0}
                type="expense"
              />
            </div>
          </div>
        )}

        {/* View Toggle Tabs */}
        <div className="expenses-view-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={viewMode === 'list'}
            className={cn('expenses-view-tab', viewMode === 'list' && 'expenses-view-tab-active')}
            onClick={() => setViewMode('list')}
          >
            {t('expenses.view.list')}
          </button>
          <button
            role="tab"
            aria-selected={viewMode === 'byCategory'}
            className={cn('expenses-view-tab', viewMode === 'byCategory' && 'expenses-view-tab-active')}
            onClick={() => setViewMode('byCategory')}
          >
            {t('expenses.view.byCategory')}
          </button>
        </div>

        {/* Search row */}
        <div className="filters-row">
          <SearchInput
            ref={searchInputRef}
            value={search}
            onChange={setSearch}
            placeholder={t('transactions.searchPlaceholder')}
          />
          {/* Link to profile expenses for recurring management */}
          <Link to="/expenses/profiles" className="btn btn-ghost btn-sm">
            {t('expenses.manageRecurring')}
          </Link>
        </div>

        {/* Due Occurrences Section */}
        {dueOccurrences.length > 0 && (
          <div className="due-occurrences-section" style={{ marginBottom: 16 }}>
            <button
              className="recurring-rules-header"
              onClick={() => setShowDueOccurrences(!showDueOccurrences)}
              style={{ width: '100%', textAlign: 'start', background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <span style={{ fontWeight: 600 }}>
                {t('expenses.recurring.occurrence.needsAttention')} ({dueOccurrences.length})
              </span>
              <span style={{ transform: showDueOccurrences ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>▶</span>
            </button>

            {showDueOccurrences && (
              <RecurringOccurrenceList
                occurrences={dueOccurrences}
                onMarkPaid={handleMarkPaid}
                onSkip={handleSkip}
                onSnooze={handleSnooze}
              />
            )}
          </div>
        )}

        {/* Forecast Section */}
        {forecastOccurrences.length > 0 && (
          <div className="forecast-section" style={{ marginBottom: 16 }}>
            <button
              className="recurring-rules-header"
              onClick={() => setShowForecast(!showForecast)}
              style={{ width: '100%', textAlign: 'start', background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <span style={{ fontWeight: 600 }}>
                {t('expenses.recurring.forecast')} ({forecastOccurrences.length})
              </span>
              <span style={{ transform: showForecast ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>▶</span>
            </button>

            {showForecast && (
              <RecurringOccurrenceList
                occurrences={forecastOccurrences}
                onMarkPaid={handleMarkPaid}
                onSkip={handleSkip}
                onSnooze={handleSnooze}
                compact
              />
            )}
          </div>
        )}

        {/* Content */}
        {isLoading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--muted)' }}>
            {t('common.loading')}
          </div>
        ) : expenses.length === 0 ? (
          <EmptyState
            title={search ? t('transactions.emptySearch') : t('expenses.empty')}
            hint={search ? undefined : t('expenses.emptyHint')}
            actionLabel={!search ? t('expenses.addExpense') : undefined}
            onAction={!search ? handleAddExpense : undefined}
          />
        ) : viewMode === 'list' ? (
          <ExpenseListView
            expenses={expenses}
            locale={locale}
            isCompact={isCompact}
            onRowClick={handleRowClick}
            onDuplicate={handleDuplicate}
            onDelete={handleDelete}
            t={t}
          />
        ) : (
          <ExpenseGroupedView
            groups={expensesByCategory}
            groupType="category"
            locale={locale}
            isCompact={isCompact}
            onRowClick={handleRowClick}
            onDuplicate={handleDuplicate}
            onDelete={handleDelete}
            t={t}
          />
        )}
      </div>

      {/* Recurring Occurrence Modals */}
      <RecurringConfirmModal
        occurrence={confirmModalOccurrence}
        isOpen={!!confirmModalOccurrence}
        onClose={() => setConfirmModalOccurrence(null)}
        onConfirm={handleConfirmPayment}
        isLoading={confirmPaymentMutation.isPending}
      />
      <RecurringSnoozeModal
        occurrence={snoozeModalOccurrence}
        isOpen={!!snoozeModalOccurrence}
        onClose={() => setSnoozeModalOccurrence(null)}
        onSnooze={handleConfirmSnooze}
        isLoading={snoozeOccurrenceMutation.isPending}
      />
    </>
  );
}

// List view component
interface ExpenseListViewProps {
  expenses: ExpenseDisplay[];
  locale: string;
  isCompact: boolean;
  onRowClick: (id: string) => void;
  onDuplicate: (expense: ExpenseDisplay) => void;
  onDelete: (expense: ExpenseDisplay) => void;
  t: (key: string) => string;
}

function ExpenseListView({
  expenses,
  locale,
  isCompact,
  onRowClick,
  onDuplicate,
  onDelete,
  t,
}: ExpenseListViewProps) {
  return (
    <div className="data-table">
      <table>
        <thead>
          <tr>
            <th>{t('transactions.columns.date')}</th>
            <th>{t('transactions.columns.description')}</th>
            {!isCompact && <th>{t('transactions.columns.category')}</th>}
            <th className="text-end">{t('transactions.columns.amount')}</th>
            <th style={{ width: 48 }}></th>
          </tr>
        </thead>
        <tbody>
          {expenses.map((expense) => (
            <tr
              key={expense.id}
              className="clickable"
              onClick={() => onRowClick(expense.id)}
            >
              <td>
                {isCompact
                  ? formatDateCompact(expense.occurredAt)
                  : formatDate(expense.occurredAt, locale)}
              </td>
              <td>
                <span className="expense-title-cell">
                  {expense.title || '-'}
                  {expense.isFromRecurring && (
                    <span className="recurring-badge" title={t('expenses.fromRecurring')}>
                      {t('expenses.recurringBadge')}
                    </span>
                  )}
                </span>
              </td>
              {!isCompact && <td className="text-secondary">{expense.categoryName || '-'}</td>}
              <td className="amount-cell">
                <AmountWithConversion
                  amountMinor={expense.amountMinor}
                  currency={expense.currency}
                  type="expense"
                  showExpenseSign
                />
              </td>
              <td onClick={(e) => e.stopPropagation()}>
                <RowActionsMenu
                  actions={[
                    {
                      label: t('common.duplicate'),
                      icon: <CopyIcon size={16} />,
                      onClick: () => onDuplicate(expense),
                    },
                    {
                      label: t('common.delete'),
                      icon: <TrashIcon size={16} />,
                      onClick: () => onDelete(expense),
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
  );
}

// Grouped view component (by category or project)
interface ExpenseGroupedViewProps {
  groups: GroupedExpenses[];
  groupType: 'category' | 'project';
  locale: string;
  isCompact: boolean;
  onRowClick: (id: string) => void;
  onDuplicate: (expense: ExpenseDisplay) => void;
  onDelete: (expense: ExpenseDisplay) => void;
  t: (key: string) => string;
}

function ExpenseGroupedView({
  groups,
  groupType,
  locale,
  isCompact,
  onRowClick,
  onDuplicate,
  onDelete,
  t,
}: ExpenseGroupedViewProps) {
  return (
    <div className="expenses-grouped">
      {groups.map((group) => (
        <div
          key={group.id}
          className="expenses-group"
          data-testid={`${groupType}-group`}
        >
          <div className="expenses-group-header">
            <span className="expenses-group-name">{group.name}</span>
            <span className="expenses-group-totals">
              {/* Show separate totals per currency */}
              {Object.entries(group.totalsByCurrency).map(([currency, total], idx) => (
                <span key={currency} className="expenses-group-total amount-negative">
                  {idx > 0 && <span className="expenses-group-separator"> · </span>}
                  {formatAmount(total, currency as 'USD' | 'ILS' | 'EUR', locale)}
                </span>
              ))}
            </span>
          </div>
          <div className="data-table">
            <table>
              <tbody>
                {group.expenses.map((expense) => (
                  <tr
                    key={expense.id}
                    className="clickable"
                    onClick={() => onRowClick(expense.id)}
                  >
                    <td style={{ width: 100 }}>
                      {isCompact
                        ? formatDateCompact(expense.occurredAt)
                        : formatDate(expense.occurredAt, locale)}
                    </td>
                    <td>
                      <span className="expense-title-cell">
                        {expense.title || '-'}
                        {expense.isFromRecurring && (
                          <span className="recurring-badge" title={t('expenses.fromRecurring')}>
                            {t('expenses.recurringBadge')}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="amount-cell" style={{ width: 120 }}>
                      <AmountWithConversion
                        amountMinor={expense.amountMinor}
                        currency={expense.currency}
                        type="expense"
                        showExpenseSign
                      />
                    </td>
                    <td style={{ width: 48 }} onClick={(e) => e.stopPropagation()}>
                      <RowActionsMenu
                        actions={[
                          {
                            label: t('common.duplicate'),
                            icon: <CopyIcon size={16} />,
                            onClick: () => onDuplicate(expense),
                          },
                          {
                            label: t('common.delete'),
                            icon: <TrashIcon size={16} />,
                            onClick: () => onDelete(expense),
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
        </div>
      ))}
    </div>
  );
}
