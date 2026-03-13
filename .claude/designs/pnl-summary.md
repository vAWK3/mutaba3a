# Design Brief: Profit & Loss Summary

> **Feature**: Lightweight P&L Summary (Operational Reporting)
> **Date**: 2026-03-13
> **Status**: Draft v1
> **Positioning**: Operational visibility report, not formal accounting

---

## 1. Problem Statement

Users need a consolidated view of their business performance over time. They want to answer:
- How much did I earn this period?
- How much did I receive vs. invoice?
- How much did I spend?
- What's my net profit (or loss)?
- How do individual clients/projects contribute to these numbers?

The current system has:
- Income tracking with paid/unpaid status
- Expense tracking (profile-scoped)
- Project and client summaries
- Reports with date filtering

But it lacks a **unified P&L view** that combines these into a single, actionable summary.

### Product Alignment

This feature aligns with the product brief:
- Mutaba3a is a small offline-first finance tracker, not a full accounting system
- MVP includes income, expense, reports, project/client summaries
- The brief explicitly includes "project and client profitability, lightweight not accounting"
- Reports already support presets, date filtering, currency mode selection, and CSV export

### Non-Goals (Explicit Exclusions)

Do NOT include:
- Taxes / VAT
- Depreciation
- Accrual accounting rules
- Balance sheet logic
- Chart of accounts
- Journals / ledgers in accounting sense
- Retained earnings
- Formal accounting adjustments
- Certified statements
- Bank reconciliation

---

## 2. Proposed Solution

### 2.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        P&L Summary Report                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────┐                    ┌─────────────────────────┐     │
│  │ Transaction     │──────────────────>│  Aggregation Layer      │     │
│  │ Repository      │  income data       │  (computed, not stored) │     │
│  └─────────────────┘                    │                         │     │
│                                         │  - Revenue metrics      │     │
│  ┌─────────────────┐                    │  - Expense totals       │     │
│  │ Expense         │──────────────────>│  - Net calculations     │     │
│  │ Repository      │  expense data      │  - Per-currency splits  │     │
│  └─────────────────┘                    └───────────┬─────────────┘     │
│                                                     │                    │
│  ┌─────────────────┐                               │                    │
│  │ Project/Client  │                               ▼                    │
│  │ Summaries       │───────────>  ┌─────────────────────────┐          │
│  └─────────────────┘              │   P&L Summary View      │          │
│                                   │                         │          │
│                                   │ - KPI Cards             │          │
│                                   │ - Revenue Section       │          │
│                                   │ - Expense Section       │          │
│                                   │ - Net Result            │          │
│                                   │ - Breakdown Tables      │          │
│                                   │ - CSV Export            │          │
│                                   └─────────────────────────┘          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Key Design Decisions

**Decision 1: Read Model Only**
- No `ProfitLossStatement` table
- No accounting engine
- No mutation workflow
- Compute from existing transactions/expenses through repository/aggregation layer

**Decision 2: Report Preset Integration**
- Add as new report preset in existing Reports infrastructure
- Reuse existing date filtering, currency mode, CSV export

**Decision 3: Currency Integrity**
- Per-currency by default (never auto-mix)
- Optional converted mode only with explicit FX transparency
- Missing rates show warning, not guesses

**Decision 4: Net Cash as Primary Metric**
- Net Cash = Received - Expenses (most honest metric)
- Net Earned = Earned - Expenses (secondary, optional)
- Net Invoiced = Invoiced - Expenses (secondary, optional)

---

## 3. Data Model (No Changes)

This feature uses existing data only:

### 3.1 Income Data Source: Transaction

```typescript
// src/types/index.ts - existing
interface Transaction {
  id: string;
  kind: 'income' | 'expense';        // Filter: kind='income'
  status: 'paid' | 'unpaid';         // Received vs. Receivable
  amountMinor: number;               // In minor units (cents)
  receivedAmountMinor?: number;      // Partial payment support
  currency: Currency;                // 'USD' | 'ILS' | 'EUR'
  occurredAt: string;                // ISO date
  dueDate?: string;                  // For receivables
  paidAt?: string;                   // When payment received
  clientId?: string;
  projectId?: string;
  categoryId?: string;
  profileId?: string;
  // ... other fields
}

// Derived statuses:
// - Earned: kind='income' (all income, regardless of payment status)
// - Invoiced: kind='income' with linkedDocumentId (has invoice)
// - Received: kind='income' && status='paid'
// - Receivable: kind='income' && status='unpaid'
```

### 3.2 Expense Data Source: Expense

```typescript
// src/types/index.ts - existing
interface Expense {
  id: string;
  amountMinor: number;
  currency: Currency;
  occurredAt: string;
  categoryId?: string;
  vendorId?: string;
  projectId?: string;                // Project-linked expense
  profileId: string;                 // REQUIRED - profile scoped
  // ... other fields
}
```

### 3.3 Aggregation Types (New)

