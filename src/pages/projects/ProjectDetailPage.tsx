import { useState, useMemo } from 'react';
import { useParams } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import { SearchInput, CurrencyTabs, StatusSegment, DateRangeControl } from '../../components/filters';
import { useProject, useProjectSummary, useTransactions, useMarkTransactionPaid } from '../../hooks/useQueries';
import { useDrawerStore } from '../../lib/stores';
import { formatAmount, formatDate, getDaysUntil, getDateRangePreset, cn } from '../../lib/utils';
import type { Currency, TxStatus, QueryFilters } from '../../types';

export function ProjectDetailPage() {
  const { projectId } = useParams({ from: '/projects/$projectId' });
  const { openTransactionDrawer, openProjectDrawer } = useDrawerStore();
  const markPaidMutation = useMarkTransactionPaid();

  const [activeTab, setActiveTab] = useState<'summary' | 'transactions'>('summary');
  const [dateRange, setDateRange] = useState(() => getDateRangePreset('this-year'));
  const [currency, setCurrency] = useState<Currency | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<TxStatus | 'overdue' | undefined>(undefined);
  const [search, setSearch] = useState('');

  const { data: project, isLoading: projectLoading } = useProject(projectId);
  const { data: summary } = useProjectSummary(projectId, {
    dateFrom: dateRange.dateFrom,
    dateTo: dateRange.dateTo,
    currency,
  });

  const queryFilters = useMemo((): QueryFilters => ({
    projectId,
    dateFrom: dateRange.dateFrom,
    dateTo: dateRange.dateTo,
    currency,
    status: statusFilter,
    search: search || undefined,
    sort: { by: 'occurredAt', dir: 'desc' },
  }), [projectId, dateRange, currency, statusFilter, search]);

  const { data: transactions = [] } = useTransactions(queryFilters);

  const displayCurrency = currency || 'USD';

  const handleRowClick = (id: string) => {
    openTransactionDrawer({ mode: 'edit', transactionId: id });
  };

  const handleMarkPaid = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await markPaidMutation.mutateAsync(id);
  };

  const handleAddTransaction = () => {
    openTransactionDrawer({
      mode: 'create',
      defaultProjectId: projectId,
      defaultClientId: project?.clientId,
    });
  };

  if (projectLoading) {
    return (
      <>
        <TopBar title="Loading..." breadcrumbs={[{ label: 'Projects', href: '/projects' }]} />
        <div className="page-content">
          <div className="loading">
            <div className="spinner" />
          </div>
        </div>
      </>
    );
  }

  if (!project) {
    return (
      <>
        <TopBar title="Project Not Found" breadcrumbs={[{ label: 'Projects', href: '/projects' }]} />
        <div className="page-content">
          <div className="empty-state">
            <h3 className="empty-state-title">Project not found</h3>
            <p className="empty-state-description">This project may have been deleted or doesn't exist.</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar
        title={project.name}
        breadcrumbs={[
          { label: 'Projects', href: '/projects' },
          { label: project.name },
        ]}
        rightSlot={
          <button className="btn btn-ghost" onClick={() => openProjectDrawer({ mode: 'edit', projectId })}>
            Edit
          </button>
        }
      />
      <div className="page-content">
        {/* Inline Stats */}
        {summary && (
          <div className="inline-stats" style={{ marginBottom: 24 }}>
            <div className="inline-stat">
              <span className="inline-stat-label">Paid</span>
              <span className="inline-stat-value text-success">
                {formatAmount(summary.paidIncomeMinor, displayCurrency)}
              </span>
            </div>
            <div className="inline-stat">
              <span className="inline-stat-label">Unpaid</span>
              <span className="inline-stat-value text-warning">
                {formatAmount(summary.unpaidIncomeMinor, displayCurrency)}
              </span>
            </div>
            <div className="inline-stat">
              <span className="inline-stat-label">Expenses</span>
              <span className="inline-stat-value">{formatAmount(summary.expensesMinor, displayCurrency)}</span>
            </div>
            <div className="inline-stat">
              <span className="inline-stat-label">Net</span>
              <span className={cn('inline-stat-value', summary.netMinor >= 0 ? 'text-success' : 'text-danger')}>
                {formatAmount(summary.netMinor, displayCurrency)}
              </span>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="tabs">
          <div className="tabs-list">
            <button
              className={cn('tab', activeTab === 'summary' && 'active')}
              onClick={() => setActiveTab('summary')}
            >
              Summary
            </button>
            <button
              className={cn('tab', activeTab === 'transactions' && 'active')}
              onClick={() => setActiveTab('transactions')}
            >
              Transactions
            </button>
          </div>
        </div>

        {activeTab === 'summary' && (
          <div>
            <div className="card" style={{ marginBottom: 16 }}>
              <h4 style={{ marginBottom: 12 }}>Project Details</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                <div>
                  <div className="text-muted text-sm">Client</div>
                  <div>{summary?.clientName || '-'}</div>
                </div>
                <div>
                  <div className="text-muted text-sm">Field</div>
                  <div>{project.field || '-'}</div>
                </div>
              </div>
              {project.notes && (
                <div style={{ marginTop: 16 }}>
                  <div className="text-muted text-sm">Notes</div>
                  <div>{project.notes}</div>
                </div>
              )}
            </div>
            <button className="btn btn-primary" onClick={handleAddTransaction}>
              Add Transaction
            </button>
          </div>
        )}

        {activeTab === 'transactions' && (
          <>
            <div className="filters-row">
              <DateRangeControl
                dateFrom={dateRange.dateFrom}
                dateTo={dateRange.dateTo}
                onChange={(from, to) => setDateRange({ dateFrom: from, dateTo: to })}
              />
              <CurrencyTabs value={currency} onChange={setCurrency} />
              <StatusSegment value={statusFilter} onChange={setStatusFilter} />
              <SearchInput value={search} onChange={setSearch} placeholder="Search..." />
            </div>

            {transactions.length === 0 ? (
              <div className="empty-state">
                <h3 className="empty-state-title">No transactions</h3>
                <p className="empty-state-description">Add your first transaction for this project.</p>
                <button className="btn btn-primary" onClick={handleAddTransaction}>
                  Add Transaction
                </button>
              </div>
            ) : (
              <div className="data-table">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Client</th>
                      <th>Category</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th>Status</th>
                      <th style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx) => {
                      const isReceivable = tx.kind === 'income' && tx.status === 'unpaid';
                      const daysUntilDue = tx.dueDate ? getDaysUntil(tx.dueDate) : null;
                      const isOverdue = daysUntilDue !== null && daysUntilDue < 0;

                      return (
                        <tr key={tx.id} className="clickable" onClick={() => handleRowClick(tx.id)}>
                          <td>{formatDate(tx.occurredAt)}</td>
                          <td>
                            <span
                              className={cn(
                                'type-badge',
                                tx.kind === 'expense' && 'expense',
                                tx.kind === 'income' && tx.status === 'paid' && 'income',
                                isReceivable && 'receivable'
                              )}
                            >
                              {isReceivable ? 'Receivable' : tx.kind === 'income' ? 'Income' : 'Expense'}
                            </span>
                          </td>
                          <td className="text-secondary">{tx.clientName || '-'}</td>
                          <td className="text-secondary">{tx.categoryName || '-'}</td>
                          <td
                            className={cn(
                              'amount-cell',
                              tx.kind === 'income' && 'amount-positive',
                              tx.kind === 'expense' && 'amount-negative'
                            )}
                          >
                            {tx.kind === 'expense' ? '-' : ''}
                            {formatAmount(tx.amountMinor, tx.currency)}
                          </td>
                          <td>
                            {tx.kind === 'income' && (
                              <>
                                {tx.status === 'paid' ? (
                                  <span className="status-badge paid">Paid</span>
                                ) : isOverdue ? (
                                  <span className="status-badge overdue">{Math.abs(daysUntilDue!)}d overdue</span>
                                ) : (
                                  <span className="status-badge unpaid">
                                    Due {daysUntilDue === 0 ? 'today' : `in ${daysUntilDue}d`}
                                  </span>
                                )}
                              </>
                            )}
                          </td>
                          <td>
                            {isReceivable && (
                              <button
                                className="btn btn-sm btn-ghost"
                                onClick={(e) => handleMarkPaid(e, tx.id)}
                                title="Mark as paid"
                              >
                                <CheckIcon />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}
