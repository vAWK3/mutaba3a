import { useState, useMemo } from 'react';
import { TopBar } from '../../components/layout';
import { CurrencyTabs, DateRangeControl } from '../../components/filters';
import { useOverviewTotals, useAttentionReceivables, useTransactions, useMarkTransactionPaid } from '../../hooks/useQueries';
import { useDrawerStore } from '../../lib/stores';
import { formatAmount, formatDate, getDaysUntil, getDateRangePreset, cn } from '../../lib/utils';
import type { Currency } from '../../types';

export function OverviewPage() {
  const { openTransactionDrawer } = useDrawerStore();
  const markPaidMutation = useMarkTransactionPaid();

  const [dateRange, setDateRange] = useState(() => getDateRangePreset('this-month'));
  const [currency, setCurrency] = useState<Currency | undefined>(undefined);

  const { data: totals, isLoading: totalsLoading } = useOverviewTotals(
    dateRange.dateFrom,
    dateRange.dateTo,
    currency
  );

  const { data: attentionItems = [] } = useAttentionReceivables(currency);

  const { data: recentTransactions = [] } = useTransactions({
    dateFrom: dateRange.dateFrom,
    dateTo: dateRange.dateTo,
    currency,
    limit: 10,
    sort: { by: 'occurredAt', dir: 'desc' },
  });

  const kpis = useMemo(() => {
    if (!totals) return null;
    const net = totals.paidIncomeMinor - totals.expensesMinor;
    const displayCurrency = currency || 'USD';
    return {
      paidIncome: formatAmount(totals.paidIncomeMinor, displayCurrency),
      unpaid: formatAmount(totals.unpaidIncomeMinor, displayCurrency),
      expenses: formatAmount(totals.expensesMinor, displayCurrency),
      net: formatAmount(net, displayCurrency),
      netValue: net,
    };
  }, [totals, currency]);

  const handleRowClick = (id: string) => {
    openTransactionDrawer({ mode: 'edit', transactionId: id });
  };

  const handleMarkPaid = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await markPaidMutation.mutateAsync(id);
  };

  return (
    <>
      <TopBar
        title="Overview"
        filterSlot={
          <div className="filters-row" style={{ marginBottom: 0, marginLeft: 24, flexWrap: 'nowrap' }}>
            <DateRangeControl
              dateFrom={dateRange.dateFrom}
              dateTo={dateRange.dateTo}
              onChange={(from, to) => setDateRange({ dateFrom: from, dateTo: to })}
            />
            <CurrencyTabs value={currency} onChange={setCurrency} />
          </div>
        }
      />
      <div className="page-content">
        {/* KPI Cards */}
        {totalsLoading ? (
          <div className="kpi-row">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="kpi-card">
                <div className="kpi-label">Loading...</div>
                <div className="kpi-value">-</div>
              </div>
            ))}
          </div>
        ) : kpis ? (
          <div className="kpi-row">
            <div className="kpi-card">
              <div className="kpi-label">Paid Income</div>
              <div className="kpi-value positive">{kpis.paidIncome}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Unpaid Receivables</div>
              <div className="kpi-value warning">{kpis.unpaid}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Expenses</div>
              <div className="kpi-value">{kpis.expenses}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Net (Paid - Expenses)</div>
              <div className={cn('kpi-value', kpis.netValue >= 0 ? 'positive' : 'negative')}>
                {kpis.net}
              </div>
            </div>
          </div>
        ) : null}

        {/* Two column layout */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {/* Needs Attention */}
          <div className="attention-list">
            <div className="attention-header">
              <h3 className="attention-title">Needs Attention</h3>
            </div>
            {attentionItems.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                No overdue or upcoming receivables
              </div>
            ) : (
              attentionItems.slice(0, 5).map((item) => {
                const daysUntil = item.dueDate ? getDaysUntil(item.dueDate) : 0;
                const isOverdue = daysUntil < 0;

                return (
                  <div
                    key={item.id}
                    className="attention-item"
                    style={{ cursor: 'pointer' }}
                    onClick={() => handleRowClick(item.id)}
                  >
                    <div className="attention-info">
                      <span className="attention-client">{item.clientName || 'No client'}</span>
                      <span className="attention-meta">
                        {item.projectName || 'No project'} •{' '}
                        {isOverdue ? (
                          <span className="text-danger">{Math.abs(daysUntil)} days overdue</span>
                        ) : daysUntil === 0 ? (
                          <span className="text-warning">Due today</span>
                        ) : (
                          <span className="text-warning">Due in {daysUntil} days</span>
                        )}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span className={cn('attention-amount', isOverdue ? 'text-danger' : 'text-warning')}>
                        {formatAmount(item.amountMinor, item.currency)}
                      </span>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={(e) => handleMarkPaid(e, item.id)}
                        title="Mark as paid"
                      >
                        <CheckIcon />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Recent Activity */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Recent Activity</h3>
            </div>
            {recentTransactions.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                No recent transactions
              </div>
            ) : (
              <div className="data-table" style={{ border: 'none' }}>
                <table>
                  <tbody>
                    {recentTransactions.map((tx) => {
                      const isReceivable = tx.kind === 'income' && tx.status === 'unpaid';
                      return (
                        <tr
                          key={tx.id}
                          className="clickable"
                          onClick={() => handleRowClick(tx.id)}
                        >
                          <td style={{ width: 80 }}>{formatDate(tx.occurredAt)}</td>
                          <td>
                            <span
                              className={cn(
                                'type-badge',
                                tx.kind === 'expense' && 'expense',
                                tx.kind === 'income' && tx.status === 'paid' && 'income',
                                isReceivable && 'receivable'
                              )}
                            >
                              {isReceivable ? 'Recv' : tx.kind === 'income' ? 'Inc' : 'Exp'}
                            </span>
                          </td>
                          <td className="text-secondary" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {tx.clientName || tx.title || '-'}
                          </td>
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
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
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