```typescript
// src/types/index.ts - add

/**
 * P&L metrics for a single currency
 */
interface PLCurrencyMetrics {
  // Revenue
  earnedMinor: number;               // All income (paid + unpaid)
  invoicedMinor: number;             // Income with linkedDocumentId
  receivedMinor: number;             // Paid income only

  // Expenses
  expensesMinor: number;             // Profile expenses
  projectExpensesMinor: number;      // Subset: linked to projects
  generalExpensesMinor: number;      // Subset: not linked to projects

  // Net
  netCashMinor: number;              // received - expenses (primary)
  netEarnedMinor: number;            // earned - expenses
  netInvoicedMinor: number;          // invoiced - expenses
}

/**
 * P&L Summary for a date range (per-currency breakdown)
 */
interface PLSummary {
  dateFrom: string;
  dateTo: string;
  profileId?: string;

  // Per-currency metrics
  USD: PLCurrencyMetrics;
  ILS: PLCurrencyMetrics;
  EUR: PLCurrencyMetrics;

  // Optional: converted totals (only if FX configured)
  converted?: {
    baseCurrency: Currency;
    effectiveDate: string;
    rates: Record<Currency, number>;
    totals: PLCurrencyMetrics;
  };
}

/**
 * P&L breakdown by entity (project, client, or work field)
 */
interface PLBreakdownRow {
  entityId: string;
  entityName: string;
  entityType: 'project' | 'client' | 'workField';

  // Parent info (for projects)
  clientId?: string;
  clientName?: string;
  workField?: string;

  // Metrics by currency
  USD: PLCurrencyMetrics;
  ILS: PLCurrencyMetrics;
  EUR: PLCurrencyMetrics;
}

/**
 * Expense breakdown by category
 */
interface ExpensesByCategoryRow {
  categoryId: string;
  categoryName: string;
  categoryColor?: string;
  amountMinorUSD: number;
  amountMinorILS: number;
  amountMinorEUR: number;
}
```

---

## 4. Service Layer

### 4.1 P&L Aggregation Service

