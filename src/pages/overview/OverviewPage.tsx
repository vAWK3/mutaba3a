import { useState } from 'react';
import { TopBar } from '../../components/layout';
import { DateRangeControl } from '../../components/filters';
import { CheckIcon } from '../../components/icons';
import { TransactionTypeBadge } from '../../components/transactions';
import { CurrencySummaryPopup } from '../../components/ui/CurrencySummaryPopup';
import { useOverviewTotalsByCurrency, useAttentionReceivables, useTransactions, useMarkTransactionPaid } from '../../hooks/useQueries';
import { useDrawerStore } from '../../lib/stores';
import { formatAmount, formatDate, getDaysUntil, getDateRangePreset, cn } from '../../lib/utils';
import { useT, useLanguage, getLocale } from '../../lib/i18n';

//TODO: remove initial sample data and remove button of "reset to sample data"
//TODO: add button to "delete all data", but automatically export all data as separate csv files clients/projects/transactions and only after saving the file then proceed user to confirm that data is backed up then delete


export function OverviewPage() {
  const { openTransactionDrawer } = useDrawerStore();
  const markPaidMutation = useMarkTransactionPaid();
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);

  const [dateRange, setDateRange] = useState(() => getDateRangePreset('all'));

  // Always fetch all currencies - no currency filter
  const { data: byCurrencyTotals, isLoading: totalsLoading } = useOverviewTotalsByCurrency(
    dateRange.dateFrom,
    dateRange.dateTo
  );

  const { data: attentionItems = [] } = useAttentionReceivables();

  const { data: recentTransactions = [] } = useTransactions({
    dateFrom: dateRange.dateFrom,
    dateTo: dateRange.dateTo,
    limit: 10,
    sort: { by: 'occurredAt', dir: 'desc' },
  });

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
        title={t('overview.title')}
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
        {/* KPI Cards */}
        {totalsLoading ? (
          <div className="kpi-row">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="kpi-card">
                <div className="kpi-label">{t('common.loading')}</div>
                <div className="kpi-value">-</div>
              </div>
            ))}
          </div>
        ) : byCurrencyTotals ? (
          <div className="kpi-row">
            <div className="kpi-card">
              <div className="kpi-label">{t('overview.kpi.paidIncome')}</div>
              <CurrencySummaryPopup
                usdAmountMinor={byCurrencyTotals.USD.paidIncomeMinor}
                ilsAmountMinor={byCurrencyTotals.ILS.paidIncomeMinor}
                eurAmountMinor={byCurrencyTotals.EUR.paidIncomeMinor}
                type="income"
                size="large"
              />
            </div>
            <div className="kpi-card">
              <div className="kpi-label">{t('overview.kpi.unpaidReceivables')}</div>
              <CurrencySummaryPopup
                usdAmountMinor={byCurrencyTotals.USD.unpaidIncomeMinor}
                ilsAmountMinor={byCurrencyTotals.ILS.unpaidIncomeMinor}
                eurAmountMinor={byCurrencyTotals.EUR.unpaidIncomeMinor}
                type="neutral"
                size="large"
              />
            </div>
            <div className="kpi-card">
              <div className="kpi-label">{t('overview.kpi.expenses')}</div>
              <CurrencySummaryPopup
                usdAmountMinor={byCurrencyTotals.USD.expensesMinor}
                ilsAmountMinor={byCurrencyTotals.ILS.expensesMinor}
                eurAmountMinor={byCurrencyTotals.EUR.expensesMinor}
                type="expense"
                size="large"
              />
            </div>
            <div className="kpi-card">
              <div className="kpi-label">{t('overview.kpi.net')}</div>
              <CurrencySummaryPopup
                usdAmountMinor={byCurrencyTotals.USD.paidIncomeMinor - byCurrencyTotals.USD.expensesMinor}
                ilsAmountMinor={byCurrencyTotals.ILS.paidIncomeMinor - byCurrencyTotals.ILS.expensesMinor}
                eurAmountMinor={byCurrencyTotals.EUR.paidIncomeMinor - byCurrencyTotals.EUR.expensesMinor}
                type="net"
                size="large"
              />
            </div>
          </div>
        ) : null}

        {/* Two column layout */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {/* Needs Attention */}
          <div className="attention-list">
            <div className="attention-header">
              <h3 className="attention-title">{t('overview.needsAttention')}</h3>
            </div>
            {attentionItems.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                {t('overview.noAttention')}
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
                      <span className="attention-client">{item.clientName || t('common.noClient')}</span>
                      <span className="attention-meta">
                        {item.projectName || t('common.noProject')} •{' '}
                        {isOverdue ? (
                          <span className="text-danger">{t('time.daysOverdue', { days: Math.abs(daysUntil) })}</span>
                        ) : daysUntil === 0 ? (
                          <span className="text-warning">{t('transactions.status.dueToday')}</span>
                        ) : (
                          <span className="text-warning">{t('time.dueInDays', { days: daysUntil })}</span>
                        )}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span className={cn('attention-amount', isOverdue ? 'text-danger' : 'text-warning')}>
                        {formatAmount(item.amountMinor, item.currency, locale)}
                      </span>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={(e) => handleMarkPaid(e, item.id)}
                        title={t('common.markPaid')}
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
              <h3 className="card-title">{t('overview.recentActivity')}</h3>
            </div>
            {recentTransactions.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                {t('overview.noRecent')}
              </div>
            ) : (
              <div className="data-table" style={{ border: 'none' }}>
                <table>
                  <tbody>
                    {recentTransactions.map((tx) => (
                      <tr
                        key={tx.id}
                        className="clickable"
                        onClick={() => handleRowClick(tx.id)}
                      >
                        <td style={{ width: 80 }}>{formatDate(tx.occurredAt, locale)}</td>
                        <td>
                          <TransactionTypeBadge kind={tx.kind} status={tx.status} />
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
                          {formatAmount(tx.amountMinor, tx.currency, locale)}
                        </td>
                      </tr>
                    ))}
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
