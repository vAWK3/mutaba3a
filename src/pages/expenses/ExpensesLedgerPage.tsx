/**
 * Expenses Ledger Page
 *
 * Question-first UX for expense tracking with view toggles:
 * - List: Standard table view of all expenses
 * - By Category: Grouped by expense category with subtotals
 * - By Project: Grouped by project with subtotals
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { TopBar } from '../../components/layout';
import { SearchInput, DateRangeControl, type SearchInputRef } from '../../components/filters';
import { EmptyState, RowActionsMenu, AmountWithConversion, RecurringOccurrenceList } from '../../components/ui';
import { RecurringAttentionList } from '../../components/expenses/RecurringAttentionList';
import { groupOccurrencesByRule, formatMonthList, type RecurringAttentionGroup } from '../../components/expenses/recurringAttention';
import { RecurringMarkPaidDrawer, type RecurringDrawerView } from '../../components/drawers/RecurringMarkPaidDrawer';
import { CopyIcon, TrashIcon } from '../../components/icons';
import { useExpenses, useDeleteExpense } from '../../hooks/useExpenseQueries';
import {
  useDueOccurrences,
  useVirtualOccurrences,
  useSkipRecurringOccurrences,
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
import { CurrencyAmounts } from '../../components/ui/CurrencyAmounts';
import { orderCurrencyAmounts } from '../../lib/currencyAmounts';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import { useTp } from '../../lib/i18n/plural';
import type { ExpenseFilters, ExpenseDisplay, Currency } from '../../types';

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
  const tp = useTp();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const isCompact = useIsCompactTable();

  // Get active profile - STRICT MODE: always operates on active profile only
  const { activeProfile } = useActiveProfile();
  const profileId = useProfileFilter();

  const [dateRange, setDateRange] = useState(() => getDateRangePreset('this-month'));
  const [viewMode, setViewMode] = useState<ExpenseView>('list');
  const [search, setSearch] = useState('');
  const [showForecast, setShowForecast] = useState(false); // Collapsed by default
  // The mark-paid drawer of one Needs attention row (MUT-87), by rule
  const [recurringDrawer, setRecurringDrawer] = useState<{ ruleId: string; view: RecurringDrawerView } | null>(null);

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

  // Recurring expense occurrences for active profile
  const { data: dueOccurrences = [] } = useDueOccurrences(profileId ?? '');
  const { data: allOccurrences = [] } = useVirtualOccurrences(
    profileId ?? '',
    dateRange.dateFrom,
    dateRange.dateTo
  );

  // Needs attention: one row per recurring rule, its missed payments oldest first (MUT-87)
  const attentionGroups = useMemo(() => groupOccurrencesByRule(dueOccurrences), [dueOccurrences]);
  // The drawer follows its rule's live group, so a payment skipped inside it drops out
  const drawerGroup = recurringDrawer
    ? attentionGroups.find((group) => group.ruleId === recurringDrawer.ruleId)
    : undefined;

  // Filter to only projected occurrences for the forecast
  const forecastOccurrences = useMemo(() => {
    return allOccurrences.filter(occ => occ.computedState === 'projected');
  }, [allOccurrences]);

  const skipOccurrencesMutation = useSkipRecurringOccurrences();

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

  // Summary strip totals (MUT-94): the same rows the ledger table shows, per
  // currency -- never converted or combined (ADR-004), so this is exactly
  // the sum of the ledger's rows, by construction, not by coincidence.
  const stripTotalsByCurrency = useMemo(() => {
    const totals: Record<Currency, number> = { USD: 0, ILS: 0, EUR: 0, JOD: 0, AED: 0, SAR: 0, QAR: 0, BHD: 0, OMR: 0 };
    for (const expense of expenses) {
      totals[expense.currency] += expense.amountMinor;
    }
    return totals;
  }, [expenses]);

  // Group expenses by category
  const expensesByCategory = useMemo((): GroupedExpenses[] => {
    const groups = new Map<string, GroupedExpenses>();

    for (const expense of expenses) {
      const categoryId = expense.categoryId || 'uncategorized';
      const categoryName = expense.categoryName || t('common.uncategorized');

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

  // Validate that we have a valid profile
  if (!activeProfile || !profileId) {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
        <p style={{ color: 'var(--muted)' }}>
          {t('expenses.noProfileSelected')}
        </p>
      </div>
    );
  }

  const handleEditRule = (expense: ExpenseDisplay) => {
    if (expense.recurringRuleId) {
      openExpenseDrawer({ mode: 'edit', recurringRuleId: expense.recurringRuleId });
    }
  };

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

  // Needs attention row actions (MUT-87): Mark paid and Snooze all open the
  // rule's drawer; Skip all asks first, then skips every missed payment at once.
  const handleSkipAll = (group: RecurringAttentionGroup) => {
    const count = group.occurrences.length;
    const dates = group.occurrences.map((occurrence) => occurrence.expectedDate);
    const question = tp('expenses.recurring.attention.confirmSkipAll', count, {
      title: group.title,
      months: formatMonthList(dates, locale),
    });
    if (!confirm(question)) return;
    skipOccurrencesMutation.mutate({ ruleId: group.ruleId, profileId: group.profileId, expectedDates: dates });
  };

  // The rule behind a missed payment is edited in the expense drawer (MUT-14)
  const handleEditOccurrenceRule = (group: RecurringAttentionGroup) => {
    openExpenseDrawer({ mode: 'edit', recurringRuleId: group.ruleId });
  };

  return (
    <>
      <TopBar
        title={t('nav.expenses')}
        filterSlot={
          <div className="filters-row" style={{ marginBottom: 0, marginInlineStart: 'var(--space-6)', flexWrap: 'nowrap' }}>
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
        <div className="expenses-summary-strip">
          <div className="expenses-summary-item">
            <span className="expenses-summary-label">{t('expenses.summary.total')}</span>
            <CurrencyAmounts amounts={orderCurrencyAmounts(stripTotalsByCurrency)} />
          </div>
        </div>

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
        </div>

        {/* Needs attention: one row per recurring rule (MUT-87) */}
        {attentionGroups.length > 0 && (
          <RecurringAttentionList
            groups={attentionGroups}
            onMarkPaid={(group) => setRecurringDrawer({ ruleId: group.ruleId, view: 'list' })}
            onSnoozeAll={(group) => setRecurringDrawer({ ruleId: group.ruleId, view: 'snooze' })}
            onSkipAll={handleSkipAll}
            onEditRule={handleEditOccurrenceRule}
          />
        )}

        {/* Forecast Section */}
        {forecastOccurrences.length > 0 && (
          <div className="forecast-section" style={{ marginBottom: 'var(--space-4)' }}>
            <button
              className="recurring-rules-header"
              onClick={() => setShowForecast(!showForecast)}
              style={{ width: '100%', textAlign: 'start', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-3) var(--space-4)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <span style={{ fontWeight: 600 }}>
                {t('expenses.recurring.forecast')} ({forecastOccurrences.length})
              </span>
              <span style={{ transform: showForecast ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>▶</span>
            </button>

            {showForecast && (
              <RecurringOccurrenceList occurrences={forecastOccurrences} compact />
            )}
          </div>
        )}

        {/* Content */}
        {isLoading ? (
          <div style={{ padding: 'var(--space-12)', textAlign: 'center', color: 'var(--muted)' }}>
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
            onEditRule={handleEditRule}
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
            onEditRule={handleEditRule}
            t={t}
          />
        )}
      </div>

      {/* The mark-paid drawer of one Needs attention row (MUT-87) */}
      {drawerGroup && recurringDrawer && (
        <RecurringMarkPaidDrawer
          key={`${drawerGroup.ruleId}:${recurringDrawer.view}`}
          group={drawerGroup}
          initialView={recurringDrawer.view}
          onClose={() => setRecurringDrawer(null)}
        />
      )}
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
  onEditRule: (expense: ExpenseDisplay) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

function ExpenseListView({
  expenses,
  locale,
  isCompact,
  onRowClick,
  onDuplicate,
  onDelete,
  onEditRule,
  t,
}: ExpenseListViewProps) {
  const tp = useTp();
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
                  {expense.receiptCount > 0 && (
                    <span className="receipt-badge" title={tp('expenses.receiptsAttached', expense.receiptCount)}>
                      📎 {expense.receiptCount}
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
                />
              </td>
              <td onClick={(e) => e.stopPropagation()}>
                <RowActionsMenu
                  actions={[
                    ...(expense.recurringRuleId
                      ? [
                          {
                            label: t('expenses.recurring.editRule'),
                            onClick: () => onEditRule(expense),
                          },
                        ]
                      : []),
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
  onEditRule: (expense: ExpenseDisplay) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

function ExpenseGroupedView({
  groups,
  groupType,
  locale,
  isCompact,
  onRowClick,
  onDuplicate,
  onDelete,
  onEditRule,
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
                      />
                    </td>
                    <td style={{ width: 48 }} onClick={(e) => e.stopPropagation()}>
                      <RowActionsMenu
                        actions={[
                          ...(expense.recurringRuleId
                            ? [
                                {
                                  label: t('expenses.recurring.editRule'),
                                  onClick: () => onEditRule(expense),
                                },
                              ]
                            : []),
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
