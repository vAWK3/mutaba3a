import { useState, useMemo } from 'react';
import { TopBar } from '../../components/layout';
import { DateRangeControl, SearchInput } from '../../components/filters';
import { EmptyState } from '../../components/ui';
import { DownloadIcon } from '../../components/icons';
import {
  useTransactions,
  useProjectSummaries,
  useClientSummaries,
} from '../../hooks/useQueries';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import { formatAmount, getDateRangePreset, cn, getDaysUntil } from '../../lib/utils';
import type { ReportType, CurrencyMode, Currency, TransactionDisplay } from '../../types';

// Report type options
const REPORT_TYPES: { value: ReportType; labelKey: string }[] = [
  { value: 'summary', labelKey: 'reports.presets.summary' },
  { value: 'by-project', labelKey: 'reports.presets.byProject' },
  { value: 'by-client', labelKey: 'reports.presets.byClient' },
  { value: 'expenses-by-project', labelKey: 'reports.presets.expensesByProject' },
  { value: 'unpaid-aging', labelKey: 'reports.presets.unpaidAging' },
];

// Currency mode options
const CURRENCY_MODES: { value: CurrencyMode; labelKey: string }[] = [
  { value: 'USD', labelKey: 'reports.currencyMode.usd' },
  { value: 'ILS', labelKey: 'reports.currencyMode.ils' },
  { value: 'BOTH', labelKey: 'reports.currencyMode.both' },
];

// Aging bucket helpers
interface AgingBucket {
  label: string;
  minDays: number;
  maxDays: number | null;
  transactions: TransactionDisplay[];
  totalMinorUSD: number;
  totalMinorILS: number;
}

function calculateAgingBuckets(transactions: TransactionDisplay[], t: (key: string) => string): AgingBucket[] {
  const buckets: AgingBucket[] = [
    { label: t('reports.aging.current'), minDays: -Infinity, maxDays: 0, transactions: [], totalMinorUSD: 0, totalMinorILS: 0 },
    { label: t('reports.aging.days1to30'), minDays: 1, maxDays: 30, transactions: [], totalMinorUSD: 0, totalMinorILS: 0 },
    { label: t('reports.aging.days31to60'), minDays: 31, maxDays: 60, transactions: [], totalMinorUSD: 0, totalMinorILS: 0 },
    { label: t('reports.aging.days60plus'), minDays: 61, maxDays: null, transactions: [], totalMinorUSD: 0, totalMinorILS: 0 },
  ];

  for (const tx of transactions) {
    if (tx.kind !== 'income' || tx.status !== 'unpaid') continue;

    const daysOverdue = tx.dueDate ? -getDaysUntil(tx.dueDate) : 0;

    for (const bucket of buckets) {
      const inRange = daysOverdue >= bucket.minDays &&
        (bucket.maxDays === null || daysOverdue <= bucket.maxDays);

      if (inRange) {
        bucket.transactions.push(tx);
        if (tx.currency === 'USD') {
          bucket.totalMinorUSD += tx.amountMinor;
        } else if (tx.currency === 'ILS') {
          bucket.totalMinorILS += tx.amountMinor;
        }
        break;
      }
    }
  }

  return buckets;
}