```typescript
// src/services/plSummaryService.ts

export interface PLFilters {
  dateFrom: string;
  dateTo: string;
  profileId?: string;
  clientId?: string;
  projectId?: string;
  workField?: string;
  includeGeneralExpenses?: boolean;  // default: true
}

export const plSummaryService = {
  /**
   * Get P&L summary for a date range
   */
  async getSummary(filters: PLFilters): Promise<PLSummary> {
    // 1. Fetch income transactions
    const income = await transactionRepo.list({
      kind: 'income',
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      profileId: filters.profileId,
      clientId: filters.clientId,
      projectId: filters.projectId,
    });

    // 2. Fetch expenses
    const expenses = await expenseRepo.list({
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      profileId: filters.profileId,
    });

    // 3. If client/project filter, also get project-linked transaction expenses
    // (legacy kind='expense' transactions linked to projects)
    const legacyExpenses = await transactionRepo.list({
      kind: 'expense',
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      profileId: filters.profileId,
      clientId: filters.clientId,
      projectId: filters.projectId,
    });

    // 4. Aggregate by currency
    return aggregatePLSummary(income, expenses, legacyExpenses, filters);
  },

  /**
   * Get P&L breakdown by project
   */
  async getByProject(filters: PLFilters): Promise<PLBreakdownRow[]> {
    const projects = await projectRepo.list({ profileId: filters.profileId });
    const results: PLBreakdownRow[] = [];

    for (const project of projects) {
      const summary = await this.getSummary({
        ...filters,
        projectId: project.id,
        includeGeneralExpenses: false, // Only project expenses
      });

      results.push({
        entityId: project.id,
        entityName: project.name,
        entityType: 'project',
        clientId: project.clientId,
        clientName: project.clientName,
        workField: project.field,
        USD: summary.USD,
        ILS: summary.ILS,
        EUR: summary.EUR,
      });
    }

    return results.filter(r =>
      // Only include projects with activity
      r.USD.earnedMinor > 0 || r.USD.expensesMinor > 0 ||
      r.ILS.earnedMinor > 0 || r.ILS.expensesMinor > 0 ||
      r.EUR.earnedMinor > 0 || r.EUR.expensesMinor > 0
    );
  },

  /**
   * Get P&L breakdown by client
   */
  async getByClient(filters: PLFilters): Promise<PLBreakdownRow[]> {
    const clients = await clientRepo.list({ profileId: filters.profileId });
    const results: PLBreakdownRow[] = [];

    for (const client of clients) {
      const summary = await this.getSummary({
        ...filters,
        clientId: client.id,
        includeGeneralExpenses: false,
      });

      results.push({
        entityId: client.id,
        entityName: client.name,
        entityType: 'client',
        USD: summary.USD,
        ILS: summary.ILS,
        EUR: summary.EUR,
      });
    }

    return results.filter(r =>
      r.USD.earnedMinor > 0 || r.USD.expensesMinor > 0 ||
      r.ILS.earnedMinor > 0 || r.ILS.expensesMinor > 0 ||
      r.EUR.earnedMinor > 0 || r.EUR.expensesMinor > 0
    );
  },

  /**
   * Get P&L breakdown by work field
   */
  async getByWorkField(filters: PLFilters): Promise<PLBreakdownRow[]> {
    const projects = await projectRepo.list({ profileId: filters.profileId });
    const fieldSet = new Set(projects.map(p => p.field).filter(Boolean));

    const results: PLBreakdownRow[] = [];

    for (const field of fieldSet) {
      const summary = await this.getSummary({
        ...filters,
        workField: field,
        includeGeneralExpenses: false,
      });

      results.push({
        entityId: field!,
        entityName: field!,
        entityType: 'workField',
        USD: summary.USD,
        ILS: summary.ILS,
        EUR: summary.EUR,
      });
    }

    return results.filter(r =>
      r.USD.earnedMinor > 0 || r.USD.expensesMinor > 0 ||
      r.ILS.earnedMinor > 0 || r.ILS.expensesMinor > 0 ||
      r.EUR.earnedMinor > 0 || r.EUR.expensesMinor > 0
    );
  },

  /**
   * Get expenses breakdown by category
   */
  async getExpensesByCategory(filters: PLFilters): Promise<ExpensesByCategoryRow[]> {
    const expenses = await expenseRepo.list({
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      profileId: filters.profileId,
    });

    const categories = await categoryRepo.list();
    const categoryMap = new Map(categories.map(c => [c.id, c]));

    // Group by category
    const byCategory = new Map<string, { USD: number; ILS: number; EUR: number }>();

    for (const exp of expenses) {
      const catId = exp.categoryId || 'uncategorized';
      const current = byCategory.get(catId) || { USD: 0, ILS: 0, EUR: 0 };
      current[exp.currency] += exp.amountMinor;
      byCategory.set(catId, current);
    }

    return Array.from(byCategory.entries()).map(([catId, amounts]) => {
      const category = categoryMap.get(catId);
      return {
        categoryId: catId,
        categoryName: category?.name || 'Uncategorized',
        categoryColor: category?.color,
        amountMinorUSD: amounts.USD,
        amountMinorILS: amounts.ILS,
        amountMinorEUR: amounts.EUR,
      };
    });
  },

  /**
   * Get converted P&L (if FX rates available)
   */
  async getSummaryConverted(
    filters: PLFilters,
    baseCurrency: Currency
  ): Promise<PLSummary | null> {
    const summary = await this.getSummary(filters);

    // Get FX rates
    const rates: Record<Currency, number> = { USD: 1, ILS: 1, EUR: 1 };
    const currencies: Currency[] = ['USD', 'ILS', 'EUR'];

    for (const currency of currencies) {
      if (currency === baseCurrency) {
        rates[currency] = 1;
        continue;
      }

      const rate = await fxRateRepo.getLatest(baseCurrency, currency);
      if (!rate) {
        // Missing rate - cannot convert
        return null;
      }
      rates[currency] = rate.rate;
    }

    // Convert all metrics to base currency
    const convertMetrics = (metrics: PLCurrencyMetrics, rate: number): PLCurrencyMetrics => ({
      earnedMinor: Math.round(metrics.earnedMinor * rate),
      invoicedMinor: Math.round(metrics.invoicedMinor * rate),
      receivedMinor: Math.round(metrics.receivedMinor * rate),
      expensesMinor: Math.round(metrics.expensesMinor * rate),
      projectExpensesMinor: Math.round(metrics.projectExpensesMinor * rate),
      generalExpensesMinor: Math.round(metrics.generalExpensesMinor * rate),
      netCashMinor: Math.round(metrics.netCashMinor * rate),
      netEarnedMinor: Math.round(metrics.netEarnedMinor * rate),
      netInvoicedMinor: Math.round(metrics.netInvoicedMinor * rate),
    });

    const totals: PLCurrencyMetrics = {
      earnedMinor: 0,
      invoicedMinor: 0,
      receivedMinor: 0,
      expensesMinor: 0,
      projectExpensesMinor: 0,
      generalExpensesMinor: 0,
      netCashMinor: 0,
      netEarnedMinor: 0,
      netInvoicedMinor: 0,
    };

    for (const currency of currencies) {
      const converted = convertMetrics(summary[currency], rates[currency]);
      totals.earnedMinor += converted.earnedMinor;
      totals.invoicedMinor += converted.invoicedMinor;
      totals.receivedMinor += converted.receivedMinor;
      totals.expensesMinor += converted.expensesMinor;
      totals.projectExpensesMinor += converted.projectExpensesMinor;
      totals.generalExpensesMinor += converted.generalExpensesMinor;
      totals.netCashMinor += converted.netCashMinor;
      totals.netEarnedMinor += converted.netEarnedMinor;
      totals.netInvoicedMinor += converted.netInvoicedMinor;
    }

    return {
      ...summary,
      converted: {
        baseCurrency,
        effectiveDate: new Date().toISOString().split('T')[0],
        rates,
        totals,
      },
    };
  },
};
```

### 4.2 Aggregation Helper Functions

