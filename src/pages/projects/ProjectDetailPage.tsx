import { useState, useMemo } from 'react';
import { useParams } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import { SearchInput, StatusSegment, DateRangeControl } from '../../components/filters';
import { RowActionsMenu } from '../../components/ui';
import { CurrencySummaryPopup } from '../../components/ui/CurrencySummaryPopup';
import { CheckIcon, CopyIcon } from '../../components/icons';
import { useProject, useProjectSummary, useTransactions, useMarkTransactionPaid } from '../../hooks/useQueries';
import { useDrawerStore } from '../../lib/stores';
import { formatAmount, formatDate, getDaysUntil, getDateRangePreset, cn } from '../../lib/utils';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import type { TxStatus, QueryFilters } from '../../types';

export function ProjectDetailPage() {
  const { projectId } = useParams({ from: '/projects/$projectId' });
  const { openTransactionDrawer, openProjectDrawer } = useDrawerStore();
  const markPaidMutation = useMarkTransactionPaid();
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);

  const [activeTab, setActiveTab] = useState<'summary' | 'transactions'>('summary');
  const [dateRange, setDateRange] = useState(() => getDateRangePreset('all'));
  const [statusFilter, setStatusFilter] = useState<TxStatus | 'overdue' | undefined>(undefined);
  const [search, setSearch] = useState('');

  const { data: project, isLoading: projectLoading } = useProject(projectId);
  // Fetch summary without currency filter to get both USD and ILS totals for header stats
  const { data: summary } = useProjectSummary(projectId, {
    dateFrom: dateRange.dateFrom,
    dateTo: dateRange.dateTo,
    // Don't pass currency - we want per-currency breakdowns
  });

  // Always fetch all currencies (no currency filter)
  const queryFilters = useMemo((): QueryFilters => ({
    projectId,
    dateFrom: dateRange.dateFrom,
    dateTo: dateRange.dateTo,
    status: statusFilter,
    search: search || undefined,
    sort: { by: 'occurredAt', dir: 'desc' },
  }), [projectId, dateRange, statusFilter, search]);

  const { data: transactions = [] } = useTransactions(queryFilters);

  const handleRowClick = (id: string) => {
    openTransactionDrawer({ mode: 'edit', transactionId: id });
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
        <TopBar title={t('common.loading')} breadcrumbs={[{ label: t('nav.projects'), href: '/projects' }]} />
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
        <TopBar title={t('projects.notFound')} breadcrumbs={[{ label: t('nav.projects'), href: '/projects' }]} />
        <div className="page-content">
          <div className="empty-state">
            <h3 className="empty-state-title">{t('projects.notFound')}</h3>
            <p className="empty-state-description">{t('projects.notFoundHint')}</p>
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
          { label: t('nav.projects'), href: '/projects' },
          { label: project.name },
        ]}
        rightSlot={
          <button className="btn btn-ghost" onClick={() => openProjectDrawer({ mode: 'edit', projectId })}>
            {t('common.edit')}
          </button>
        }
      />
      <div className="page-content">
        {/* Inline Stats - Unified with EUR support */}
        {summary && (
          <div className="inline-stats" style={{ marginBottom: 24 }}>
            <div className="inline-stat">
              <span className="inline-stat-label">{t('projects.columns.paid')}</span>
              <CurrencySummaryPopup
                usdAmountMinor={summary.paidIncomeMinorUSD ?? 0}
                ilsAmountMinor={summary.paidIncomeMinorILS ?? 0}
                eurAmountMinor={summary.paidIncomeMinorEUR ?? 0}
                type="income"
              />
            </div>
            <div className="inline-stat">
              <span className="inline-stat-label">{t('projects.columns.unpaid')}</span>
              <CurrencySummaryPopup
                usdAmountMinor={summary.unpaidIncomeMinorUSD ?? 0}
                ilsAmountMinor={summary.unpaidIncomeMinorILS ?? 0}
                eurAmountMinor={summary.unpaidIncomeMinorEUR ?? 0}
                type="neutral"
              />
            </div>
            <div className="inline-stat">
              <span className="inline-stat-label">{t('projects.columns.expenses')}</span>
              <CurrencySummaryPopup
                usdAmountMinor={summary.expensesMinorUSD ?? 0}
                ilsAmountMinor={summary.expensesMinorILS ?? 0}
                eurAmountMinor={summary.expensesMinorEUR ?? 0}
                type="expense"
              />
            </div>
            <div className="inline-stat">
              <span className="inline-stat-label">{t('projects.columns.net')}</span>
              <CurrencySummaryPopup
                usdAmountMinor={(summary.paidIncomeMinorUSD ?? 0) - (summary.expensesMinorUSD ?? 0)}
                ilsAmountMinor={(summary.paidIncomeMinorILS ?? 0) - (summary.expensesMinorILS ?? 0)}
                eurAmountMinor={(summary.paidIncomeMinorEUR ?? 0) - (summary.expensesMinorEUR ?? 0)}
                type="net"
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
              {t('projects.tabs.summary')}
            </button>
            <button
              className={cn('tab', activeTab === 'transactions' && 'active')}
              onClick={() => setActiveTab('transactions')}
            >
              {t('projects.tabs.transactions')}
            </button>
          </div>
        </div>

        {activeTab === 'summary' && (
          <div>
            <div className="card" style={{ marginBottom: 16 }}>
              <h4 style={{ marginBottom: 12 }}>{t('projects.detail.projectDetails')}</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                <div>
                  <div className="text-muted text-sm">{t('projects.columns.client')}</div>
                  <div>{summary?.clientName || '-'}</div>
                </div>
                <div>
                  <div className="text-muted text-sm">{t('projects.columns.field')}</div>
                  <div>{project.field || '-'}</div>
                </div>
              </div>
              {project.notes && (
                <div style={{ marginTop: 16 }}>
                  <div className="text-muted text-sm">{t('drawer.project.notes')}</div>
                  <div>{project.notes}</div>
                </div>
              )}
            </div>
            <button className="btn btn-primary" onClick={handleAddTransaction}>
              {t('transactions.addTransaction')}
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
              <StatusSegment value={statusFilter} onChange={setStatusFilter} />
              <SearchInput value={search} onChange={setSearch} />
            </div>

            {transactions.length === 0 ? (
              <div className="empty-state">
                <h3 className="empty-state-title">{t('projects.detail.noTransactions')}</h3>
                <p className="empty-state-description">{t('projects.detail.noTransactionsHint')}</p>
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
                      <th>{t('transactions.columns.client')}</th>
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
                                    {daysUntilDue === 0 ? t('transactions.status.dueToday') : t('transactions.status.dueIn', { days: daysUntilDue ??0 })}
                                  </span>
                                )}
                              </>
                            )}
                          </td>
                          <td>
                            <RowActionsMenu
                              actions={[
                                ...(isReceivable
                                  ? [
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
                                    openTransactionDrawer({ mode: 'create', duplicateFromId: tx.id }),
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