// CSV export helper
function exportToCsv(data: Record<string, unknown>[], filename: string) {
  if (data.length === 0) return;

  const headers = Object.keys(data[0]);
  const csvContent = [
    headers.join(','),
    ...data.map(row =>
      headers.map(h => {
        const val = row[h];
        if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return String(val ?? '');
      }).join(',')
    )
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function ReportsPage() {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);

  // State
  const [reportType, setReportType] = useState<ReportType>('summary');
  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>('BOTH');
  const [dateRange, setDateRange] = useState(() => getDateRangePreset('this-month'));
  const [search, setSearch] = useState('');

  // Query filters
  const currencyFilter: Currency | undefined = currencyMode === 'BOTH' ? undefined : currencyMode;

  // Fetch data
  const { data: transactions = [], isLoading: txLoading } = useTransactions({
    dateFrom: dateRange.dateFrom,
    dateTo: dateRange.dateTo,
    currency: currencyFilter,
  });

  const { data: projectSummaries = [], isLoading: projLoading } = useProjectSummaries(currencyFilter, search);
  const { data: clientSummaries = [], isLoading: clientLoading } = useClientSummaries(currencyFilter, search);

  const isLoading = txLoading || projLoading || clientLoading;

  // Calculate summary totals
  const summaryTotals = useMemo(() => {
    const result = {
      paidIncomeUSD: 0,
      paidIncomeILS: 0,
      unpaidIncomeUSD: 0,
      unpaidIncomeILS: 0,
      expensesUSD: 0,
      expensesILS: 0,
    };

    for (const tx of transactions) {
      if (tx.kind === 'income') {
        if (tx.status === 'paid') {
          if (tx.currency === 'USD') result.paidIncomeUSD += tx.amountMinor;
          else if (tx.currency === 'ILS') result.paidIncomeILS += tx.amountMinor;
        } else {
          if (tx.currency === 'USD') result.unpaidIncomeUSD += tx.amountMinor;
          else if (tx.currency === 'ILS') result.unpaidIncomeILS += tx.amountMinor;
        }
      } else {
        if (tx.currency === 'USD') result.expensesUSD += tx.amountMinor;
        else if (tx.currency === 'ILS') result.expensesILS += tx.amountMinor;
      }
    }

    return result;
  }, [transactions]);

  // Aging buckets for unpaid aging report
  const agingBuckets = useMemo(() => {
    if (reportType !== 'unpaid-aging') return [];
    return calculateAgingBuckets(transactions, t);
  }, [transactions, reportType, t]);

  // Filter project summaries for expenses report
  const projectsWithExpenses = useMemo(() => {
    return projectSummaries.filter(p => {
      if (currencyMode === 'USD') return p.expensesMinorUSD && p.expensesMinorUSD > 0;
      if (currencyMode === 'ILS') return p.expensesMinorILS && p.expensesMinorILS > 0;
      return (p.expensesMinorUSD && p.expensesMinorUSD > 0) ||
             (p.expensesMinorILS && p.expensesMinorILS > 0);
    });
  }, [projectSummaries, currencyMode]);

  // Export handlers
  const handleExportCsv = () => {
    switch (reportType) {
      case 'summary': {
        const data = [
          {
            Category: 'Paid Income',
            USD: summaryTotals.paidIncomeUSD / 100,
            ILS: summaryTotals.paidIncomeILS / 100
          },
          {
            Category: 'Unpaid Receivables',
            USD: summaryTotals.unpaidIncomeUSD / 100,
            ILS: summaryTotals.unpaidIncomeILS / 100
          },
          {
            Category: 'Expenses',
            USD: summaryTotals.expensesUSD / 100,
            ILS: summaryTotals.expensesILS / 100
          },
          {
            Category: 'Net (Paid - Expenses)',
            USD: (summaryTotals.paidIncomeUSD - summaryTotals.expensesUSD) / 100,
            ILS: (summaryTotals.paidIncomeILS - summaryTotals.expensesILS) / 100
          },
        ];
        exportToCsv(data, `summary-${dateRange.dateFrom}-${dateRange.dateTo}`);
        break;
      }
      case 'by-project': {
        const data = projectSummaries.map(p => ({
          Project: p.name,
          Client: p.clientName || '',
          Field: p.field || '',
          'Paid USD': (p.paidIncomeMinorUSD || 0) / 100,
          'Paid ILS': (p.paidIncomeMinorILS || 0) / 100,
          'Unpaid USD': (p.unpaidIncomeMinorUSD || 0) / 100,
          'Unpaid ILS': (p.unpaidIncomeMinorILS || 0) / 100,
        }));
        exportToCsv(data, `by-project-${dateRange.dateFrom}-${dateRange.dateTo}`);
        break;
      }
      case 'by-client': {
        const data = clientSummaries.map(c => ({
          Client: c.name,
          'Active Projects': c.activeProjectCount,
          'Paid USD': (c.paidIncomeMinorUSD || 0) / 100,
          'Paid ILS': (c.paidIncomeMinorILS || 0) / 100,
          'Unpaid USD': (c.unpaidIncomeMinorUSD || 0) / 100,
          'Unpaid ILS': (c.unpaidIncomeMinorILS || 0) / 100,
        }));
        exportToCsv(data, `by-client-${dateRange.dateFrom}-${dateRange.dateTo}`);
        break;
      }
      case 'expenses-by-project': {
        const data = projectsWithExpenses.map(p => ({
          Project: p.name,
          Client: p.clientName || '',
          'Expenses USD': (p.expensesMinorUSD || 0) / 100,
          'Expenses ILS': (p.expensesMinorILS || 0) / 100,
        }));
        exportToCsv(data, `expenses-by-project-${dateRange.dateFrom}-${dateRange.dateTo}`);
        break;
      }
      case 'unpaid-aging': {
        const data = agingBuckets.flatMap(bucket =>
          bucket.transactions.map(tx => ({
            Bucket: bucket.label,
            Client: tx.clientName || '',
            Project: tx.projectName || '',
            Amount: tx.amountMinor / 100,
            Currency: tx.currency,
            'Due Date': tx.dueDate || '',
            'Days Overdue': tx.dueDate ? -getDaysUntil(tx.dueDate) : 0,
          }))
        );
        exportToCsv(data, `unpaid-aging-${dateRange.dateFrom}-${dateRange.dateTo}`);
        break;
      }
    }
  };

  // Format amount based on currency mode
  const formatReportAmount = (minorUSD: number, minorILS: number) => {
    if (currencyMode === 'USD') {
      return formatAmount(minorUSD, 'USD', locale);
    }
    if (currencyMode === 'ILS') {
      return formatAmount(minorILS, 'ILS', locale);
    }
    // Both currencies
    const parts: string[] = [];
    if (minorUSD > 0) parts.push(formatAmount(minorUSD, 'USD', locale));
    if (minorILS > 0) parts.push(formatAmount(minorILS, 'ILS', locale));
    return parts.length > 0 ? parts.join(' / ') : '-';
  };

  // Render report content based on type
  const renderReportContent = () => {
    if (isLoading) {
      return (
        <div className="loading">
          <div className="spinner" />
        </div>
      );
    }

    switch (reportType) {
      case 'summary':
        return renderSummaryReport();
      case 'by-project':
        return renderByProjectReport();
      case 'by-client':
        return renderByClientReport();
      case 'expenses-by-project':
        return renderExpensesByProjectReport();
      case 'unpaid-aging':
        return renderUnpaidAgingReport();
      default:
        return null;
    }
  };

  const renderSummaryReport = () => {
    const netUSD = summaryTotals.paidIncomeUSD - summaryTotals.expensesUSD;
    const netILS = summaryTotals.paidIncomeILS - summaryTotals.expensesILS;

    return (
      <div className="report-section">
        <h3 className="section-title">{t('reports.sections.financialSummary')}</h3>
        <div className="data-table">
          <table>
            <thead>
              <tr>
                <th>{t('transactions.columns.category')}</th>
                {(currencyMode === 'USD' || currencyMode === 'BOTH') && <th style={{ textAlign: 'end' }}>USD</th>}
                {(currencyMode === 'ILS' || currencyMode === 'BOTH') && <th style={{ textAlign: 'end' }}>ILS</th>}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{t('overview.kpi.paidIncome')}</td>
                {(currencyMode === 'USD' || currencyMode === 'BOTH') && (
                  <td className="amount-cell amount-positive">
                    {formatAmount(summaryTotals.paidIncomeUSD, 'USD', locale)}
                  </td>
                )}
                {(currencyMode === 'ILS' || currencyMode === 'BOTH') && (
                  <td className="amount-cell amount-positive">
                    {formatAmount(summaryTotals.paidIncomeILS, 'ILS', locale)}
                  </td>
                )}
              </tr>
              <tr>
                <td>{t('overview.kpi.unpaidReceivables')}</td>
                {(currencyMode === 'USD' || currencyMode === 'BOTH') && (
                  <td className="amount-cell">{formatAmount(summaryTotals.unpaidIncomeUSD, 'USD', locale)}</td>
                )}
                {(currencyMode === 'ILS' || currencyMode === 'BOTH') && (
                  <td className="amount-cell">{formatAmount(summaryTotals.unpaidIncomeILS, 'ILS', locale)}</td>
                )}
              </tr>
              <tr>
                <td>{t('overview.kpi.expenses')}</td>
                {(currencyMode === 'USD' || currencyMode === 'BOTH') && (
                  <td className="amount-cell amount-negative">
                    -{formatAmount(summaryTotals.expensesUSD, 'USD', locale)}
                  </td>
                )}
                {(currencyMode === 'ILS' || currencyMode === 'BOTH') && (
                  <td className="amount-cell amount-negative">
                    -{formatAmount(summaryTotals.expensesILS, 'ILS', locale)}
                  </td>
                )}
              </tr>
              <tr style={{ fontWeight: 600, borderTop: '2px solid var(--color-border)' }}>
                <td>{t('overview.kpi.net')}</td>
                {(currencyMode === 'USD' || currencyMode === 'BOTH') && (
                  <td className={cn('amount-cell', netUSD >= 0 ? 'amount-positive' : 'amount-negative')}>
                    {formatAmount(netUSD, 'USD', locale)}
                  </td>
                )}
                {(currencyMode === 'ILS' || currencyMode === 'BOTH') && (
                  <td className={cn('amount-cell', netILS >= 0 ? 'amount-positive' : 'amount-negative')}>
                    {formatAmount(netILS, 'ILS', locale)}
                  </td>
                )}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderByProjectReport = () => {
    const filteredProjects = search
      ? projectSummaries.filter(p =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.clientName?.toLowerCase().includes(search.toLowerCase())
        )
      : projectSummaries;

    if (filteredProjects.length === 0) {
      return <EmptyState title={t('projects.empty')} description={search ? t('projects.emptySearch') : t('projects.emptyHint')} />;
    }

    return (
      <div className="report-section">
        <h3 className="section-title">{t('reports.sections.incomeByProject')}</h3>
        <div className="data-table">
          <table>
            <thead>
              <tr>
                <th>{t('projects.columns.project')}</th>
                <th>{t('projects.columns.client')}</th>
                <th>{t('projects.columns.field')}</th>
                <th style={{ textAlign: 'end' }}>{t('projects.columns.paid')}</th>
                <th style={{ textAlign: 'end' }}>{t('projects.columns.unpaid')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map(p => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="text-secondary">{p.clientName || '-'}</td>
                  <td className="text-secondary">{p.field ? t(`projects.fields.${p.field.toLowerCase()}`) : '-'}</td>
                  <td className="amount-cell amount-positive">
                    {formatReportAmount(p.paidIncomeMinorUSD || 0, p.paidIncomeMinorILS || 0)}
                  </td>
                  <td className="amount-cell">
                    {formatReportAmount(p.unpaidIncomeMinorUSD || 0, p.unpaidIncomeMinorILS || 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderByClientReport = () => {
    const filteredClients = search
      ? clientSummaries.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
      : clientSummaries;

    if (filteredClients.length === 0) {
      return <EmptyState title={t('clients.empty')} description={search ? t('clients.emptySearch') : t('clients.emptyHint')} />;
    }

    return (
      <div className="report-section">
        <h3 className="section-title">{t('reports.sections.incomeByClient')}</h3>
        <div className="data-table">
          <table>
            <thead>
              <tr>
                <th>{t('clients.columns.client')}</th>
                <th style={{ textAlign: 'center' }}>{t('clients.columns.activeProjects')}</th>
                <th style={{ textAlign: 'end' }}>{t('clients.columns.paidIncome')}</th>
                <th style={{ textAlign: 'end' }}>{t('clients.columns.unpaid')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredClients.map(c => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td style={{ textAlign: 'center' }}>{c.activeProjectCount}</td>
                  <td className="amount-cell amount-positive">
                    {formatReportAmount(c.paidIncomeMinorUSD || 0, c.paidIncomeMinorILS || 0)}
                  </td>
                  <td className="amount-cell">
                    {formatReportAmount(c.unpaidIncomeMinorUSD || 0, c.unpaidIncomeMinorILS || 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderExpensesByProjectReport = () => {
    if (projectsWithExpenses.length === 0) {
      return <EmptyState title={t('reports.noExpenses')} />;
    }

    return (
      <div className="report-section">
        <h3 className="section-title">{t('reports.sections.expensesByProject')}</h3>
        <div className="data-table">
          <table>
            <thead>
              <tr>
                <th>{t('projects.columns.project')}</th>
                <th>{t('projects.columns.client')}</th>
                <th style={{ textAlign: 'end' }}>{t('projects.columns.expenses')}</th>
              </tr>
            </thead>
            <tbody>
              {projectsWithExpenses.map(p => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="text-secondary">{p.clientName || '-'}</td>
                  <td className="amount-cell amount-negative">
                    -{formatReportAmount(p.expensesMinorUSD || 0, p.expensesMinorILS || 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderUnpaidAgingReport = () => {
    const hasUnpaid = agingBuckets.some(b => b.transactions.length > 0);

    if (!hasUnpaid) {
      return <EmptyState title={t('clients.detail.noReceivables')} description={t('clients.detail.noReceivablesHint')} />;
    }

    return (
      <div className="report-section">
        <h3 className="section-title">{t('reports.sections.unpaidAging')}</h3>
        <div className="data-table">
          <table>
            <thead>
              <tr>
                <th>{t('reports.aging.current')}</th>
                <th style={{ textAlign: 'center' }}>#</th>
                {(currencyMode === 'USD' || currencyMode === 'BOTH') && <th style={{ textAlign: 'end' }}>USD</th>}
                {(currencyMode === 'ILS' || currencyMode === 'BOTH') && <th style={{ textAlign: 'end' }}>ILS</th>}
              </tr>
            </thead>
            <tbody>
              {agingBuckets.map((bucket, idx) => (
                <tr key={idx}>
                  <td>{bucket.label}</td>
                  <td style={{ textAlign: 'center' }}>{bucket.transactions.length}</td>
                  {(currencyMode === 'USD' || currencyMode === 'BOTH') && (
                    <td className="amount-cell">
                      {bucket.totalMinorUSD > 0 ? formatAmount(bucket.totalMinorUSD, 'USD', locale) : '-'}
                    </td>
                  )}
                  {(currencyMode === 'ILS' || currencyMode === 'BOTH') && (
                    <td className="amount-cell">
                      {bucket.totalMinorILS > 0 ? formatAmount(bucket.totalMinorILS, 'ILS', locale) : '-'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <>
      <TopBar
        title={t('reports.title')}
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
        <div className="filters-row">
          <select
            className="select"
            value={reportType}
            onChange={(e) => setReportType(e.target.value as ReportType)}
          >
            {REPORT_TYPES.map(rt => (
              <option key={rt.value} value={rt.value}>
                {t(rt.labelKey)}
              </option>
            ))}
          </select>

          <select
            className="select"
            value={currencyMode}
            onChange={(e) => setCurrencyMode(e.target.value as CurrencyMode)}
          >
            {CURRENCY_MODES.map(cm => (
              <option key={cm.value} value={cm.value}>
                {t(cm.labelKey)}
              </option>
            ))}
          </select>

          {(reportType === 'by-project' || reportType === 'by-client') && (
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={t(reportType === 'by-project' ? 'reports.search.project' : 'reports.search.client')}
            />
          )}

          <button
            className="btn btn-secondary"
            onClick={handleExportCsv}
            style={{ marginInlineStart: 'auto' }}
          >
            <DownloadIcon size={16} />
            {t('reports.exportCsv')}
          </button>
        </div>

        {renderReportContent()}
      </div>
    </>
  );
}