```typescript
// src/lib/aggregations.ts - add

function aggregatePLSummary(
  income: Transaction[],
  expenses: Expense[],
  legacyExpenses: Transaction[],
  filters: PLFilters
): PLSummary {
  const currencies: Currency[] = ['USD', 'ILS', 'EUR'];

  const result: PLSummary = {
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    profileId: filters.profileId,
    USD: createEmptyPLMetrics(),
    ILS: createEmptyPLMetrics(),
    EUR: createEmptyPLMetrics(),
  };

  // Aggregate income by currency
  for (const tx of income) {
    const metrics = result[tx.currency];

    // Earned = all income
    metrics.earnedMinor += tx.amountMinor;

    // Invoiced = has linked document
    if (tx.linkedDocumentId) {
      metrics.invoicedMinor += tx.amountMinor;
    }

    // Received = paid income
    if (tx.status === 'paid') {
      metrics.receivedMinor += tx.receivedAmountMinor ?? tx.amountMinor;
    }
  }

  // Aggregate profile expenses by currency
  for (const exp of expenses) {
    const metrics = result[exp.currency];
    metrics.expensesMinor += exp.amountMinor;

    if (exp.projectId) {
      metrics.projectExpensesMinor += exp.amountMinor;
    } else {
      metrics.generalExpensesMinor += exp.amountMinor;
    }
  }

  // Aggregate legacy transaction expenses (kind='expense')
  for (const tx of legacyExpenses) {
    const metrics = result[tx.currency];
    metrics.expensesMinor += tx.amountMinor;

    if (tx.projectId) {
      metrics.projectExpensesMinor += tx.amountMinor;
    } else {
      metrics.generalExpensesMinor += tx.amountMinor;
    }
  }

  // Calculate net metrics
  for (const currency of currencies) {
    const metrics = result[currency];
    metrics.netCashMinor = metrics.receivedMinor - metrics.expensesMinor;
    metrics.netEarnedMinor = metrics.earnedMinor - metrics.expensesMinor;
    metrics.netInvoicedMinor = metrics.invoicedMinor - metrics.expensesMinor;
  }

  return result;
}

function createEmptyPLMetrics(): PLCurrencyMetrics {
  return {
    earnedMinor: 0,
    invoicedMinor: 0,
    receivedMinor: 0,
    expensesMinor: 0,
    projectExpensesMinor: 0,
    generalExpensesMinor: 0,
    netCashMinor: 0,
    netEarnedMinor: 0,
    netInvoicedMinor: 0,
  };
}
```

---

## 5. React Query Hooks

```typescript
// src/hooks/usePLSummaryQueries.ts

export const plQueryKeys = {
  summary: (filters: PLFilters) => ['pl-summary', filters] as const,
  byProject: (filters: PLFilters) => ['pl-by-project', filters] as const,
  byClient: (filters: PLFilters) => ['pl-by-client', filters] as const,
  byWorkField: (filters: PLFilters) => ['pl-by-workfield', filters] as const,
  expensesByCategory: (filters: PLFilters) => ['pl-expenses-category', filters] as const,
  converted: (filters: PLFilters, baseCurrency: Currency) =>
    ['pl-summary-converted', filters, baseCurrency] as const,
};

export function usePLSummary(filters: PLFilters) {
  return useQuery({
    queryKey: plQueryKeys.summary(filters),
    queryFn: () => plSummaryService.getSummary(filters),
    staleTime: 30_000,
  });
}

export function usePLByProject(filters: PLFilters) {
  return useQuery({
    queryKey: plQueryKeys.byProject(filters),
    queryFn: () => plSummaryService.getByProject(filters),
    staleTime: 30_000,
  });
}

export function usePLByClient(filters: PLFilters) {
  return useQuery({
    queryKey: plQueryKeys.byClient(filters),
    queryFn: () => plSummaryService.getByClient(filters),
    staleTime: 30_000,
  });
}

export function usePLByWorkField(filters: PLFilters) {
  return useQuery({
    queryKey: plQueryKeys.byWorkField(filters),
    queryFn: () => plSummaryService.getByWorkField(filters),
    staleTime: 30_000,
  });
}

export function usePLExpensesByCategory(filters: PLFilters) {
  return useQuery({
    queryKey: plQueryKeys.expensesByCategory(filters),
    queryFn: () => plSummaryService.getExpensesByCategory(filters),
    staleTime: 30_000,
  });
}

export function usePLSummaryConverted(filters: PLFilters, baseCurrency: Currency, enabled: boolean) {
  return useQuery({
    queryKey: plQueryKeys.converted(filters, baseCurrency),
    queryFn: () => plSummaryService.getSummaryConverted(filters, baseCurrency),
    staleTime: 30_000,
    enabled,
  });
}
```

---

## 6. UI Components

### 6.1 Component Overview

| Component | Purpose | Location |
|-----------|---------|----------|
| `PLSummaryReport` | Main P&L report view | Reports page preset |
| `PLKpiCards` | Top summary cards (Earned, Received, Expenses, Net) | PLSummaryReport |
| `PLRevenueSection` | Revenue breakdown (Earned, Invoiced, Received) | PLSummaryReport |
| `PLExpenseSection` | Expense breakdown (Total, Project, General, By Category) | PLSummaryReport |
| `PLNetSection` | Net results (Net Cash, Net Earned, Net Invoiced) | PLSummaryReport |
| `PLBreakdownTable` | Breakdown by project/client/workfield | PLSummaryReport |
| `PLCurrencyModeToggle` | Per-currency / Converted toggle | PLSummaryReport |

### 6.2 PLSummaryReport Layout

