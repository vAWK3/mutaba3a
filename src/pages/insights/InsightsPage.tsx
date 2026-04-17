import { useState, useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import { DateRangeControl } from '../../components/filters';
import { EmptyState } from '../../components/ui';
import { DownloadIcon, PrintIcon } from '../../components/icons';
import {
  useTransactions,
  useProjectSummaries,
  useClientSummaries,
} from '../../hooks/useQueries';
import { useProfileFilter } from '../../hooks/useActiveProfile';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import { formatAmount, getDateRangePreset, cn, getDaysUntil } from '../../lib/utils';
import type { CurrencyMode, Currency, TransactionDisplay } from '../../types';

// Preset tab types
type InsightsTab = 'summary' | 'clients' | 'projects' | 'expenses' | 'unpaid';

const TABS: { value: InsightsTab; labelKey: string }[] = [
  { value: 'summary', labelKey: 'insights.tabs.summary' },
  { value: 'clients', labelKey: 'insights.tabs.clients' },
  { value: 'projects', labelKey: 'insights.tabs.projects' },
  { value: 'expenses', labelKey: 'insights.tabs.expenses' },
  { value: 'unpaid', labelKey: 'insights.tabs.unpaid' },
];

// Currency mode options
const CURRENCY_MODES: { value: CurrencyMode; labelKey: string }[] = [
  { value: 'BOTH', labelKey: 'reports.currencyMode.both' },
  { value: 'USD', labelKey: 'reports.currencyMode.usd' },
  { value: 'ILS', labelKey: 'reports.currencyMode.ils' },
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

export function InsightsPage() {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const profileId = useProfileFilter();

  // State
  const [activeTab, setActiveTab] = useState<InsightsTab>('summary');
  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>('BOTH');
  const [dateRange, setDateRange] = useState(() => getDateRangePreset('this-month'));

  // Query filters
  const currencyFilter: Currency | undefined = currencyMode === 'BOTH' ? undefined : currencyMode;

  // Fetch data
  const { data: transactions = [], isLoading: txLoading } = useTransactions({
    profileId,
    dateFrom: dateRange.dateFrom,
    dateTo: dateRange.dateTo,
    currency: currencyFilter,
  });

  const { data: projectSummaries = [], isLoading: projLoading } = useProjectSummaries(profileId, currencyFilter);
  const { data: clientSummaries = [], isLoading: clientLoading } = useClientSummaries(profileId, currencyFilter);

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

  // Aging buckets for unpaid tab
  const agingBuckets = useMemo(() => {
    if (activeTab !== 'unpaid') return [];
    return calculateAgingBuckets(transactions, t);
  }, [transactions, activeTab, t]);

  // Monthly trend data for Summary tab
  const monthlyTrend = useMemo(() => {
    const monthMap = new Map<string, {
      month: string;
      label: string;
      incomeUSD: number;
      incomeILS: number;
      expensesUSD: number;
      expensesILS: number;
    }>();

    for (const tx of transactions) {
      const date = new Date(tx.occurredAt);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthLabel = date.toLocaleDateString(locale, { month: 'short', year: 'numeric' });

      if (!monthMap.has(monthKey)) {
        monthMap.set(monthKey, {
          month: monthKey,
          label: monthLabel,
          incomeUSD: 0,
          incomeILS: 0,
          expensesUSD: 0,
          expensesILS: 0,
        });
      }

      const entry = monthMap.get(monthKey)!;
      if (tx.kind === 'income' && tx.status === 'paid') {
        if (tx.currency === 'USD') entry.incomeUSD += tx.amountMinor;
        else if (tx.currency === 'ILS') entry.incomeILS += tx.amountMinor;
      } else if (tx.kind === 'expense') {
        if (tx.currency === 'USD') entry.expensesUSD += tx.amountMinor;
        else if (tx.currency === 'ILS') entry.expensesILS += tx.amountMinor;
      }
    }

    // Sort by month and return array
    return Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month));
  }, [transactions, locale]);

  // Filter project summaries for expenses tab
  const projectsWithExpenses = useMemo(() => {
    return projectSummaries.filter(p => {
      if (currencyMode === 'USD') return p.expensesMinorUSD && p.expensesMinorUSD > 0;
      if (currencyMode === 'ILS') return p.expensesMinorILS && p.expensesMinorILS > 0;
      return (p.expensesMinorUSD && p.expensesMinorUSD > 0) ||
             (p.expensesMinorILS && p.expensesMinorILS > 0);
    });
  }, [projectSummaries, currencyMode]);

  // Outstanding by client
  const outstandingByClient = useMemo(() => {
    const clientMap = new Map<string, {
      clientId: string;
      clientName: string;
      count: number;
      totalUSD: number;
      totalILS: number;
    }>();

    for (const tx of transactions) {
      if (tx.kind !== 'income' || tx.status !== 'unpaid') continue;

      const clientId = tx.clientId || 'unknown';
      const clientName = tx.clientName || '-';

      if (!clientMap.has(clientId)) {
        clientMap.set(clientId, {
          clientId,
          clientName,
          count: 0,
          totalUSD: 0,
          totalILS: 0,
        });
      }

      const entry = clientMap.get(clientId)!;
      entry.count += 1;
      if (tx.currency === 'USD') entry.totalUSD += tx.amountMinor;
      else if (tx.currency === 'ILS') entry.totalILS += tx.amountMinor;
    }

    return Array.from(clientMap.values()).sort((a, b) =>
      (b.totalUSD + b.totalILS) - (a.totalUSD + a.totalILS)
    );
  }, [transactions]);

  // Outstanding by project
  const outstandingByProject = useMemo(() => {
    const projectMap = new Map<string, {
      projectId: string;
      projectName: string;
      clientName: string;
      count: number;
      totalUSD: number;
      totalILS: number;
    }>();

    for (const tx of transactions) {
      if (tx.kind !== 'income' || tx.status !== 'unpaid') continue;

      const projectId = tx.projectId || 'unknown';
      const projectName = tx.projectName || '-';
      const clientName = tx.clientName || '-';

      if (!projectMap.has(projectId)) {
        projectMap.set(projectId, {
          projectId,
          projectName,
          clientName,
          count: 0,
          totalUSD: 0,
          totalILS: 0,
        });
      }

      const entry = projectMap.get(projectId)!;
      entry.count += 1;
      if (tx.currency === 'USD') entry.totalUSD += tx.amountMinor;
      else if (tx.currency === 'ILS') entry.totalILS += tx.amountMinor;
    }

    return Array.from(projectMap.values()).sort((a, b) =>
      (b.totalUSD + b.totalILS) - (a.totalUSD + a.totalILS)
    );
  }, [transactions]);

  // Export handlers
  const handleExportCsv = () => {
    switch (activeTab) {
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
        exportToCsv(data, `insights-summary-${dateRange.dateFrom}-${dateRange.dateTo}`);
        break;
      }
      case 'clients': {
        const data = clientSummaries.map(c => ({
          Client: c.name,
          'Active Projects': c.activeProjectCount,
          'Paid USD': (c.paidIncomeMinorUSD || 0) / 100,
          'Paid ILS': (c.paidIncomeMinorILS || 0) / 100,
          'Unpaid USD': (c.unpaidIncomeMinorUSD || 0) / 100,
          'Unpaid ILS': (c.unpaidIncomeMinorILS || 0) / 100,
        }));
        exportToCsv(data, `insights-clients-${dateRange.dateFrom}-${dateRange.dateTo}`);
        break;
      }
      case 'projects': {
        const data = projectSummaries.map(p => ({
          Project: p.name,
          Client: p.clientName || '',
          Field: p.field || '',
          'Received USD': (p.paidIncomeMinorUSD || 0) / 100,
          'Received ILS': (p.paidIncomeMinorILS || 0) / 100,
          'Unpaid USD': (p.unpaidIncomeMinorUSD || 0) / 100,
          'Unpaid ILS': (p.unpaidIncomeMinorILS || 0) / 100,
          'Expenses USD': (p.expensesMinorUSD || 0) / 100,
          'Expenses ILS': (p.expensesMinorILS || 0) / 100,
        }));
        exportToCsv(data, `insights-projects-${dateRange.dateFrom}-${dateRange.dateTo}`);
        break;
      }
      case 'expenses': {
        const data = projectsWithExpenses.map(p => ({
          Project: p.name,
          Client: p.clientName || '',
          'Expenses USD': (p.expensesMinorUSD || 0) / 100,
          'Expenses ILS': (p.expensesMinorILS || 0) / 100,
        }));
        exportToCsv(data, `insights-expenses-${dateRange.dateFrom}-${dateRange.dateTo}`);
        break;
      }
      case 'unpaid': {
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
        exportToCsv(data, `insights-unpaid-${dateRange.dateFrom}-${dateRange.dateTo}`);
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

  // Render tab content
  const renderTabContent = () => {
    if (isLoading) {
      return (
        <div className="loading">
          <div className="spinner" />
        </div>
      );
    }

    switch (activeTab) {
      case 'summary':
        return renderSummaryTab();
      case 'clients':
        return renderClientsTab();
      case 'projects':
        return renderProjectsTab();
      case 'expenses':
        return renderExpensesTab();
      case 'unpaid':
        return renderUnpaidTab();
      default:
        return null;
    }
  };

  const renderSummaryTab = () => {
    const netUSD = summaryTotals.paidIncomeUSD - summaryTotals.expensesUSD;
    const netILS = summaryTotals.paidIncomeILS - summaryTotals.expensesILS;

    // Calculate max value for bar chart scaling
    const maxMonthlyValue = monthlyTrend.reduce((max, m) => {
      const incomeTotal = currencyMode === 'USD' ? m.incomeUSD :
                          currencyMode === 'ILS' ? m.incomeILS :
                          m.incomeUSD + m.incomeILS;
      const expenseTotal = currencyMode === 'USD' ? m.expensesUSD :
                           currencyMode === 'ILS' ? m.expensesILS :
                           m.expensesUSD + m.expensesILS;
      return Math.max(max, incomeTotal, expenseTotal);
    }, 0);

    return (
      <div className="insights-section">
        {/* Cash Flow Timeline Link */}
        <div data-testid="cash-flow-timeline" className="cash-flow-timeline-link" style={{ marginBottom: 24 }}>
          <Link
            to="/money-answers"
            className="btn btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
          >
            {t('insights.cashFlowTimeline.title')}
            <span style={{ fontSize: '1.2em' }}>→</span>
          </Link>
          <p className="text-muted text-sm" style={{ marginTop: 8 }}>
            {t('insights.cashFlowTimeline.hint')}
          </p>
        </div>
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

        {/* Monthly Trend Chart */}
        {monthlyTrend.length > 0 && (
          <div className="monthly-trend-section" style={{ marginTop: 24 }}>
            <h3 className="section-title">{t('insights.monthlyTrend.title')}</h3>
            <div className="monthly-trend-legend" style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 'var(--font-size-sm)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 12, backgroundColor: 'var(--color-income)', borderRadius: 2 }} />
                {t('insights.monthlyTrend.income')}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 12, backgroundColor: 'var(--color-expense)', borderRadius: 2 }} />
                {t('insights.monthlyTrend.expenses')}
              </span>
            </div>
            <div className="monthly-trend-chart">
              {monthlyTrend.map((m) => {
                const incomeTotal = currencyMode === 'USD' ? m.incomeUSD :
                                   currencyMode === 'ILS' ? m.incomeILS :
                                   m.incomeUSD + m.incomeILS;
                const expenseTotal = currencyMode === 'USD' ? m.expensesUSD :
                                    currencyMode === 'ILS' ? m.expensesILS :
                                    m.expensesUSD + m.expensesILS;
                const incomePercent = maxMonthlyValue > 0 ? (incomeTotal / maxMonthlyValue) * 100 : 0;
                const expensePercent = maxMonthlyValue > 0 ? (expenseTotal / maxMonthlyValue) * 100 : 0;

                return (
                  <div key={m.month} className="monthly-trend-row" style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    marginBottom: 8,
                  }}>
                    <span className="text-muted text-sm" style={{ minWidth: 70 }}>{m.label}</span>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <div style={{
                        height: 8,
                        backgroundColor: 'var(--color-income)',
                        width: `${Math.max(incomePercent, 1)}%`,
                        borderRadius: 4,
                        transition: 'width 0.3s ease',
                      }} title={`${t('insights.monthlyTrend.income')}: ${formatReportAmount(
                        currencyMode === 'ILS' ? 0 : m.incomeUSD,
                        currencyMode === 'USD' ? 0 : m.incomeILS
                      )}`} />
                      <div style={{
                        height: 8,
                        backgroundColor: 'var(--color-expense)',
                        width: `${Math.max(expensePercent, 1)}%`,
                        borderRadius: 4,
                        transition: 'width 0.3s ease',
                      }} title={`${t('insights.monthlyTrend.expenses')}: ${formatReportAmount(
                        currencyMode === 'ILS' ? 0 : m.expensesUSD,
                        currencyMode === 'USD' ? 0 : m.expensesILS
                      )}`} />
                    </div>
                    <div className="text-sm" style={{ minWidth: 100, textAlign: 'end' }}>
                      <div className="amount-positive">{formatReportAmount(
                        currencyMode === 'ILS' ? 0 : m.incomeUSD,
                        currencyMode === 'USD' ? 0 : m.incomeILS
                      )}</div>
                      <div className="amount-negative">-{formatReportAmount(
                        currencyMode === 'ILS' ? 0 : m.expensesUSD,
                        currencyMode === 'USD' ? 0 : m.expensesILS
                      )}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderClientsTab = () => {
    if (clientSummaries.length === 0) {
      return <EmptyState title={t('clients.empty')} description={t('clients.emptyHint')} />;
    }

    return (
      <div className="insights-section">
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
              {clientSummaries.map(c => (
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

  const renderProjectsTab = () => {
    if (projectSummaries.length === 0) {
      return <EmptyState title={t('projects.empty')} description={t('projects.emptyHint')} />;
    }

    return (
      <div className="insights-section">
        <div className="data-table">
          <table>
            <thead>
              <tr>
                <th>{t('projects.columns.project')}</th>
                <th>{t('projects.columns.client')}</th>
                <th style={{ textAlign: 'end' }}>{t('projects.columns.received')}</th>
                <th style={{ textAlign: 'end' }}>{t('projects.columns.unpaid')}</th>
                <th style={{ textAlign: 'end' }}>{t('projects.columns.expenses')}</th>
                <th style={{ textAlign: 'end' }}>{t('projects.columns.net')}</th>
              </tr>
            </thead>
            <tbody>
              {projectSummaries.map(p => {
                const netUSD = (p.paidIncomeMinorUSD || 0) - (p.expensesMinorUSD || 0);
                const netILS = (p.paidIncomeMinorILS || 0) - (p.expensesMinorILS || 0);
                const isNegative = currencyMode === 'USD' ? netUSD < 0 :
                                   currencyMode === 'ILS' ? netILS < 0 :
                                   (netUSD + netILS) < 0;

                return (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className="text-secondary">{p.clientName || '-'}</td>
                    <td className="amount-cell amount-positive">
                      {formatReportAmount(p.paidIncomeMinorUSD || 0, p.paidIncomeMinorILS || 0)}
                    </td>
                    <td className="amount-cell">
                      {formatReportAmount(p.unpaidIncomeMinorUSD || 0, p.unpaidIncomeMinorILS || 0)}
                    </td>
                    <td className="amount-cell amount-negative">
                      {(p.expensesMinorUSD || 0) + (p.expensesMinorILS || 0) > 0
                        ? `-${formatReportAmount(p.expensesMinorUSD || 0, p.expensesMinorILS || 0)}`
                        : '-'}
                    </td>
                    <td className={cn('amount-cell', isNegative ? 'amount-negative' : 'amount-positive')}>
                      {formatReportAmount(netUSD, netILS)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderExpensesTab = () => {
    if (projectsWithExpenses.length === 0) {
      return <EmptyState title={t('reports.noExpenses')} />;
    }

    return (
      <div className="insights-section">
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

  const renderUnpaidTab = () => {
    const hasUnpaid = agingBuckets.some(b => b.transactions.length > 0);

    if (!hasUnpaid) {
      return <EmptyState title={t('clients.detail.noReceivables')} description={t('clients.detail.noReceivablesHint')} />;
    }

    return (
      <div className="insights-section">
        {/* Aging Buckets */}
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

        {/* Outstanding by Client */}
        {outstandingByClient.length > 0 && (
          <>
            <h3 className="section-title" style={{ marginTop: 24 }}>{t('insights.unpaid.byClient')}</h3>
            <div className="data-table">
              <table>
                <thead>
                  <tr>
                    <th>{t('clients.columns.client')}</th>
                    <th style={{ textAlign: 'center' }}>{t('insights.unpaid.invoices')}</th>
                    {(currencyMode === 'USD' || currencyMode === 'BOTH') && <th style={{ textAlign: 'end' }}>USD</th>}
                    {(currencyMode === 'ILS' || currencyMode === 'BOTH') && <th style={{ textAlign: 'end' }}>ILS</th>}
                  </tr>
                </thead>
                <tbody>
                  {outstandingByClient.map((c) => (
                    <tr key={c.clientId}>
                      <td>{c.clientName}</td>
                      <td style={{ textAlign: 'center' }}>{c.count}</td>
                      {(currencyMode === 'USD' || currencyMode === 'BOTH') && (
                        <td className="amount-cell">
                          {c.totalUSD > 0 ? formatAmount(c.totalUSD, 'USD', locale) : '-'}
                        </td>
                      )}
                      {(currencyMode === 'ILS' || currencyMode === 'BOTH') && (
                        <td className="amount-cell">
                          {c.totalILS > 0 ? formatAmount(c.totalILS, 'ILS', locale) : '-'}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Outstanding by Project */}
        {outstandingByProject.length > 0 && (
          <>
            <h3 className="section-title" style={{ marginTop: 24 }}>{t('insights.unpaid.byProject')}</h3>
            <div className="data-table">
              <table>
                <thead>
                  <tr>
                    <th>{t('projects.columns.project')}</th>
                    <th>{t('projects.columns.client')}</th>
                    <th style={{ textAlign: 'center' }}>{t('insights.unpaid.invoices')}</th>
                    {(currencyMode === 'USD' || currencyMode === 'BOTH') && <th style={{ textAlign: 'end' }}>USD</th>}
                    {(currencyMode === 'ILS' || currencyMode === 'BOTH') && <th style={{ textAlign: 'end' }}>ILS</th>}
                  </tr>
                </thead>
                <tbody>
                  {outstandingByProject.map((p) => (
                    <tr key={p.projectId}>
                      <td>{p.projectName}</td>
                      <td className="text-secondary">{p.clientName}</td>
                      <td style={{ textAlign: 'center' }}>{p.count}</td>
                      {(currencyMode === 'USD' || currencyMode === 'BOTH') && (
                        <td className="amount-cell">
                          {p.totalUSD > 0 ? formatAmount(p.totalUSD, 'USD', locale) : '-'}
                        </td>
                      )}
                      {(currencyMode === 'ILS' || currencyMode === 'BOTH') && (
                        <td className="amount-cell">
                          {p.totalILS > 0 ? formatAmount(p.totalILS, 'ILS', locale) : '-'}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <>
      <TopBar
        title={t('insights.title')}
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
        {/* Preset tabs */}
        <div className="insights-tabs">
          {TABS.map(tab => (
            <button
              key={tab.value}
              className={cn('insights-tab', activeTab === tab.value && 'active')}
              onClick={() => setActiveTab(tab.value)}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>

        {/* Filters row */}
        <div className="filters-row">
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

          <div style={{ marginInlineStart: 'auto', display: 'flex', gap: 8 }}>
            <button
              className="btn btn-secondary"
              onClick={() => window.print()}
            >
              <PrintIcon size={16} />
              {t('reports.print')}
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleExportCsv}
            >
              <DownloadIcon size={16} />
              {t('reports.exportCsv')}
            </button>
          </div>
        </div>

        {/* Print header (hidden on screen, shown in print) */}
        <div className="print-header">
          <h1>{t('insights.title')} - {t(TABS.find(tab => tab.value === activeTab)?.labelKey || '')}</h1>
          <div className="print-date">
            {dateRange.dateFrom} – {dateRange.dateTo}
          </div>
        </div>

        {/* Tab content */}
        {renderTabContent()}
      </div>
    </>
  );
}
