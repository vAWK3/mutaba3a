import { useMemo } from 'react';
import { useLanguage } from '../../../lib/i18n/core';
import { Button } from '../../../components/ui/Button';
import type { Currency, Customer, Expense } from '../../api/client';
import { CategoryFilter, ClientFilter, DateFilter, FilterBar } from '../../components/FilterControls';
import { HostedTable, type Column } from '../../components/HostedTable';
import { Empty, QueryView } from '../../components/QueryView';
import { ExpenseDrawer } from '../../components/ExpenseDrawer';
import { isNarrowed, type ExpensesPageSearch } from '../../data/filters';
import { useCustomerDirectory } from '../../data/queries';
import { useExpenseCategories, useExpenses } from '../../data/expenseQueries';
import { DecimalAmount } from '../../format/DecimalAmount';
import { formatDay } from '../../format/dates';
import { useProfile } from '../../session/me';
import { NoMatch, PageHeader, ShowMore } from './shared';

/**
 * Expenses (MUT-44): the portal's only write. List is read-only presentation
 * over the same shape as the other hosted lists; the drawer (create/edit) is
 * the actual write surface, opened via `?newExpense=1` / `?expense=<id>`.
 */

interface ExpenseRow {
  id: string;
  date: string;
  title: string;
  category: string;
  client: string;
  currency: Currency;
  amount: string;
}

function shape(
  items: Expense[],
  categories: Map<string, { name: string }>,
  customers: Map<string, Customer>,
  language: 'en' | 'ar',
): ExpenseRow[] {
  return items.map((e) => ({
    id: e.id,
    date: formatDay(e.occurredOn, language),
    title: e.title ?? '—',
    category: (e.categoryId && categories.get(e.categoryId)?.name) ?? '—',
    client: (e.customerId && customers.get(e.customerId)?.name) ?? '—',
    currency: e.currency,
    amount: e.amount,
  }));
}

export interface ExpensesListProps {
  filters: ExpensesPageSearch;
  setFilters: (next: ExpensesPageSearch) => void;
}

export function ExpensesList({ filters, setFilters }: ExpensesListProps) {
  const profile = useProfile();
  const { t, language } = useLanguage();
  const list = useExpenses(profile.id, filters);
  const categoriesQuery = useExpenseCategories(profile.id);
  const customers = useCustomerDirectory(profile.id);

  const categoriesById = useMemo(
    () => new Map((categoriesQuery.data ?? []).map((c) => [c.id, c])),
    [categoriesQuery.data],
  );

  const rows = useMemo(
    () => (list.data && categoriesQuery.data && customers.data ? shape(list.data, categoriesById, customers.data, language) : undefined),
    [list.data, categoriesQuery.data, customers.data, categoriesById, language],
  );

  const columns = useMemo<Column<ExpenseRow>[]>(
    () => [
      { key: 'date', header: t('hosted.expenses.columns.date'), cell: (r) => r.date },
      { key: 'title', header: t('hosted.expenses.columns.title'), cell: (r) => r.title },
      { key: 'category', header: t('hosted.expenses.columns.category'), cell: (r) => r.category },
      { key: 'client', header: t('hosted.expenses.columns.client'), cell: (r) => r.client },
      { key: 'amount', header: t('hosted.expenses.columns.amount'), numeric: true, cell: (r) => <DecimalAmount value={r.amount} currency={r.currency} /> },
    ],
    [t],
  );

  const patch = (change: Partial<ExpensesPageSearch>) => setFilters({ ...filters, ...change });
  const openNew = () => setFilters({ ...filters, newExpense: true, expense: undefined });
  const openEdit = (row: ExpenseRow) => setFilters({ ...filters, expense: row.id, newExpense: undefined });
  const closeDrawer = () => setFilters({ ...filters, expense: undefined, newExpense: undefined });

  const recordButton = (
    <Button variant="primary" size="sm" onClick={openNew}>
      {t('hosted.expenses.record')}
    </Button>
  );

  return (
    <>
      <PageHeader title={t('hosted.expenses.title')}>{recordButton}</PageHeader>
      <FilterBar>
        <ClientFilter value={filters.customerId} options={customers.data} onChange={(customerId) => patch({ customerId })} />
        <CategoryFilter value={filters.categoryId} options={categoriesById} onChange={(categoryId) => patch({ categoryId })} />
        <DateFilter label={t('hosted.filters.from')} value={filters.from} onChange={(from) => patch({ from })} />
        <DateFilter label={t('hosted.filters.to')} value={filters.to} onChange={(to) => patch({ to })} />
      </FilterBar>
      <QueryView
        queries={[list, categoriesQuery, customers]}
        data={rows}
        isEmpty={(r) => r.length === 0}
        empty={
          isNarrowed(filters, { newExpense: undefined, expense: undefined }) ? (
            <NoMatch onClear={() => setFilters({})} />
          ) : (
            <Empty title={t('hosted.expenses.empty.title')} body={t('hosted.expenses.empty.body')} action={recordButton} />
          )
        }
      >
        {(r) => (
          <>
            <HostedTable label={t('hosted.expenses.title')} columns={columns} rows={r} rowKey={(row) => row.id} onRowClick={openEdit} />
            <ShowMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
          </>
        )}
      </QueryView>
      {(filters.newExpense || filters.expense) && (
        <ExpenseDrawer
          profileId={profile.id}
          timezone={profile.timezone}
          mode={filters.expense ? 'edit' : 'create'}
          expenseId={filters.expense}
          onClose={closeDrawer}
        />
      )}
    </>
  );
}

export function ExpensesPage(props: ExpensesListProps) {
  return <ExpensesList {...props} />;
}
