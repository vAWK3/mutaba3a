import { useState, useMemo } from 'react';
import { TopBar } from '../../components/layout';
import { CurrencyTabs, DateRangeControl } from '../../components/filters';
import { useTransactions, useProjectSummaries, useClientSummaries } from '../../hooks/useQueries';
import { formatAmount, getDateRangePreset, cn } from '../../lib/utils';
import type { Currency, QueryFilters } from '../../types';

type ReportType = 'this-month' | 'this-year' | 'by-project' | 'by-client' | 'expenses-by-category' | 'unpaid-aging';

export function ReportsPage() {
  const [reportType, setReportType] = useState<ReportType>('this-month');
  const [dateRange, setDateRange] = useState(() => getDateRangePreset('this-month'));
  const [currency, setCurrency] = useState<Currency | undefined>(undefined);

  const displayCurrency = currency || 'USD';

  // Queries
  const { data: projectSummaries = [] } = useProjectSummaries(currency);
  const { data: clientSummaries = [] } = useClientSummaries(currency);

  const transactionFilters = useMemo((): QueryFilters => ({
    dateFrom: dateRange.dateFrom,
    dateTo: dateRange.dateTo,
    currency,
  }), [dateRange, currency]);

  const { data: transactions = [] } = useTransactions(transactionFilters);

  // Unpaid receivables
  const { data: allReceivables = [] } = useTransactions({
    kind: 'income',
    status: 'unpaid',
    currency,
  });

  // Compute report data
  const summaryData = useMemo(() => {
    let paidIncome = 0;
    let unpaidIncome = 0;
    let expenses = 0;

    for (const tx of transactions) {
      if (tx.kind === 'income') {
        if (tx.status === 'paid') {
          paidIncome += tx.amountMinor;
        } else {
          unpaidIncome += tx.amountMinor;
        }
      } else {
        expenses += tx.amountMinor;
      }
    }

    return { paidIncome, unpaidIncome, expenses, net: paidIncome - expenses };
  }, [transactions]);

  // Expenses by category
  const expensesByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const tx of transactions) {
      if (tx.kind === 'expense') {
        const cat = tx.categoryName || 'Uncategorized';
        map.set(cat, (map.get(cat) || 0) + tx.amountMinor);
      }
    }
    return Array.from(map.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [transactions]);

  // Unpaid aging
  const unpaidAging = useMemo(() => {
    const now = new Date();
    const aging = { current: 0, '1-30': 0, '31-60': 0, '60+': 0 };

    for (const tx of allReceivables) {
      if (!tx.dueDate) continue;
      const dueDate = new Date(tx.dueDate);
      const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

      if (daysOverdue <= 0) {
        aging.current += tx.amountMinor;
      } else if (daysOverdue <= 30) {
        aging['1-30'] += tx.amountMinor;
      } else if (daysOverdue <= 60) {
        aging['31-60'] += tx.amountMinor;
      } else {
        aging['60+'] += tx.amountMinor;
      }
    }

    return aging;
  }, [allReceivables]);

  const handleExportCSV = () => {
    let csvContent = '';
    let filename = '';

    switch (reportType) {
      case 'this-month':
      case 'this-year': {
        csvContent = 'Metric,Amount\n';
        csvContent += `Paid Income,${(summaryData.paidIncome / 100).toFixed(2)}\n`;
        csvContent += `Unpaid Receivables,${(summaryData.unpaidIncome / 100).toFixed(2)}\n`;
        csvContent += `Expenses,${(summaryData.expenses / 100).toFixed(2)}\n`;
        csvContent += `Net,${(summaryData.net / 100).toFixed(2)}\n`;
        filename = `summary-${reportType}.csv`;
        break;
      }
      case 'by-project': {
        csvContent = 'Project,Client,Paid,Unpaid,Expenses,Net\n';
        for (const p of projectSummaries) {
          csvContent += `"${p.name}","${p.clientName || ''}",${(p.paidIncomeMinor / 100).toFixed(2)},${(p.unpaidIncomeMinor / 100).toFixed(2)},${(p.expensesMinor / 100).toFixed(2)},${(p.netMinor / 100).toFixed(2)}\n`;
        }
        filename = 'report-by-project.csv';
        break;
      }
      case 'by-client': {
        csvContent = 'Client,Projects,Paid,Unpaid\n';
        for (const c of clientSummaries) {
          csvContent += `"${c.name}",${c.activeProjectCount},${(c.paidIncomeMinor / 100).toFixed(2)},${(c.unpaidIncomeMinor / 100).toFixed(2)}\n`;
        }
        filename = 'report-by-client.csv';
        break;
      }
      case 'expenses-by-category': {
        csvContent = 'Category,Amount\n';
        for (const e of expensesByCategory) {
          csvContent += `"${e.category}",${(e.amount / 100).toFixed(2)}\n`;
        }
        filename = 'expenses-by-category.csv';
        break;
      }
      case 'unpaid-aging': {
        csvContent = 'Period,Amount\n';
        csvContent += `Current (not due),${(unpaidAging.current / 100).toFixed(2)}\n`;
        csvContent += `1-30 days,${(unpaidAging['1-30'] / 100).toFixed(2)}\n`;
        csvContent += `31-60 days,${(unpaidAging['31-60'] / 100).toFixed(2)}\n`;
        csvContent += `60+ days,${(unpaidAging['60+'] / 100).toFixed(2)}\n`;
        filename = 'unpaid-aging.csv';
        break;
      }
    }

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reports: { type: ReportType; label: string }[] = [
    { type: 'this-month', label: 'This Month' },
    { type: 'this-year', label: 'This Year' },
    { type: 'by-project', label: 'By Project' },
    { type: 'by-client', label: 'By Client' },
    { type: 'expenses-by-category', label: 'Expenses by Category' },
    { type: 'unpaid-aging', label: 'Unpaid Aging' },
  ];

  return (
    <>
      <TopBar title="Reports" />
      <div className="page-content">
        <div className="reports-layout">
          {/* Sidebar */}
          <div className="reports-sidebar">
            <div className="reports-sidebar-title">Reports</div>
            {reports.map((r) => (
              <button
                key={r.type}
                className={cn('report-preset', reportType === r.type && 'active')}
                onClick={() => {
                  setReportType(r.type);
                  if (r.type === 'this-month') {
                    setDateRange(getDateRangePreset('this-month'));
                  } else if (r.type === 'this-year') {
                    setDateRange(getDateRangePreset('this-year'));
                  }
                }}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="reports-content">
            {/* Controls */}
            <div className="filters-row" style={{ marginBottom: 24 }}>
              {(reportType === 'this-month' || reportType === 'this-year' || reportType === 'expenses-by-category') && (
                <DateRangeControl
                  dateFrom={dateRange.dateFrom}
                  dateTo={dateRange.dateTo}
                  onChange={(from, to) => setDateRange({ dateFrom: from, dateTo: to })}
                />
              )}
              <CurrencyTabs value={currency} onChange={setCurrency} />
              <button className="btn btn-secondary" onClick={handleExportCSV}>
                Export CSV
              </button>
            </div>

            {/* Report Content */}
            {(reportType === 'this-month' || reportType === 'this-year') && (
              <div>
                <h3 style={{ marginBottom: 16 }}>Financial Summary</h3>
                <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                  <div className="kpi-card">
                    <div className="kpi-label">Paid Income</div>
                    <div className="kpi-value positive">{formatAmount(summaryData.paidIncome, displayCurrency)}</div>
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-label">Unpaid Receivables</div>
                    <div className="kpi-value warning">{formatAmount(summaryData.unpaidIncome, displayCurrency)}</div>
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-label">Expenses</div>
                    <div className="kpi-value">{formatAmount(summaryData.expenses, displayCurrency)}</div>
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-label">Net</div>
                    <div className={cn('kpi-value', summaryData.net >= 0 ? 'positive' : 'negative')}>
                      {formatAmount(summaryData.net, displayCurrency)}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {reportType === 'by-project' && (
              <div>
                <h3 style={{ marginBottom: 16 }}>Income by Project</h3>
                <div className="data-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Client</th>
                        <th style={{ textAlign: 'right' }}>Paid</th>
                        <th style={{ textAlign: 'right' }}>Unpaid</th>
                        <th style={{ textAlign: 'right' }}>Expenses</th>
                        <th style={{ textAlign: 'right' }}>Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectSummaries.map((p) => (
                        <tr key={p.id}>
                          <td style={{ fontWeight: 500 }}>{p.name}</td>
                          <td className="text-secondary">{p.clientName || '-'}</td>
                          <td className="amount-cell amount-positive">{formatAmount(p.paidIncomeMinor, displayCurrency)}</td>
                          <td className="amount-cell" style={{ color: 'var(--color-warning)' }}>{formatAmount(p.unpaidIncomeMinor, displayCurrency)}</td>
                          <td className="amount-cell">{formatAmount(p.expensesMinor, displayCurrency)}</td>
                          <td className={cn('amount-cell', p.netMinor >= 0 ? 'amount-positive' : 'amount-negative')}>
                            {formatAmount(p.netMinor, displayCurrency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {reportType === 'by-client' && (
              <div>
                <h3 style={{ marginBottom: 16 }}>Income by Client</h3>
                <div className="data-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Client</th>
                        <th>Projects</th>
                        <th style={{ textAlign: 'right' }}>Paid</th>
                        <th style={{ textAlign: 'right' }}>Unpaid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clientSummaries.map((c) => (
                        <tr key={c.id}>
                          <td style={{ fontWeight: 500 }}>{c.name}</td>
                          <td className="text-secondary">{c.activeProjectCount}</td>
                          <td className="amount-cell amount-positive">{formatAmount(c.paidIncomeMinor, displayCurrency)}</td>
                          <td className="amount-cell" style={{ color: 'var(--color-warning)' }}>{formatAmount(c.unpaidIncomeMinor, displayCurrency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {reportType === 'expenses-by-category' && (
              <div>
                <h3 style={{ marginBottom: 16 }}>Expenses by Category</h3>
                {expensesByCategory.length === 0 ? (
                  <div className="empty-state">
                    <p className="text-muted">No expenses in this period</p>
                  </div>
                ) : (
                  <div className="data-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Category</th>
                          <th style={{ textAlign: 'right' }}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expensesByCategory.map((e) => (
                          <tr key={e.category}>
                            <td style={{ fontWeight: 500 }}>{e.category}</td>
                            <td className="amount-cell">{formatAmount(e.amount, displayCurrency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {reportType === 'unpaid-aging' && (
              <div>
                <h3 style={{ marginBottom: 16 }}>Unpaid Receivables Aging</h3>
                <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                  <div className="kpi-card">
                    <div className="kpi-label">Current (not due)</div>
                    <div className="kpi-value">{formatAmount(unpaidAging.current, displayCurrency)}</div>
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-label">1-30 days overdue</div>
                    <div className="kpi-value warning">{formatAmount(unpaidAging['1-30'], displayCurrency)}</div>
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-label">31-60 days overdue</div>
                    <div className="kpi-value" style={{ color: 'var(--color-danger)' }}>{formatAmount(unpaidAging['31-60'], displayCurrency)}</div>
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-label">60+ days overdue</div>
                    <div className="kpi-value negative">{formatAmount(unpaidAging['60+'], displayCurrency)}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
