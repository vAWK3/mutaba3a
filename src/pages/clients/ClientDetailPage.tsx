import { useState, useMemo } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import { SearchInput, CurrencyTabs, StatusSegment, DateRangeControl } from '../../components/filters';
import {
  useClient,
  useClientSummary,
  useTransactions,
  useProjects,
  useMarkTransactionPaid,
} from '../../hooks/useQueries';
import { useDrawerStore } from '../../lib/stores';
import { formatAmount, formatDate, getDaysUntil, getDateRangePreset, cn } from '../../lib/utils';
import type { Currency, TxStatus, QueryFilters } from '../../types';

export function ClientDetailPage() {
  const { clientId } = useParams({ from: '/clients/$clientId' });
  const { openTransactionDrawer, openClientDrawer, openProjectDrawer } = useDrawerStore();
  const markPaidMutation = useMarkTransactionPaid();

  const [activeTab, setActiveTab] = useState<'summary' | 'projects' | 'receivables' | 'transactions'>('summary');
  const [dateRange, setDateRange] = useState(() => getDateRangePreset('this-year'));
  const [currency, setCurrency] = useState<Currency | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<TxStatus | 'overdue' | undefined>(undefined);
  const [search, setSearch] = useState('');

  const { data: client, isLoading: clientLoading } = useClient(clientId);
  const { data: summary } = useClientSummary(clientId, {
    dateFrom: dateRange.dateFrom,
    dateTo: dateRange.dateTo,
    currency,
  });
  const { data: projects = [] } = useProjects(clientId);

  const queryFilters = useMemo((): QueryFilters => ({
    clientId,
    dateFrom: dateRange.dateFrom,
    dateTo: dateRange.dateTo,
    currency,
    status: statusFilter,
    search: search || undefined,
    sort: { by: 'occurredAt', dir: 'desc' },
  }), [clientId, dateRange, currency, statusFilter, search]);

  const receivablesFilters = useMemo((): QueryFilters => ({
    clientId,
    kind: 'income',
    status: 'unpaid',
    currency,
    sort: { by: 'dueDate', dir: 'asc' },
  }), [clientId, currency]);

  const { data: transactions = [] } = useTransactions(queryFilters);
  const { data: receivables = [] } = useTransactions(receivablesFilters);

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
      defaultClientId: clientId,
    });
  };

  if (clientLoading) {
    return (
      <>
        <TopBar title="Loading..." breadcrumbs={[{ label: 'Clients', href: '/clients' }]} />
        <div className="page-content">
          <div className="loading">
            <div className="spinner" />
          </div>
        </div>
      </>
    );
  }

  if (!client) {
    return (
      <>
        <TopBar title="Client Not Found" breadcrumbs={[{ label: 'Clients', href: '/clients' }]} />
        <div className="page-content">
          <div className="empty-state">
            <h3 className="empty-state-title">Client not found</h3>
            <p className="empty-state-description">This client may have been deleted or doesn't exist.</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar
        title={client.name}
        breadcrumbs={[
          { label: 'Clients', href: '/clients' },
          { label: client.name },
        ]}
        rightSlot={
          <button className="btn btn-ghost" onClick={() => openClientDrawer({ mode: 'edit', clientId })}>
            Edit
          </button>
        }
      />
      <div className="page-content">
        {/* Inline Stats */}
        {summary && (
          <div className="inline-stats" style={{ marginBottom: 24 }}>
            <div className="inline-stat">
              <span className="inline-stat-label">Active Projects</span>
              <span className="inline-stat-value">{summary.activeProjectCount}</span>
            </div>
            <div className="inline-stat">
              <span className="inline-stat-label">Paid Income</span>
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
              className={cn('tab', activeTab === 'projects' && 'active')}
              onClick={() => setActiveTab('projects')}
            >
              Projects
            </button>
            <button
              className={cn('tab', activeTab === 'receivables' && 'active')}
              onClick={() => setActiveTab('receivables')}
            >
              Receivables
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
              <h4 style={{ marginBottom: 12 }}>Client Details</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                <div>
                  <div className="text-muted text-sm">Email</div>
                  <div>{client.email || '-'}</div>
                </div>
                <div>
                  <div className="text-muted text-sm">Phone</div>
                  <div>{client.phone || '-'}</div>
                </div>
              </div>
              {client.notes && (
                <div style={{ marginTop: 16 }}>
                  <div className="text-muted text-sm">Notes</div>
                  <div>{client.notes}</div>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button className="btn btn-primary" onClick={handleAddTransaction}>
                Add Transaction
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => openProjectDrawer({ mode: 'create', defaultClientId: clientId })}
              >
                Add Project
              </button>
            </div>
          </div>
        )}

        {activeTab === 'projects' && (
          <>
            {projects.length === 0 ? (
              <div className="empty-state">
                <h3 className="empty-state-title">No projects</h3>
                <p className="empty-state-description">Add your first project for this client.</p>
                <button
                  className="btn btn-primary"
                  onClick={() => openProjectDrawer({ mode: 'create', defaultClientId: clientId })}
                >
                  Add Project
                </button>
              </div>
            ) : (
              <div className="data-table">
                <table>
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Field</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((project) => (
                      <tr key={project.id}>
                        <td>
                          <Link
                            to="/projects/$projectId"
                            params={{ projectId: project.id }}
                            style={{ fontWeight: 500 }}
                          >
                            {project.name}
                          </Link>
                        </td>
                        <td className="text-secondary">{project.field || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {activeTab === 'receivables' && (
          <>
            <div className="filters-row">
              <CurrencyTabs value={currency} onChange={setCurrency} />
            </div>
            {receivables.length === 0 ? (
              <div className="empty-state">
                <h3 className="empty-state-title">No receivables</h3>
                <p className="empty-state-description">All payments have been received.</p>
              </div>
            ) : (
              <div className="data-table">
                <table>
                  <thead>
                    <tr>
                      <th>Due Date</th>
                      <th>Project</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th>Days Overdue</th>
                      <th>Status</th>
                      <th style={{ width: 80 }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receivables.map((tx) => {
                      const daysUntilDue = tx.dueDate ? getDaysUntil(tx.dueDate) : 0;
                      const isOverdue = daysUntilDue < 0;

                      return (
                        <tr key={tx.id} className="clickable" onClick={() => handleRowClick(tx.id)}>
                          <td>{tx.dueDate ? formatDate(tx.dueDate) : '-'}</td>
                          <td className="text-secondary">{tx.projectName || '-'}</td>
                          <td className="amount-cell" style={{ color: 'var(--color-warning)' }}>
                            {formatAmount(tx.amountMinor, tx.currency)}
                          </td>
                          <td className={isOverdue ? 'text-danger' : 'text-muted'}>
                            {isOverdue ? Math.abs(daysUntilDue) : '-'}
                          </td>
                          <td>
                            {isOverdue ? (
                              <span className="status-badge overdue">Overdue</span>
                            ) : (
                              <span className="status-badge unpaid">Unpaid</span>
                            )}
                          </td>
                          <td>
                            <button
                              className="btn btn-sm btn-secondary"
                              onClick={(e) => handleMarkPaid(e, tx.id)}
                            >
                              Mark Paid
                            </button>
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
                <p className="empty-state-description">Add your first transaction for this client.</p>
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
                      <th>Project</th>
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
                          <td className="text-secondary">{tx.projectName || '-'}</td>
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
