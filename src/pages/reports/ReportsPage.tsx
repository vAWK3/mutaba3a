import { useState, useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import { CurrencyModeTabs } from '../../components/filters/CurrencyModeTabs';
import { SearchInput } from '../../components/filters';
import { useTransactions, useProjectSummaries, useClientSummaries } from '../../hooks/useQueries';
import { formatAmount, getDateRangePreset, cn } from '../../lib/utils';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import type { Currency, CurrencyMode, PeriodPreset, ReportType, QueryFilters } from '../../types';

interface SummaryData {
  paidIncome: number;
  unpaidIncome: number;
  expenses: number;
  net: number;
}

export function ReportsPage() {
  const t = useT();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const locale = getLocale(language);

  // State
  const [reportType, setReportType] = useState<ReportType>('summary');
  const [period, setPeriod] = useState<PeriodPreset>('month');
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [dateRange, setDateRange] = useState(() => getDateRangePreset('this-month'));
  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>('BOTH');

  // Table sorting and search state
  const [projectSortKey, setProjectSortKey] = useState<'name' | 'paid' | 'unpaid' | 'expenses' | 'net'>('net');
  const [projectSortDir, setProjectSortDir] = useState<'asc' | 'desc'>('desc');
  const [clientSortKey, setClientSortKey] = useState<'name' | 'paid' | 'unpaid' | 'projects'>('paid');
  const [clientSortDir, setClientSortDir] = useState<'asc' | 'desc'>('desc');
  const [tableSearch, setTableSearch] = useState('');

  // Derive currency filter for queries (undefined means all currencies)
  const currencyFilter: Currency | undefined = currencyMode === 'BOTH' ? undefined : currencyMode;

  // Queries
  const { data: projectSummaries = [] } = useProjectSummaries(currencyFilter);
  const { data: clientSummaries = [] } = useClientSummaries(currencyFilter);

  const transactionFilters = useMemo((): QueryFilters => ({
    dateFrom: dateRange.dateFrom,
    dateTo: dateRange.dateTo,
    currency: currencyFilter,
  }), [dateRange, currencyFilter]);

  const { data: transactions = [] } = useTransactions(transactionFilters);

  // Unpaid receivables (no date filter for aging)
  const { data: allReceivables = [] } = useTransactions({
    kind: 'income',
    status: 'unpaid',
    currency: currencyFilter,
  });

  // Compute summary data - separated by currency for BOTH mode
  const summaryByCurrency = useMemo(() => {
    const result: Record<Currency, SummaryData> = {
      USD: { paidIncome: 0, unpaidIncome: 0, expenses: 0, net: 0 },
      ILS: { paidIncome: 0, unpaidIncome: 0, expenses: 0, net: 0 },
    };

    for (const tx of transactions) {
      const curr = tx.currency;
      if (tx.kind === 'income') {
        if (tx.status === 'paid') {
          result[curr].paidIncome += tx.amountMinor;
        } else {
          result[curr].unpaidIncome += tx.amountMinor;
        }
      } else {
        result[curr].expenses += tx.amountMinor;
      }
    }

    result.USD.net = result.USD.paidIncome - result.USD.expenses;
    result.ILS.net = result.ILS.paidIncome - result.ILS.expenses;

    return result;
  }, [transactions]);

  // Single currency summary (used when currencyMode is not BOTH)
  const singleCurrencySummary = useMemo((): SummaryData => {
    if (currencyMode === 'BOTH') {
      return { paidIncome: 0, unpaidIncome: 0, expenses: 0, net: 0 };
    }
    return summaryByCurrency[currencyMode];
  }, [currencyMode, summaryByCurrency]);

  // Expenses by category - separated by currency for BOTH mode
  const expensesByCurrencyAndCategory = useMemo(() => {
    const result: Record<Currency, Array<{ category: string; amount: number }>> = {
      USD: [],
      ILS: [],
    };

    const usdMap = new Map<string, number>();
    const ilsMap = new Map<string, number>();

    for (const tx of transactions) {
      if (tx.kind === 'expense') {
        const cat = tx.categoryName || t('common.uncategorized');
        if (tx.currency === 'USD') {
          usdMap.set(cat, (usdMap.get(cat) || 0) + tx.amountMinor);
        } else {
          ilsMap.set(cat, (ilsMap.get(cat) || 0) + tx.amountMinor);
        }
      }
    }

    result.USD = Array.from(usdMap.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
    result.ILS = Array.from(ilsMap.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);

    return result;
  }, [transactions, t]);

  // Unpaid aging - separated by currency for BOTH mode
  const unpaidAgingByCurrency = useMemo(() => {
    const result: Record<Currency, { current: number; '1-30': number; '31-60': number; '60+': number }> = {
      USD: { current: 0, '1-30': 0, '31-60': 0, '60+': 0 },
      ILS: { current: 0, '1-30': 0, '31-60': 0, '60+': 0 },
    };

    const now = new Date();

    for (const tx of allReceivables) {
      const aging = result[tx.currency];

      // Missing dueDate treated as 'Current' (not overdue)
      if (!tx.dueDate) {
        aging.current += tx.amountMinor;
        continue;
      }

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

    return result;
  }, [allReceivables]);

  // Sorted and filtered project summaries
  const sortedProjects = useMemo(() => {
    let filtered = [...projectSummaries];

    // Apply search filter
    if (tableSearch) {
      const q = tableSearch.toLowerCase();
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.clientName && p.clientName.toLowerCase().includes(q))
      );
    }

    // Apply sorting
    return filtered.sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;

      switch (projectSortKey) {
        case 'name':
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case 'paid':
          aVal = a.paidIncomeMinor;
          bVal = b.paidIncomeMinor;
          break;
        case 'unpaid':
          aVal = a.unpaidIncomeMinor;
          bVal = b.unpaidIncomeMinor;
          break;
        case 'expenses':
          aVal = a.expensesMinor;
          bVal = b.expensesMinor;
          break;
        case 'net':
          aVal = a.netMinor;
          bVal = b.netMinor;
          break;
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return projectSortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return projectSortDir === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
  }, [projectSummaries, tableSearch, projectSortKey, projectSortDir]);

  // Sorted and filtered client summaries
  const sortedClients = useMemo(() => {
    let filtered = [...clientSummaries];

    // Apply search filter
    if (tableSearch) {
      const q = tableSearch.toLowerCase();
      filtered = filtered.filter(c => c.name.toLowerCase().includes(q));
    }

    // Apply sorting
    return filtered.sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;

      switch (clientSortKey) {
        case 'name':
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case 'paid':
          aVal = a.paidIncomeMinor;
          bVal = b.paidIncomeMinor;
          break;
        case 'unpaid':
          aVal = a.unpaidIncomeMinor;
          bVal = b.unpaidIncomeMinor;
          break;
        case 'projects':
          aVal = a.activeProjectCount;
          bVal = b.activeProjectCount;
          break;
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return clientSortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return clientSortDir === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
  }, [clientSummaries, tableSearch, clientSortKey, clientSortDir]);

  // Handle KPI drill-down
  const handleDrillDown = (metric: 'paidIncome' | 'unpaidIncome' | 'expenses', currency: Currency) => {
    const params = new URLSearchParams();
    params.set('dateFrom', dateRange.dateFrom);
    params.set('dateTo', dateRange.dateTo);
    params.set('currency', currency);

    switch (metric) {
      case 'paidIncome':
        params.set('kind', 'income');
        params.set('status', 'paid');
        break;
      case 'unpaidIncome':
        params.set('kind', 'income');
        params.set('status', 'unpaid');
        break;
      case 'expenses':
        params.set('kind', 'expense');
        break;
    }

    navigate({ to: '/transactions', search: Object.fromEntries(params) });
  };

  // Handle project sort
  const handleProjectSort = (key: typeof projectSortKey) => {
    if (projectSortKey === key) {
      setProjectSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setProjectSortKey(key);
      setProjectSortDir('desc');
    }
  };

  // Handle client sort
  const handleClientSort = (key: typeof clientSortKey) => {
    if (clientSortKey === key) {
      setClientSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setClientSortKey(key);
      setClientSortDir('desc');
    }
  };

  // Handle period change
  const handlePeriodChange = (newPeriod: PeriodPreset) => {
    setPeriod(newPeriod);
    if (newPeriod === 'month') {
      setDateRange(getDateRangePreset('this-month'));
    } else if (newPeriod === 'quarter') {
      // Calculate current quarter
      const now = new Date();
      const q = Math.floor(now.getMonth() / 3);
      const startMonth = q * 3;
      const startDate = new Date(year, startMonth, 1);
      const endDate = new Date(year, startMonth + 3, 0);
      setDateRange({
        dateFrom: startDate.toISOString().split('T')[0],
        dateTo: endDate.toISOString().split('T')[0],
      });
    } else if (newPeriod === 'year') {
      setDateRange({
        dateFrom: `${year}-01-01`,
        dateTo: `${year}-12-31`,
      });
    }
  };

  // Handle year change
  const handleYearChange = (delta: number) => {
    const newYear = year + delta;
    setYear(newYear);
    if (period === 'year') {
      setDateRange({
        dateFrom: `${newYear}-01-01`,
        dateTo: `${newYear}-12-31`,
      });
    } else if (period === 'quarter') {
      const now = new Date();
      const q = Math.floor(now.getMonth() / 3);
      const startMonth = q * 3;
      const startDate = new Date(newYear, startMonth, 1);
      const endDate = new Date(newYear, startMonth + 3, 0);
      setDateRange({
        dateFrom: startDate.toISOString().split('T')[0],
        dateTo: endDate.toISOString().split('T')[0],
      });
    }
  };

  // CSV Export
  const handleExportCSV = () => {
    const lines: string[] = [];

    // Metadata header
    lines.push(`# Report: ${reportType}`);
    lines.push(`# Period: ${period}${period === 'year' ? ` ${year}` : ''}`);
    lines.push(`# Date range: ${dateRange.dateFrom} to ${dateRange.dateTo}`);
    lines.push(`# Currency: ${currencyMode}`);
    lines.push('');

    const generateSummaryCSV = (data: SummaryData, currency: Currency) => {
      return [
        'Metric,Amount,Currency',
        `Paid Income,${(data.paidIncome / 100).toFixed(2)},${currency}`,
        `Unpaid Receivables,${(data.unpaidIncome / 100).toFixed(2)},${currency}`,
        `Expenses,${(data.expenses / 100).toFixed(2)},${currency}`,
        `Net,${(data.net / 100).toFixed(2)},${currency}`,
      ].join('\n');
    };

    const generateProjectsCSV = () => {
      const header = 'Project,Client,Paid,Unpaid,Expenses,Net';
      const rows = sortedProjects.map(p =>
        `"${p.name}","${p.clientName || ''}",${(p.paidIncomeMinor / 100).toFixed(2)},${(p.unpaidIncomeMinor / 100).toFixed(2)},${(p.expensesMinor / 100).toFixed(2)},${(p.netMinor / 100).toFixed(2)}`
      );
      return [header, ...rows].join('\n');
    };

    const generateClientsCSV = () => {
      const header = 'Client,Projects,Paid,Unpaid';
      const rows = sortedClients.map(c =>
        `"${c.name}",${c.activeProjectCount},${(c.paidIncomeMinor / 100).toFixed(2)},${(c.unpaidIncomeMinor / 100).toFixed(2)}`
      );
      return [header, ...rows].join('\n');
    };

    const generateExpensesCategoryCSV = (expenses: Array<{ category: string; amount: number }>, currency: Currency) => {
      const header = 'Category,Amount,Currency';
      const rows = expenses.map(e => `"${e.category}",${(e.amount / 100).toFixed(2)},${currency}`);
      return [header, ...rows].join('\n');
    };

    const generateAgingCSV = (aging: { current: number; '1-30': number; '31-60': number; '60+': number }, currency: Currency) => {
      return [
        'Period,Amount,Currency',
        `Current (not due),${(aging.current / 100).toFixed(2)},${currency}`,
        `1-30 days,${(aging['1-30'] / 100).toFixed(2)},${currency}`,
        `31-60 days,${(aging['31-60'] / 100).toFixed(2)},${currency}`,
        `60+ days,${(aging['60+'] / 100).toFixed(2)},${currency}`,
      ].join('\n');
    };

    switch (reportType) {
      case 'summary': {
        if (currencyMode === 'BOTH') {
          lines.push('## USD');
          lines.push(generateSummaryCSV(summaryByCurrency.USD, 'USD'));
          lines.push('');
          lines.push('## ILS');
          lines.push(generateSummaryCSV(summaryByCurrency.ILS, 'ILS'));
        } else {
          lines.push(generateSummaryCSV(singleCurrencySummary, currencyMode));
        }
        break;
      }
      case 'by-project': {
        lines.push(generateProjectsCSV());
        break;
      }
      case 'by-client': {
        lines.push(generateClientsCSV());
        break;
      }
      case 'expenses-by-category': {
        if (currencyMode === 'BOTH') {
          lines.push('## USD');
          lines.push(generateExpensesCategoryCSV(expensesByCurrencyAndCategory.USD, 'USD'));
          lines.push('');
          lines.push('## ILS');
          lines.push(generateExpensesCategoryCSV(expensesByCurrencyAndCategory.ILS, 'ILS'));
        } else {
          lines.push(generateExpensesCategoryCSV(expensesByCurrencyAndCategory[currencyMode], currencyMode));
        }
        break;
      }
      case 'unpaid-aging': {
        if (currencyMode === 'BOTH') {
          lines.push('## USD');
          lines.push(generateAgingCSV(unpaidAgingByCurrency.USD, 'USD'));
          lines.push('');
          lines.push('## ILS');
          lines.push(generateAgingCSV(unpaidAgingByCurrency.ILS, 'ILS'));
        } else {
          lines.push(generateAgingCSV(unpaidAgingByCurrency[currencyMode], currencyMode));
        }
        break;
      }
    }

    const filename = `${reportType}-${dateRange.dateFrom}-${currencyMode}.csv`;
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reports: { type: ReportType; labelKey: string }[] = [
    { type: 'summary', labelKey: 'reports.presets.summary' },
    { type: 'by-project', labelKey: 'reports.presets.byProject' },
    { type: 'by-client', labelKey: 'reports.presets.byClient' },
    { type: 'expenses-by-category', labelKey: 'reports.presets.expensesByCategory' },
    { type: 'unpaid-aging', labelKey: 'reports.presets.unpaidAging' },
  ];

  // Render KPI row for a single currency
  const renderKpiRow = (data: SummaryData, currency: Currency) => (
    <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
      <button
        className="kpi-card clickable"
        onClick={() => handleDrillDown('paidIncome', currency)}
        aria-label={t('reports.drillDown.paidIncome')}
      >
        <div className="kpi-label">{t('overview.kpi.paidIncome')}</div>
        <div className="kpi-value positive">{formatAmount(data.paidIncome, currency, locale)}</div>
      </button>
      <button
        className="kpi-card clickable"
        onClick={() => handleDrillDown('unpaidIncome', currency)}
        aria-label={t('reports.drillDown.unpaidIncome')}
      >
        <div className="kpi-label">{t('overview.kpi.unpaidReceivables')}</div>
        <div className="kpi-value warning">{formatAmount(data.unpaidIncome, currency, locale)}</div>
      </button>
      <button
        className="kpi-card clickable"
        onClick={() => handleDrillDown('expenses', currency)}
        aria-label={t('reports.drillDown.expenses')}
      >
        <div className="kpi-label">{t('overview.kpi.expenses')}</div>
        <div className="kpi-value">{formatAmount(data.expenses, currency, locale)}</div>
      </button>
      <div className="kpi-card">
        <div className="kpi-label">{t('projects.columns.net')}</div>
        <div className={cn('kpi-value', data.net >= 0 ? 'positive' : 'negative')}>
          {formatAmount(data.net, currency, locale)}
        </div>
      </div>
    </div>
  );

  // Render aging KPI row for a single currency
  const renderAgingKpiRow = (aging: { current: number; '1-30': number; '31-60': number; '60+': number }, currency: Currency) => (
    <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
      <div className="kpi-card">
        <div className="kpi-label">{t('reports.aging.current')}</div>
        <div className="kpi-value">{formatAmount(aging.current, currency, locale)}</div>
      </div>
      <div className="kpi-card">
        <div className="kpi-label">{t('reports.aging.days1to30')}</div>
        <div className="kpi-value warning">{formatAmount(aging['1-30'], currency, locale)}</div>
      </div>
      <div className="kpi-card">
        <div className="kpi-label">{t('reports.aging.days31to60')}</div>
        <div className="kpi-value" style={{ color: 'var(--color-danger)' }}>{formatAmount(aging['31-60'], currency, locale)}</div>
      </div>
      <div className="kpi-card">
        <div className="kpi-label">{t('reports.aging.days60plus')}</div>
        <div className="kpi-value negative">{formatAmount(aging['60+'], currency, locale)}</div>
      </div>
    </div>
  );

  // Render sort indicator
  const renderSortIndicator = (isActive: boolean, dir: 'asc' | 'desc') => {
    if (!isActive) return null;
    return <span className="sort-icon">{dir === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <>
      <TopBar title={t('reports.title')} />
      <div className="page-content">
        <div className="reports-layout">
          {/* Sidebar */}
          <div className="reports-sidebar">
            <div className="reports-sidebar-title">{t('reports.title')}</div>
            {reports.map((r) => (
              <button
                key={r.type}
                className={cn('report-preset', reportType === r.type && 'active')}
                onClick={() => {
                  setReportType(r.type);
                  setTableSearch('');
                }}
                aria-current={reportType === r.type ? 'page' : undefined}
              >
                {t(r.labelKey)}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="reports-content">
            {/* Controls */}
            <div className="filters-row" style={{ marginBottom: 24 }}>
              {reportType === 'summary' && (
                <div className="period-control">
                  <div className="segment-control">
                    <button
                      className={cn('segment-button', period === 'month' && 'active')}
                      onClick={() => handlePeriodChange('month')}
                    >
                      {t('reports.period.month')}
                    </button>
                    <button
                      className={cn('segment-button', period === 'quarter' && 'active')}
                      onClick={() => handlePeriodChange('quarter')}
                    >
                      {t('reports.period.quarter')}
                    </button>
                    <button
                      className={cn('segment-button', period === 'year' && 'active')}
                      onClick={() => handlePeriodChange('year')}
                    >
                      {t('reports.period.year')}
                    </button>
                  </div>
                  {(period === 'year' || period === 'quarter') && (
                    <div className="year-stepper">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleYearChange(-1)}
                        aria-label={t('common.previous')}
                      >
                        ←
                      </button>
                      <span className="year-display">{year}</span>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleYearChange(1)}
                        aria-label={t('common.next')}
                        disabled={year >= new Date().getFullYear()}
                      >
                        →
                      </button>
                    </div>
                  )}
                </div>
              )}

              {reportType === 'expenses-by-category' && (
                <div className="period-control">
                  <div className="segment-control">
                    <button
                      className={cn('segment-button', period === 'month' && 'active')}
                      onClick={() => handlePeriodChange('month')}
                    >
                      {t('reports.period.month')}
                    </button>
                    <button
                      className={cn('segment-button', period === 'quarter' && 'active')}
                      onClick={() => handlePeriodChange('quarter')}
                    >
                      {t('reports.period.quarter')}
                    </button>
                    <button
                      className={cn('segment-button', period === 'year' && 'active')}
                      onClick={() => handlePeriodChange('year')}
                    >
                      {t('reports.period.year')}
                    </button>
                  </div>
                  {(period === 'year' || period === 'quarter') && (
                    <div className="year-stepper">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleYearChange(-1)}
                        aria-label={t('common.previous')}
                      >
                        ←
                      </button>
                      <span className="year-display">{year}</span>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleYearChange(1)}
                        aria-label={t('common.next')}
                        disabled={year >= new Date().getFullYear()}
                      >
                        →
                      </button>
                    </div>
                  )}
                </div>
              )}

              <CurrencyModeTabs value={currencyMode} onChange={setCurrencyMode} />

              {(reportType === 'by-project' || reportType === 'by-client') && (
                <SearchInput
                  value={tableSearch}
                  onChange={setTableSearch}
                  placeholder={reportType === 'by-project' ? t('reports.search.project') : t('reports.search.client')}
                />
              )}

              <button className="btn btn-secondary" onClick={handleExportCSV}>
                {t('reports.exportCsv')}
              </button>
            </div>

            {/* Date range display */}
            {(reportType === 'summary' || reportType === 'expenses-by-category') && (
              <div className="date-range-display" style={{ marginBottom: 16, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                {dateRange.dateFrom} → {dateRange.dateTo}
              </div>
            )}

            {/* Report Content */}
            {reportType === 'summary' && (
              <div>
                <h3 style={{ marginBottom: 16 }}>{t('reports.sections.financialSummary')}</h3>
                {currencyMode === 'BOTH' ? (
                  <>
                    <div className="currency-section" style={{ marginBottom: 24 }}>
                      <h4 style={{ marginBottom: 12, fontSize: 'var(--font-size-md)', fontWeight: 500 }}>USD</h4>
                      {renderKpiRow(summaryByCurrency.USD, 'USD')}
                    </div>
                    <div className="currency-section">
                      <h4 style={{ marginBottom: 12, fontSize: 'var(--font-size-md)', fontWeight: 500 }}>ILS</h4>
                      {renderKpiRow(summaryByCurrency.ILS, 'ILS')}
                    </div>
                  </>
                ) : (
                  renderKpiRow(singleCurrencySummary, currencyMode)
                )}
              </div>
            )}

            {reportType === 'by-project' && (
              <div>
                <h3 style={{ marginBottom: 16 }}>{t('reports.sections.incomeByProject')}</h3>
                {sortedProjects.length === 0 ? (
                  <div className="empty-state">
                    <p className="text-muted">{tableSearch ? t('common.noResults') : t('projects.empty')}</p>
                  </div>
                ) : (
                  <div className="data-table">
                    <table>
                      <thead>
                        <tr>
                          <th className="sortable" onClick={() => handleProjectSort('name')}>
                            {t('projects.columns.project')}
                            {renderSortIndicator(projectSortKey === 'name', projectSortDir)}
                          </th>
                          <th>{t('projects.columns.client')}</th>
                          <th className="sortable" style={{ textAlign: 'end' }} onClick={() => handleProjectSort('paid')}>
                            {t('projects.columns.paid')}
                            {renderSortIndicator(projectSortKey === 'paid', projectSortDir)}
                          </th>
                          <th className="sortable" style={{ textAlign: 'end' }} onClick={() => handleProjectSort('unpaid')}>
                            {t('projects.columns.unpaid')}
                            {renderSortIndicator(projectSortKey === 'unpaid', projectSortDir)}
                          </th>
                          <th className="sortable" style={{ textAlign: 'end' }} onClick={() => handleProjectSort('expenses')}>
                            {t('projects.columns.expenses')}
                            {renderSortIndicator(projectSortKey === 'expenses', projectSortDir)}
                          </th>
                          <th className="sortable" style={{ textAlign: 'end' }} onClick={() => handleProjectSort('net')}>
                            {t('projects.columns.net')}
                            {renderSortIndicator(projectSortKey === 'net', projectSortDir)}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedProjects.map((p) => (
                          <tr key={p.id}>
                            <td style={{ fontWeight: 500 }}>{p.name}</td>
                            <td className="text-secondary">{p.clientName || '-'}</td>
                            <td className="amount-cell amount-positive">
                              {currencyMode === 'BOTH' ? '-' : formatAmount(p.paidIncomeMinor, currencyMode, locale)}
                            </td>
                            <td className="amount-cell" style={{ color: 'var(--color-warning)' }}>
                              {currencyMode === 'BOTH' ? '-' : formatAmount(p.unpaidIncomeMinor, currencyMode, locale)}
                            </td>
                            <td className="amount-cell">
                              {currencyMode === 'BOTH' ? '-' : formatAmount(p.expensesMinor, currencyMode, locale)}
                            </td>
                            <td className={cn('amount-cell', p.netMinor >= 0 ? 'amount-positive' : 'amount-negative')}>
                              {currencyMode === 'BOTH' ? '-' : formatAmount(p.netMinor, currencyMode, locale)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {currencyMode === 'BOTH' && (
                  <p className="text-muted" style={{ marginTop: 12, fontSize: 'var(--font-size-sm)' }}>
                    {t('reports.selectCurrencyForAmounts')}
                  </p>
                )}
              </div>
            )}

            {reportType === 'by-client' && (
              <div>
                <h3 style={{ marginBottom: 16 }}>{t('reports.sections.incomeByClient')}</h3>
                {sortedClients.length === 0 ? (
                  <div className="empty-state">
                    <p className="text-muted">{tableSearch ? t('common.noResults') : t('clients.empty')}</p>
                  </div>
                ) : (
                  <div className="data-table">
                    <table>
                      <thead>
                        <tr>
                          <th className="sortable" onClick={() => handleClientSort('name')}>
                            {t('clients.columns.client')}
                            {renderSortIndicator(clientSortKey === 'name', clientSortDir)}
                          </th>
                          <th className="sortable" onClick={() => handleClientSort('projects')}>
                            {t('clients.tabs.projects')}
                            {renderSortIndicator(clientSortKey === 'projects', clientSortDir)}
                          </th>
                          <th className="sortable" style={{ textAlign: 'end' }} onClick={() => handleClientSort('paid')}>
                            {t('projects.columns.paid')}
                            {renderSortIndicator(clientSortKey === 'paid', clientSortDir)}
                          </th>
                          <th className="sortable" style={{ textAlign: 'end' }} onClick={() => handleClientSort('unpaid')}>
                            {t('projects.columns.unpaid')}
                            {renderSortIndicator(clientSortKey === 'unpaid', clientSortDir)}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedClients.map((c) => (
                          <tr key={c.id}>
                            <td style={{ fontWeight: 500 }}>{c.name}</td>
                            <td className="text-secondary">{c.activeProjectCount}</td>
                            <td className="amount-cell amount-positive">
                              {currencyMode === 'BOTH' ? '-' : formatAmount(c.paidIncomeMinor, currencyMode, locale)}
                            </td>
                            <td className="amount-cell" style={{ color: 'var(--color-warning)' }}>
                              {currencyMode === 'BOTH' ? '-' : formatAmount(c.unpaidIncomeMinor, currencyMode, locale)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {currencyMode === 'BOTH' && (
                  <p className="text-muted" style={{ marginTop: 12, fontSize: 'var(--font-size-sm)' }}>
                    {t('reports.selectCurrencyForAmounts')}
                  </p>
                )}
              </div>
            )}

            {reportType === 'expenses-by-category' && (
              <div>
                <h3 style={{ marginBottom: 16 }}>{t('reports.sections.expensesByCategory')}</h3>
                {currencyMode === 'BOTH' ? (
                  <>
                    <div className="currency-section" style={{ marginBottom: 24 }}>
                      <h4 style={{ marginBottom: 12, fontSize: 'var(--font-size-md)', fontWeight: 500 }}>USD</h4>
                      {expensesByCurrencyAndCategory.USD.length === 0 ? (
                        <div className="empty-state">
                          <p className="text-muted">{t('reports.noExpenses')}</p>
                        </div>
                      ) : (
                        <div className="data-table">
                          <table>
                            <thead>
                              <tr>
                                <th>{t('transactions.columns.category')}</th>
                                <th style={{ textAlign: 'end' }}>{t('transactions.columns.amount')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {expensesByCurrencyAndCategory.USD.map((e) => (
                                <tr key={e.category}>
                                  <td style={{ fontWeight: 500 }}>{e.category}</td>
                                  <td className="amount-cell">{formatAmount(e.amount, 'USD', locale)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                    <div className="currency-section">
                      <h4 style={{ marginBottom: 12, fontSize: 'var(--font-size-md)', fontWeight: 500 }}>ILS</h4>
                      {expensesByCurrencyAndCategory.ILS.length === 0 ? (
                        <div className="empty-state">
                          <p className="text-muted">{t('reports.noExpenses')}</p>
                        </div>
                      ) : (
                        <div className="data-table">
                          <table>
                            <thead>
                              <tr>
                                <th>{t('transactions.columns.category')}</th>
                                <th style={{ textAlign: 'end' }}>{t('transactions.columns.amount')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {expensesByCurrencyAndCategory.ILS.map((e) => (
                                <tr key={e.category}>
                                  <td style={{ fontWeight: 500 }}>{e.category}</td>
                                  <td className="amount-cell">{formatAmount(e.amount, 'ILS', locale)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  expensesByCurrencyAndCategory[currencyMode].length === 0 ? (
                    <div className="empty-state">
                      <p className="text-muted">{t('reports.noExpenses')}</p>
                    </div>
                  ) : (
                    <div className="data-table">
                      <table>
                        <thead>
                          <tr>
                            <th>{t('transactions.columns.category')}</th>
                            <th style={{ textAlign: 'end' }}>{t('transactions.columns.amount')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {expensesByCurrencyAndCategory[currencyMode].map((e) => (
                            <tr key={e.category}>
                              <td style={{ fontWeight: 500 }}>{e.category}</td>
                              <td className="amount-cell">{formatAmount(e.amount, currencyMode, locale)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                )}
              </div>
            )}

            {reportType === 'unpaid-aging' && (
              <div>
                <h3 style={{ marginBottom: 16 }}>{t('reports.sections.unpaidAging')}</h3>
                {currencyMode === 'BOTH' ? (
                  <>
                    <div className="currency-section" style={{ marginBottom: 24 }}>
                      <h4 style={{ marginBottom: 12, fontSize: 'var(--font-size-md)', fontWeight: 500 }}>USD</h4>
                      {renderAgingKpiRow(unpaidAgingByCurrency.USD, 'USD')}
                    </div>
                    <div className="currency-section">
                      <h4 style={{ marginBottom: 12, fontSize: 'var(--font-size-md)', fontWeight: 500 }}>ILS</h4>
                      {renderAgingKpiRow(unpaidAgingByCurrency.ILS, 'ILS')}
                    </div>
                  </>
                ) : (
                  renderAgingKpiRow(unpaidAgingByCurrency[currencyMode], currencyMode)
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