```tsx
// src/components/reports/PLSummaryReport.tsx

interface PLSummaryReportProps {
  dateFrom: string;
  dateTo: string;
  profileId?: string;
}

export function PLSummaryReport({ dateFrom, dateTo, profileId }: PLSummaryReportProps) {
  const [currencyMode, setCurrencyMode] = useState<'per-currency' | 'converted'>('per-currency');
  const [baseCurrency, setBaseCurrency] = useState<Currency>('USD');
  const [breakdownView, setBreakdownView] = useState<'project' | 'client' | 'workfield'>('project');

  const filters: PLFilters = { dateFrom, dateTo, profileId };

  const { data: summary, isLoading } = usePLSummary(filters);
  const { data: convertedSummary } = usePLSummaryConverted(
    filters,
    baseCurrency,
    currencyMode === 'converted'
  );
  const { data: byProject } = usePLByProject(filters);
  const { data: byClient } = usePLByClient(filters);
  const { data: byWorkField } = usePLByWorkField(filters);
  const { data: expensesByCategory } = usePLExpensesByCategory(filters);

  const breakdownData = breakdownView === 'project'
    ? byProject
    : breakdownView === 'client'
      ? byClient
      : byWorkField;

  if (isLoading) return <LoadingSpinner />;
  if (!summary) return <EmptyState message={t('reports.pl.noData')} />;

  const displaySummary = currencyMode === 'converted' && convertedSummary?.converted
    ? convertedSummary
    : summary;

  return (
    <div className="pl-summary-report">
      {/* Header with disclaimer */}
      <ReportHeader
        title={t('reports.pl.title')}
        subtitle={t('reports.pl.disclaimer')}
        dateRange={{ from: dateFrom, to: dateTo }}
      />

      {/* Currency mode toggle */}
      <PLCurrencyModeToggle
        mode={currencyMode}
        baseCurrency={baseCurrency}
        onModeChange={setCurrencyMode}
        onBaseCurrencyChange={setBaseCurrency}
        hasFxRates={!!convertedSummary?.converted}
      />

      {/* KPI Cards */}
      <PLKpiCards
        summary={displaySummary}
        currencyMode={currencyMode}
        baseCurrency={baseCurrency}
      />

      {/* Revenue Section */}
      <PLRevenueSection
        summary={displaySummary}
        currencyMode={currencyMode}
        baseCurrency={baseCurrency}
      />

      {/* Expense Section */}
      <PLExpenseSection
        summary={displaySummary}
        expensesByCategory={expensesByCategory}
        currencyMode={currencyMode}
        baseCurrency={baseCurrency}
      />

      {/* Net Result Section */}
      <PLNetSection
        summary={displaySummary}
        currencyMode={currencyMode}
        baseCurrency={baseCurrency}
      />

      {/* Breakdown Table */}
      <div className="pl-breakdown">
        <SegmentedControl
          value={breakdownView}
          onChange={setBreakdownView}
          options={[
            { value: 'project', label: t('reports.pl.byProject') },
            { value: 'client', label: t('reports.pl.byClient') },
            { value: 'workfield', label: t('reports.pl.byWorkField') },
          ]}
        />
        <PLBreakdownTable
          rows={breakdownData ?? []}
          currencyMode={currencyMode}
          baseCurrency={baseCurrency}
        />
      </div>

      {/* Export Button */}
      <ExportCSVButton
        data={formatPLForExport(displaySummary, breakdownData, expensesByCategory)}
        filename={`pl-summary-${dateFrom}-${dateTo}.csv`}
      />
    </div>
  );
}
```

### 6.3 PLKpiCards

```tsx
// src/components/reports/PLKpiCards.tsx

interface PLKpiCardsProps {
  summary: PLSummary;
  currencyMode: 'per-currency' | 'converted';
  baseCurrency: Currency;
}

export function PLKpiCards({ summary, currencyMode, baseCurrency }: PLKpiCardsProps) {
  const { locale } = useLocale();

  const formatAmount = (minor: number, currency: Currency) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
    }).format(minor / 100);

  if (currencyMode === 'converted' && summary.converted) {
    const { totals } = summary.converted;
    return (
      <div className="pl-kpi-cards">
        <KpiCard
          label={t('reports.pl.received')}
          value={formatAmount(totals.receivedMinor, baseCurrency)}
          variant="positive"
        />
        <KpiCard
          label={t('reports.pl.receivables')}
          value={formatAmount(totals.earnedMinor - totals.receivedMinor, baseCurrency)}
          variant="neutral"
        />
        <KpiCard
          label={t('reports.pl.expenses')}
          value={formatAmount(totals.expensesMinor, baseCurrency)}
          variant="negative"
        />
        <KpiCard
          label={t('reports.pl.netCash')}
          value={formatAmount(totals.netCashMinor, baseCurrency)}
          variant={totals.netCashMinor >= 0 ? 'positive' : 'negative'}
          isPrimary
        />
      </div>
    );
  }

  // Per-currency display
  const currencies: Currency[] = ['USD', 'ILS', 'EUR'];
  const hasActivity = currencies.filter(c =>
    summary[c].earnedMinor > 0 || summary[c].expensesMinor > 0
  );

  return (
    <div className="pl-kpi-cards-grid">
      {hasActivity.map(currency => (
        <div key={currency} className="pl-kpi-currency-section">
          <h4>{currency}</h4>
          <div className="pl-kpi-row">
            <KpiCard
              label={t('reports.pl.received')}
              value={formatAmount(summary[currency].receivedMinor, currency)}
              size="small"
            />
            <KpiCard
              label={t('reports.pl.expenses')}
              value={formatAmount(summary[currency].expensesMinor, currency)}
              size="small"
            />
            <KpiCard
              label={t('reports.pl.netCash')}
              value={formatAmount(summary[currency].netCashMinor, currency)}
              variant={summary[currency].netCashMinor >= 0 ? 'positive' : 'negative'}
              size="small"
            />
          </div>
        </div>
      ))}
    </div>
  );
}
```

