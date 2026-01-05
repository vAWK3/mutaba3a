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
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import type { Currency, TxStatus, QueryFilters } from '../../types';

export function ClientDetailPage() {
  const { clientId } = useParams({ from: '/clients/$clientId' });
  const { openTransactionDrawer, openClientDrawer, openProjectDrawer } = useDrawerStore();
  const markPaidMutation = useMarkTransactionPaid();
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);

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
        <TopBar title={t('common.loading')} breadcrumbs={[{ label: t('nav.clients'), href: '/clients' }]} />
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
        <TopBar title={t('clients.notFound')} breadcrumbs={[{ label: t('nav.clients'), href: '/clients' }]} />
        <div className="page-content">
          <div className="empty-state">
            <h3 className="empty-state-title">{t('clients.notFound')}</h3>
            <p className="empty-state-description">{t('clients.notFoundHint')}</p>
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
          { label: t('nav.clients'), href: '/clients' },
          { label: client.name },
        ]}
        rightSlot={
          <button className="btn btn-ghost" onClick={() => openClientDrawer({ mode: 'edit', clientId })}>
            {t('common.edit')}
          </button>
        }
      />
      <div className="page-content">
        {/* Inline Stats */}
        {summary && (
          <div className="inline-stats" style={{ marginBottom: 24 }}>
            <div className="inline-stat">
              <span className="inline-stat-label">{t('clients.columns.activeProjects')}</span>
              <span className="inline-stat-value">{summary.activeProjectCount}</span>
            </div>
            <div className="inline-stat">
              <span className="inline-stat-label">{t('clients.columns.paidIncome')}</span>
              <span className="inline-stat-value text-success">
                {formatAmount(summary.paidIncomeMinor, displayCurrency, locale)}
              </span>
            </div>
            <div className="inline-stat">
              <span className="inline-stat-label">{t('clients.columns.unpaid')}</span>
              <span className="inline-stat-value text-warning">
                {formatAmount(summary.unpaidIncomeMinor, displayCurrency, locale)}
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
              {t('clients.tabs.summary')}
            </button>
            <button
              className={cn('tab', activeTab === 'projects' && 'active')}
              onClick={() => setActiveTab('projects')}
            >
              {t('clients.tabs.projects')}
            </button>
            <button
              className={cn('tab', activeTab === 'receivables' && 'active')}
              onClick={() => setActiveTab('receivables')}
            >
              {t('clients.tabs.receivables')}
            </button>
            <button
              className={cn('tab', activeTab === 'transactions' && 'active')}
              onClick={() => setActiveTab('transactions')}
            >
              {t('clients.tabs.transactions')}
            </button>
          </div>
        </div>

        {activeTab === 'summary' && (
          <div>
            <div className="card" style={{ marginBottom: 16 }}>
              <h4 style={{ marginBottom: 12 }}>{t('clients.detail.clientDetails')}</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                <div>
                  <div className="text-muted text-sm">{t('clients.detail.email')}</div>
                  <div>{client.email || '-'}</div>
                </div>
                <div>
                  <div className="text-muted text-sm">{t('clients.detail.phone')}</div>
                  <div>{client.phone || '-'}</div>
                </div>
              </div>
              {client.notes && (
                <div style={{ marginTop: 16 }}>
                  <div className="text-muted text-sm">{t('drawer.client.notes')}</div>
                  <div>{client.notes}</div>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button className="btn btn-primary" onClick={handleAddTransaction}>
                {t('transactions.addTransaction')}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => openProjectDrawer({ mode: 'create', defaultClientId: clientId })}
              >
                {t('projects.addProject')}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'projects' && (
          <>
            {projects.length === 0 ? (
              <div className="empty-state">
                <h3 className="empty-state-title">{t('clients.detail.noProjects')}</h3>
                <p className="empty-state-description">{t('clients.detail.noProjectsHint')}</p>
                <button
                  className="btn btn-primary"
                  onClick={() => openProjectDrawer({ mode: 'create', defaultClientId: clientId })}
                >
                  {t('projects.addProject')}
                </button>
              </div>
            ) : (
              <div className="data-table">
                <table>
                  <thead>
                    <tr>
                      <th>{t('projects.columns.project')}</th>
                      <th>{t('projects.columns.field')}</th>
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
                <h3 className="empty-state-title">{t('clients.detail.noReceivables')}</h3>
                <p className="empty-state-description">{t('clients.detail.noReceivablesHint')}</p>
              </div>
            ) : (
              <div className="data-table">
                <table>
                  <thead>
                    <tr>
                      <th>{t('clients.receivables.dueDate')}</th>
                      <th>{t('transactions.columns.project')}</th>
                      <th style={{ textAlign: 'end' }}>{t('transactions.columns.amount')}</th>
                      <th>{t('clients.receivables.daysOverdue')}</th>
                      <th>{t('transactions.columns.status')}</th>
                      <th style={{ width: 80 }}>{t('clients.receivables.action')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receivables.map((tx) => {
                      const daysUntilDue = tx.dueDate ? getDaysUntil(tx.dueDate) : 0;
                      const isOverdue = daysUntilDue < 0;

                      return (
                        <tr key={tx.id} className="clickable" onClick={() => handleRowClick(tx.id)}>
                          <td>{tx.dueDate ? formatDate(tx.dueDate, locale) : '-'}</td>
                          <td className="text-secondary">{tx.projectName || '-'}</td>
                          <td className="amount-cell" style={{ color: 'var(--color-warning)' }}>
                            {formatAmount(tx.amountMinor, tx.currency, locale)}
                          </td>
                          <td className={isOverdue ? 'text-danger' : 'text-muted'}>
                            {isOverdue ? Math.abs(daysUntilDue) : '-'}
                          </td>
                          <td>
                            {isOverdue ? (
                              <span className="status-badge overdue">{t('filters.status.overdue')}</span>
                            ) : (
                              <span className="status-badge unpaid">{t('filters.status.unpaid')}</span>
                            )}
                          </td>
                          <td>
                            <button
                              className="btn btn-sm btn-secondary"
                              onClick={(e) => handleMarkPaid(e, tx.id)}
                            >
                              {t('common.markPaid')}
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
              <SearchInput value={search} onChange={setSearch} />
            </div>

            {transactions.length === 0 ? (
              <div className="empty-state">
                <h3 className="empty-state-title">{t('clients.detail.noTransactions')}</h3>
                <p className="empty-state-description">{t('clients.detail.noTransactionsHint')}</p>
                <button className="btn btn-primary" onClick={handleAddTransaction}>
                  {t('transactions.addTransaction')}
                </button>
              </div>
            ) : (
              <div className="data-table">
                <table>
                  <thead>
                    <tr>
                      <th>{t('transactions.columns.date')}</th>
                      <th>{t('transactions.columns.type')}</th>
                      <th>{t('transactions.columns.project')}</th>
                      <th>{t('transactions.columns.category')}</th>
                      <th style={{ textAlign: 'end' }}>{t('transactions.columns.amount')}</th>
                      <th>{t('transactions.columns.status')}</th>
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
                          <td>{formatDate(tx.occurredAt, locale)}</td>
                          <td>
                            <span
                              className={cn(
                                'type-badge',
                                tx.kind === 'expense' && 'expense',
                                tx.kind === 'income' && tx.status === 'paid' && 'income',
                                isReceivable && 'receivable'
                              )}
                            >
                              {isReceivable ? t('transactions.type.receivable') : tx.kind === 'income' ? t('transactions.type.income') : t('transactions.type.expense')}
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
                            {formatAmount(tx.amountMinor, tx.currency, locale)}
                          </td>
                          <td>
                            {tx.kind === 'income' && (
                              <>
                                {tx.status === 'paid' ? (
                                  <span className="status-badge paid">{t('transactions.status.paid')}</span>
                                ) : isOverdue ? (
                                  <span className="status-badge overdue">{t('transactions.status.overdue', { days: Math.abs(daysUntilDue!) })}</span>
                                ) : (
                                  <span className="status-badge unpaid">
                                    {daysUntilDue === 0 ? t('transactions.status.dueToday') : t('transactions.status.dueIn', { days: daysUntilDue??0 })}
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
                                title={t('common.markPaid')}
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
