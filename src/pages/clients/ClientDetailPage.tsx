import { useState, useMemo } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import { SearchInput, StatusSegment, DateRangeControl } from '../../components/filters';
import { RowActionsMenu, PaymentStatusBadge } from '../../components/ui';
import { CurrencySummaryPopup } from '../../components/ui/CurrencySummaryPopup';
import { CheckIcon, CopyIcon } from '../../components/icons';
import {
  useClient,
  useClientSummary,
  useTransactions,
  useProjects,
  useProjectSummaries,
} from '../../hooks/useQueries';
import { useReceivables, useMarkIncomePaid } from '../../hooks/useIncomeQueries';
import { useDrawerStore } from '../../lib/stores';
import { formatDate, formatAmount, getDaysUntil, getDateRangePreset, cn } from '../../lib/utils';
import { AmountWithConversion } from '../../components/ui';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import type { TxKind, TxStatus, QueryFilters } from '../../types';

export function ClientDetailPage() {
  const { clientId } = useParams({ from: '/clients/$clientId' });
  const { openIncomeDrawer, openExpenseDrawer, openClientDrawer, openProjectDrawer, openPartialPaymentDrawer } = useDrawerStore();
  const markPaidMutation = useMarkIncomePaid();
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);

  const [activeTab, setActiveTab] = useState<'summary' | 'projects' | 'receivables' | 'transactions'>('summary');
  const [dateRange, setDateRange] = useState(() => getDateRangePreset('all'));
  const [statusFilter, setStatusFilter] = useState<TxStatus | 'overdue' | undefined>(undefined);
  const [search, setSearch] = useState('');

  const { data: client, isLoading: clientLoading } = useClient(clientId);
  // Fetch summary without currency filter to get per-currency breakdowns
  const { data: summary } = useClientSummary(clientId, {
    dateFrom: dateRange.dateFrom,
    dateTo: dateRange.dateTo,
  });
  // Note: Projects are fetched for potential future use in tabs
  useProjects(clientId);

  // Fetch project summaries for financial data and filter by client
  const { data: allProjectSummaries = [] } = useProjectSummaries();
  const projectSummaries = useMemo(() =>
    allProjectSummaries.filter(ps => ps.clientId === clientId),
    [allProjectSummaries, clientId]
  );

  // Calculate total expenses for this client's projects
  const totalExpenses = useMemo(() => ({
    USD: projectSummaries.reduce((sum, p) => sum + (p.expensesMinorUSD ?? 0), 0),
    ILS: projectSummaries.reduce((sum, p) => sum + (p.expensesMinorILS ?? 0), 0),
    EUR: projectSummaries.reduce((sum, p) => sum + (p.expensesMinorEUR ?? 0), 0),
  }), [projectSummaries]);

  // Always fetch all currencies (no currency filter)
  const queryFilters = useMemo((): QueryFilters => ({
    clientId,
    dateFrom: dateRange.dateFrom,
    dateTo: dateRange.dateTo,
    status: statusFilter,
    search: search || undefined,
    sort: { by: 'occurredAt', dir: 'desc' },
  }), [clientId, dateRange, statusFilter, search]);

  // Receivables filters use the dedicated useReceivables hook

  // Recent activity - last 5 transactions for quick view in Summary tab
  const recentActivityFilters = useMemo((): QueryFilters => ({
    clientId,
    sort: { by: 'occurredAt', dir: 'desc' },
    limit: 5,
  }), [clientId]);

  const { data: transactions = [] } = useTransactions(queryFilters);
  const { data: receivables = [] } = useReceivables({ clientId, sort: { by: 'dueDate', dir: 'asc' } });
  const { data: recentActivity = [] } = useTransactions(recentActivityFilters);

  const handleRowClick = (id: string, kind: TxKind) => {
    if (kind === 'expense') {
      openExpenseDrawer({ mode: 'edit', expenseId: id });
    } else {
      openIncomeDrawer({ mode: 'edit', transactionId: id });
    }
  };

  const handleAddIncome = () => {
    openIncomeDrawer({
      mode: 'create',
      defaultClientId: clientId,
      defaultStatus: 'earned',
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
        {/* Inline Stats - Unified with EUR support */}
        {summary && (
          <div className="inline-stats" style={{ marginBottom: 24 }}>
            <div className="inline-stat">
              <span className="inline-stat-label">{t('clients.columns.activeProjects')}</span>
              <span className="inline-stat-value">{summary.activeProjectCount}</span>
            </div>
            <div className="inline-stat">
              <span className="inline-stat-label">{t('clients.columns.paidIncome')}</span>
              <CurrencySummaryPopup
                usdAmountMinor={summary.paidIncomeMinorUSD ?? 0}
                ilsAmountMinor={summary.paidIncomeMinorILS ?? 0}
                eurAmountMinor={summary.paidIncomeMinorEUR ?? 0}
                type="income"
              />
            </div>
            <div className="inline-stat">
              <span className="inline-stat-label">{t('clients.columns.unpaid')}</span>
              <CurrencySummaryPopup
                usdAmountMinor={summary.unpaidIncomeMinorUSD ?? 0}
                ilsAmountMinor={summary.unpaidIncomeMinorILS ?? 0}
                eurAmountMinor={summary.unpaidIncomeMinorEUR ?? 0}
                type="neutral"
              />
            </div>
            <div className="inline-stat">
              <span className="inline-stat-label">{t('clients.columns.expenses')}</span>
              <CurrencySummaryPopup
                usdAmountMinor={totalExpenses.USD}
                ilsAmountMinor={totalExpenses.ILS}
                eurAmountMinor={totalExpenses.EUR}
                type="expense"
              />
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

            {/* Recent Activity Section */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h4>{t('clients.detail.recentActivity')}</h4>
                {recentActivity.length > 0 && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setActiveTab('transactions')}
                  >
                    {t('clients.detail.viewAllTransactions')}
                  </button>
                )}
              </div>
              {recentActivity.length === 0 ? (
                <p className="text-muted">{t('clients.detail.noRecentActivity')}</p>
              ) : (
                <div className="recent-activity-list">
                  {recentActivity.map((tx) => {
                    const isReceivable = tx.kind === 'income' && tx.status === 'unpaid';
                    return (
                      <div
                        key={tx.id}
                        className="recent-activity-item clickable"
                        onClick={() => handleRowClick(tx.id, tx.kind)}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px 0',
                          borderBottom: '1px solid var(--color-border)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
                          <span className="text-muted text-sm" style={{ minWidth: 80 }}>
                            {formatDate(tx.occurredAt, locale)}
                          </span>
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
                          <span className="text-secondary" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {tx.projectName || tx.categoryName || '-'}
                          </span>
                        </div>
                        <span className="amount-cell" style={{ fontWeight: 500 }}>
                          <AmountWithConversion
                            amountMinor={tx.amountMinor}
                            currency={tx.currency}
                            type={tx.kind === 'income' ? 'income' : 'expense'}
                            showExpenseSign={tx.kind === 'expense'}
                          />
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button className="btn btn-primary" onClick={handleAddIncome}>
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
            {projectSummaries.length === 0 ? (
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
                      <th style={{ textAlign: 'end' }}>{t('projects.columns.received')}</th>
                      <th style={{ textAlign: 'end' }}>{t('projects.columns.unpaid')}</th>
                      <th style={{ textAlign: 'end' }}>{t('projects.columns.expenses')}</th>
                      <th style={{ textAlign: 'end' }}>{t('projects.columns.net')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectSummaries.map((project) => {
                      const netUSD = (project.paidIncomeMinorUSD ?? 0) - (project.expensesMinorUSD ?? 0);
                      const netILS = (project.paidIncomeMinorILS ?? 0) - (project.expensesMinorILS ?? 0);
                      const netEUR = (project.paidIncomeMinorEUR ?? 0) - (project.expensesMinorEUR ?? 0);
                      const isNegativeNet = netUSD + netILS + netEUR < 0;

                      return (
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
                          <td className="amount-cell">
                            <CurrencySummaryPopup
                              usdAmountMinor={project.paidIncomeMinorUSD ?? 0}
                              ilsAmountMinor={project.paidIncomeMinorILS ?? 0}
                              eurAmountMinor={project.paidIncomeMinorEUR ?? 0}
                              type="income"
                            />
                          </td>
                          <td className="amount-cell">
                            <CurrencySummaryPopup
                              usdAmountMinor={project.unpaidIncomeMinorUSD ?? 0}
                              ilsAmountMinor={project.unpaidIncomeMinorILS ?? 0}
                              eurAmountMinor={project.unpaidIncomeMinorEUR ?? 0}
                              type="neutral"
                            />
                          </td>
                          <td className="amount-cell">
                            <CurrencySummaryPopup
                              usdAmountMinor={project.expensesMinorUSD ?? 0}
                              ilsAmountMinor={project.expensesMinorILS ?? 0}
                              eurAmountMinor={project.expensesMinorEUR ?? 0}
                              type="expense"
                            />
                          </td>
                          <td className={`amount-cell net-cell ${isNegativeNet ? 'negative' : 'positive'}`}>
                            <CurrencySummaryPopup
                              usdAmountMinor={netUSD}
                              ilsAmountMinor={netILS}
                              eurAmountMinor={netEUR}
                              type="net"
                            />
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

        {activeTab === 'receivables' && (
          <>
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
                        <tr key={tx.id} className="clickable" onClick={() => handleRowClick(tx.id, tx.kind)}>
                          <td>{tx.dueDate ? formatDate(tx.dueDate, locale) : '-'}</td>
                          <td className="text-secondary">{tx.projectName || '-'}</td>
                          <td className="amount-cell" style={{ color: 'var(--color-warning)' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                              <AmountWithConversion
                                amountMinor={tx.amountMinor}
                                currency={tx.currency}
                                type="neutral"
                              />
                              {tx.receivedAmountMinor && tx.receivedAmountMinor > 0 && tx.paymentStatus === 'partial' && (
                                <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                                  {t('transactions.partialPayment.received')}: {formatAmount(tx.receivedAmountMinor, tx.currency, locale)}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className={isOverdue ? 'text-danger' : 'text-muted'}>
                            {isOverdue ? Math.abs(daysUntilDue) : '-'}
                          </td>
                          <td>
                            {tx.paymentStatus ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <PaymentStatusBadge
                                  paymentStatus={tx.paymentStatus}
                                  amountMinor={tx.amountMinor}
                                  receivedAmountMinor={tx.receivedAmountMinor}
                                />
                                {isOverdue && (
                                  <div style={{ fontSize: '0.75rem', color: 'var(--error)' }}>
                                    {Math.abs(daysUntilDue)} {t('clients.receivables.daysOverdue')}
                                  </div>
                                )}
                              </div>
                            ) : (
                              isOverdue ? (
                                <span className="status-badge overdue">{t('filters.status.overdue')}</span>
                              ) : (
                                <span className="status-badge unpaid">{t('filters.status.unpaid')}</span>
                              )
                            )}
                          </td>
                          <td>
                            <RowActionsMenu
                              actions={[
                                {
                                  label: t('transactions.partialPayment.recordPayment'),
                                  icon: <CheckIcon size={16} />,
                                  onClick: () => openPartialPaymentDrawer({ transactionId: tx.id }),
                                },
                                {
                                  label: t('common.markPaid'),
                                  icon: <CheckIcon size={16} />,
                                  onClick: () => markPaidMutation.mutate(tx.id),
                                },
                                {
                                  label: t('common.duplicate'),
                                  icon: <CopyIcon size={16} />,
                                  onClick: () =>
                                    openIncomeDrawer({ mode: 'create', duplicateFromId: tx.id }),
                                },
                              ]}
                            />
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
              <StatusSegment value={statusFilter} onChange={setStatusFilter} />
              <SearchInput value={search} onChange={setSearch} />
            </div>

            {transactions.length === 0 ? (
              <div className="empty-state">
                <h3 className="empty-state-title">{t('clients.detail.noTransactions')}</h3>
                <p className="empty-state-description">{t('clients.detail.noTransactionsHint')}</p>
                <button className="btn btn-primary" onClick={handleAddIncome}>
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
                        <tr key={tx.id} className="clickable" onClick={() => handleRowClick(tx.id, tx.kind)}>
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
                          <td className="amount-cell">
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                              <AmountWithConversion
                                amountMinor={tx.amountMinor}
                                currency={tx.currency}
                                type={tx.kind === 'income' ? 'income' : 'expense'}
                                showExpenseSign={tx.kind === 'expense'}
                              />
                              {tx.kind === 'income' && tx.receivedAmountMinor && tx.receivedAmountMinor > 0 && tx.paymentStatus === 'partial' && (
                                <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                                  {t('transactions.partialPayment.received')}: {formatAmount(tx.receivedAmountMinor, tx.currency, locale)}
                                </div>
                              )}
                            </div>
                          </td>
                          <td>
                            {tx.kind === 'income' && tx.paymentStatus ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <PaymentStatusBadge
                                  paymentStatus={tx.paymentStatus}
                                  amountMinor={tx.amountMinor}
                                  receivedAmountMinor={tx.receivedAmountMinor}
                                />
                                {isOverdue && (
                                  <div style={{ fontSize: '0.75rem', color: 'var(--error)' }}>
                                    {t('transactions.status.overdue', { days: Math.abs(daysUntilDue!) })}
                                  </div>
                                )}
                              </div>
                            ) : tx.kind === 'income' && (
                              <>
                                {tx.status === 'paid' ? (
                                  <span className="status-badge paid">{t('transactions.status.paid')}</span>
                                ) : isOverdue ? (
                                  <span className="status-badge overdue">{t('transactions.status.overdue', { days: Math.abs(daysUntilDue!) })}</span>
                                ) : (
                                  <span className="status-badge unpaid">
                                    {daysUntilDue === 0 ? t('transactions.status.dueToday') : t('transactions.status.dueIn', { days: daysUntilDue ?? 0 })}
                                  </span>
                                )}
                              </>
                            )}
                          </td>
                          <td>
                            <RowActionsMenu
                              actions={[
                                ...(isReceivable && tx.paymentStatus !== 'paid'
                                  ? [
                                      {
                                        label: t('transactions.partialPayment.recordPayment'),
                                        icon: <CheckIcon size={16} />,
                                        onClick: () => openPartialPaymentDrawer({ transactionId: tx.id }),
                                      },
                                      {
                                        label: t('common.markPaid'),
                                        icon: <CheckIcon size={16} />,
                                        onClick: () => markPaidMutation.mutate(tx.id),
                                      },
                                    ]
                                  : []),
                                {
                                  label: t('common.duplicate'),
                                  icon: <CopyIcon size={16} />,
                                  onClick: () =>
                                    openIncomeDrawer({ mode: 'create', duplicateFromId: tx.id }),
                                },
                              ]}
                            />
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