### 6.4 PLCurrencyModeToggle

```tsx
// src/components/reports/PLCurrencyModeToggle.tsx

interface PLCurrencyModeToggleProps {
  mode: 'per-currency' | 'converted';
  baseCurrency: Currency;
  onModeChange: (mode: 'per-currency' | 'converted') => void;
  onBaseCurrencyChange: (currency: Currency) => void;
  hasFxRates: boolean;
}

export function PLCurrencyModeToggle({
  mode,
  baseCurrency,
  onModeChange,
  onBaseCurrencyChange,
  hasFxRates,
}: PLCurrencyModeToggleProps) {
  return (
    <div className="pl-currency-mode-toggle">
      <SegmentedControl
        value={mode}
        onChange={onModeChange}
        options={[
          { value: 'per-currency', label: t('reports.pl.perCurrency') },
          {
            value: 'converted',
            label: t('reports.pl.converted'),
            disabled: !hasFxRates,
            tooltip: !hasFxRates ? t('reports.pl.noFxRates') : undefined,
          },
        ]}
      />

      {mode === 'converted' && (
        <Select
          value={baseCurrency}
          onChange={onBaseCurrencyChange}
          options={[
            { value: 'USD', label: 'USD' },
            { value: 'ILS', label: 'ILS' },
            { value: 'EUR', label: 'EUR' },
          ]}
          label={t('reports.pl.baseCurrency')}
        />
      )}

      {mode === 'converted' && !hasFxRates && (
        <Alert variant="warning">
          {t('reports.pl.missingRatesWarning')}
        </Alert>
      )}
    </div>
  );
}
```

---

## 7. CSV Export Format

```typescript
// src/lib/plExport.ts

export function formatPLForExport(
  summary: PLSummary,
  breakdown: PLBreakdownRow[] | undefined,
  expensesByCategory: ExpensesByCategoryRow[] | undefined
): CSVRecord[] {
  const records: CSVRecord[] = [];

  // Header section
  records.push({
    section: 'Header',
    field: 'Report',
    value: 'Profit & Loss Summary',
  });
  records.push({
    section: 'Header',
    field: 'Date Range',
    value: `${summary.dateFrom} to ${summary.dateTo}`,
  });
  records.push({
    section: 'Header',
    field: 'Generated',
    value: new Date().toISOString(),
  });
  records.push({ section: '', field: '', value: '' }); // Empty row

  // Revenue section by currency
  const currencies: Currency[] = ['USD', 'ILS', 'EUR'];
  for (const currency of currencies) {
    const m = summary[currency];
    if (m.earnedMinor === 0 && m.expensesMinor === 0) continue;

    records.push({
      section: `Revenue (${currency})`,
      field: 'Earned',
      value: (m.earnedMinor / 100).toFixed(2),
      currency,
    });
    records.push({
      section: `Revenue (${currency})`,
      field: 'Invoiced',
      value: (m.invoicedMinor / 100).toFixed(2),
      currency,
    });
    records.push({
      section: `Revenue (${currency})`,
      field: 'Received',
      value: (m.receivedMinor / 100).toFixed(2),
      currency,
    });
  }

  records.push({ section: '', field: '', value: '' }); // Empty row

  // Expense section by currency
  for (const currency of currencies) {
    const m = summary[currency];
    if (m.expensesMinor === 0) continue;

    records.push({
      section: `Expenses (${currency})`,
      field: 'Total Expenses',
      value: (m.expensesMinor / 100).toFixed(2),
      currency,
    });
    records.push({
      section: `Expenses (${currency})`,
      field: 'Project Expenses',
      value: (m.projectExpensesMinor / 100).toFixed(2),
      currency,
    });
    records.push({
      section: `Expenses (${currency})`,
      field: 'General Expenses',
      value: (m.generalExpensesMinor / 100).toFixed(2),
      currency,
    });
  }

  records.push({ section: '', field: '', value: '' }); // Empty row

  // Net results by currency
  for (const currency of currencies) {
    const m = summary[currency];
    if (m.earnedMinor === 0 && m.expensesMinor === 0) continue;

    records.push({
      section: `Net Result (${currency})`,
      field: 'Net Cash (Received - Expenses)',
      value: (m.netCashMinor / 100).toFixed(2),
      currency,
    });
    records.push({
      section: `Net Result (${currency})`,
      field: 'Net Earned (Earned - Expenses)',
      value: (m.netEarnedMinor / 100).toFixed(2),
      currency,
    });
  }

  records.push({ section: '', field: '', value: '' }); // Empty row

  // Breakdown by project/client
  if (breakdown && breakdown.length > 0) {
    records.push({
      section: 'Breakdown',
      field: 'Entity',
      value: 'Net Cash USD',
      netCashILS: 'Net Cash ILS',
      netCashEUR: 'Net Cash EUR',
    });

    for (const row of breakdown) {
      records.push({
        section: 'Breakdown',
        field: row.entityName,
        value: (row.USD.netCashMinor / 100).toFixed(2),
        netCashILS: (row.ILS.netCashMinor / 100).toFixed(2),
        netCashEUR: (row.EUR.netCashMinor / 100).toFixed(2),
      });
    }
  }

  records.push({ section: '', field: '', value: '' }); // Empty row

  // Disclaimer footer
  records.push({
    section: 'Disclaimer',
    field: '',
    value: 'Generated from Mutaba3a tracked records. This report does not include tax, depreciation, or formal accounting adjustments.',
  });

  return records;
}
```

---

## 8. Reports Integration

### 8.1 Add P&L Preset to Reports Page

The P&L Summary should be added as a new preset in the Reports page (or Insights page if that's the new home).

```typescript
// Add to report preset options
const reportPresets = [
  { value: 'summary', label: t('reports.presets.summary') },
  { value: 'by-project', label: t('reports.presets.byProject') },
  { value: 'by-client', label: t('reports.presets.byClient') },
  { value: 'expenses-by-project', label: t('reports.presets.expensesByProject') },
  { value: 'unpaid-aging', label: t('reports.presets.unpaidAging') },
  // NEW
  { value: 'pnl-summary', label: t('reports.presets.pnlSummary') },
];
```

### 8.2 Route Integration

```tsx
// In reports routing logic
{reportPreset === 'pnl-summary' && (
  <PLSummaryReport
    dateFrom={dateRange.from}
    dateTo={dateRange.to}
    profileId={selectedProfile}
  />
)}
```

---

## 9. i18n Keys

```json
{
  "reports": {
    "pl": {
      "title": "Profit & Loss Summary",
      "disclaimer": "Operational summary based on tracked income and expenses. Not a formal accounting statement.",

      "perCurrency": "Per Currency",
      "converted": "All (Converted)",
      "baseCurrency": "Base Currency",
      "noFxRates": "FX rates required for conversion",
      "missingRatesWarning": "Some exchange rates are missing. Converted totals may be incomplete.",

      "earned": "Earned",
      "invoiced": "Invoiced",
      "received": "Received",
      "receivables": "Receivables",
      "expenses": "Expenses",
      "projectExpenses": "Project Expenses",
      "generalExpenses": "General Expenses",

      "netCash": "Net Cash",
      "netEarned": "Net Earned",
      "netInvoiced": "Net Invoiced",

      "byProject": "By Project",
      "byClient": "By Client",
      "byWorkField": "By Work Field",
      "byCategory": "By Category",

      "noData": "No income or expense data for this period.",

      "export": "Export CSV"
    },
    "presets": {
      "pnlSummary": "Profit & Loss Summary"
    }
  }
}
```

Arabic translations:

```json
{
  "reports": {
    "pl": {
      "title": "ملخص الأرباح والخسائر",
      "disclaimer": "ملخص تشغيلي بناءً على الدخل والمصروفات المسجلة. ليس بيان محاسبي رسمي.",

      "perCurrency": "لكل عملة",
      "converted": "الكل (محوّل)",
      "baseCurrency": "العملة الأساسية",
      "noFxRates": "يتطلب أسعار صرف للتحويل",
      "missingRatesWarning": "بعض أسعار الصرف مفقودة. قد تكون المجاميع المحولة غير مكتملة.",

      "earned": "المكتسب",
      "invoiced": "المفوتر",
      "received": "المستلم",
      "receivables": "المستحقات",
      "expenses": "المصروفات",
      "projectExpenses": "مصروفات المشاريع",
      "generalExpenses": "المصروفات العامة",

      "netCash": "صافي النقد",
      "netEarned": "صافي المكتسب",
      "netInvoiced": "صافي المفوتر",

      "byProject": "حسب المشروع",
      "byClient": "حسب العميل",
      "byWorkField": "حسب مجال العمل",
      "byCategory": "حسب الفئة",

      "noData": "لا توجد بيانات دخل أو مصروفات لهذه الفترة.",

      "export": "تصدير CSV"
    },
    "presets": {
      "pnlSummary": "ملخص الأرباح والخسائر"
    }
  }
}
```

---

## 10. Edge Cases

### 10.1 No Data for Period

- Display: `EmptyState` with message "No income or expense data for this period."
- CSV export: Include header with disclaimer, no data rows

### 10.2 Partial FX Rates

- If converted mode selected but some rates missing:
  - Show warning alert
  - Display per-currency as fallback
  - CSV includes note about incomplete conversion

### 10.3 Mixed Currency Projects

- A project may have income in USD and expenses in ILS
- Display: Show breakdown per currency, never auto-convert
- Net calculation only within same currency

### 10.4 Profile Filtering

- When profile selected: show only that profile's data
- When no profile: aggregate across all profiles
- Expenses are always profile-scoped; income may or may not be

### 10.5 Zero Amounts

- Hide currency sections with zero activity
- Show "N/A" or dash for missing currencies in breakdown tables

---

## 11. Performance Considerations

### 11.1 Query Optimization

- Use existing repository aggregation methods where possible
- Batch queries for breakdown views
- Cache with React Query (30s staleTime)

### 11.2 Memoization

```typescript
// Pre-shape data before passing to components
const memoizedBreakdown = useMemo(
  () => formatBreakdownRows(breakdownData, currencyMode),
  [breakdownData, currencyMode]
);
```

### 11.3 Lazy Loading

- Load breakdown data only when section is expanded
- Use React Query's `enabled` flag for conditional fetching

---

## 12. Test Plan

### 12.1 Unit Tests (Service Layer)

| Test | Description |
|------|-------------|
| `plSummaryService.getSummary()` - basic | Returns correct totals for single currency |
| `plSummaryService.getSummary()` - multi-currency | Separates currencies correctly |
| `plSummaryService.getSummary()` - with invoiced | Counts linkedDocumentId for invoiced |
| `plSummaryService.getSummary()` - partial payments | Uses receivedAmountMinor correctly |
| `plSummaryService.getByProject()` | Groups by project correctly |
| `plSummaryService.getByClient()` | Groups by client correctly |
| `plSummaryService.getExpensesByCategory()` | Groups expenses by category |
| `plSummaryService.getSummaryConverted()` | Converts with correct rates |
| `plSummaryService.getSummaryConverted()` - missing rates | Returns null |

### 12.2 Component Tests

| Test | Description |
|------|-------------|
| `PLSummaryReport` - loading state | Shows spinner while loading |
| `PLSummaryReport` - empty state | Shows empty message when no data |
| `PLKpiCards` - per-currency | Displays separate currency sections |
| `PLKpiCards` - converted | Displays single converted total |
| `PLCurrencyModeToggle` - disabled | Disables converted when no FX rates |
| `PLBreakdownTable` - sorting | Sorts by net cash by default |
| CSV export | Generates correct format |

### 12.3 Integration Tests

| Test | Description |
|------|-------------|
| Full P&L flow | Create income + expenses, view P&L report |
| Profile filtering | P&L respects selected profile |
| Date range changes | P&L updates when date range changes |
| Currency mode switch | Toggle between per-currency and converted |
| CSV export | Download contains correct data |

---

## 13. Acceptance Criteria

### Must Have (Phase 1)

- [ ] P&L Summary available as report preset
- [ ] Shows Earned, Invoiced, Received, Expenses, Net Cash
- [ ] Per-currency display by default (never auto-mix)
- [ ] KPI cards for quick summary
- [ ] Revenue section with breakdown
- [ ] Expense section with total, project, general
- [ ] Net result section (Net Cash primary)
- [ ] Breakdown by project table
- [ ] Breakdown by client table
- [ ] CSV export with proper format
- [ ] Disclaimer visible in UI
- [ ] Disclaimer in CSV footer
- [ ] Date range filtering
- [ ] Profile filtering
- [ ] Empty state for no data
- [ ] i18n for English and Arabic

### Nice to Have (Phase 2)

- [ ] Converted mode with FX transparency
- [ ] Breakdown by work field
- [ ] Expenses by category breakdown
- [ ] Compare to previous period
- [ ] Net Earned / Net Invoiced display (optional metrics)
- [ ] Print-friendly layout

---

## 14. Reuse Analysis

| Existing Component | Reuse Strategy |
|-------------------|----------------|
| `DateRangeControl` | Reuse for date filtering |
| `CurrencyTabs` | Adapt for currency mode toggle |
| `KpiCard` | Reuse for summary cards |
| `DataTable` | Reuse for breakdown tables |
| `EmptyState` | Reuse for no data state |
| `SegmentedControl` | Reuse for view toggles |
| `formatAmount()` | Reuse for currency formatting |
| `aggregateTransactionTotals()` | Extend for P&L metrics |
| `useOverviewTotals()` | Reference for query pattern |
| CSV export from Reports | Reuse export utility |

---

## 15. Implementation Plan

### Phase 1: Core P&L Summary

1. **Types** (1 task)
   - Add `PLCurrencyMetrics`, `PLSummary`, `PLBreakdownRow`, `ExpensesByCategoryRow`

2. **Service Layer** (2 tasks)
   - `plSummaryService.getSummary()`
   - `plSummaryService.getByProject()`, `getByClient()`

3. **Query Hooks** (1 task)
   - `usePLSummary`, `usePLByProject`, `usePLByClient`

4. **UI Components** (3 tasks)
   - `PLKpiCards`
   - `PLRevenueSection`, `PLExpenseSection`, `PLNetSection`
   - `PLBreakdownTable`

5. **Report Integration** (1 task)
   - Add preset to Reports page
   - `PLSummaryReport` container

6. **CSV Export** (1 task)
   - `formatPLForExport()`
   - Export button integration

7. **i18n** (1 task)
   - English and Arabic translations

8. **Tests** (2 tasks)
   - Service unit tests
   - Component tests

### Phase 2: Enhanced Features

1. Converted mode with FX
2. Breakdown by work field
3. Expenses by category
4. Period comparison

---

## 16. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Users assume this is official accounting | Add visible disclaimer, avoid "statement" language |
| Status ambiguity in income model | Clear documentation of what counts as Earned/Invoiced/Received |
| Mixed currency confusion | Default to per-currency, make converted mode explicit |
| Scope creep into accounting | Keep as report preset only, no new entities |
| Performance with large datasets | Use existing aggregation patterns, memoize |

---

## 17. References

- ADR-002: Repository Pattern for Storage Abstraction
- ADR-003: Drawer-First UX Pattern
- ADR-010: Receivable as Transaction Status
- ADR-015: Profile-Scoped Expenses
- `src/db/aggregations.ts` - Existing aggregation functions
- `src/db/repository.ts` - Transaction repository
- `src/db/expenseRepository.ts` - Expense repository
- `src/pages/reports/ReportsPage.tsx` - Existing reports implementation
- `src/hooks/useQueries.ts` - Query patterns
