import { db } from './database';
import type {
  Currency,
  MoneyEvent,
  MoneyDirection,
  MoneyEventSource,
  MoneyEventState,
  MoneyConfidence,
  DailyAggregate,
  MonthSummary,
  GuidanceItem,
  GuidanceSeverity,
  MoneyAnswersFilters,
  Transaction,
  Expense,
  ProjectedIncome,
} from '../types';

// ============================================================================
// Utility Functions
// ============================================================================

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

function getMonthRange(monthKey: string): { start: string; end: string } {
  const [year, month] = monthKey.split('-').map(Number);
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

function getDaysInMonth(monthKey: string): string[] {
  const { start, end } = getMonthRange(monthKey);
  const days: string[] = [];
  const current = new Date(start);
  const endDate = new Date(end);
  while (current <= endDate) {
    days.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  return days;
}

function daysBetween(date1: string, date2: string): number {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffTime = d2.getTime() - d1.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

// ============================================================================
// Event Normalization
// ============================================================================

/**
 * Normalize a Transaction to MoneyEvent(s)
 */
function normalizeTransaction(
  tx: Transaction,
  clientName?: string
): MoneyEvent {
  const today = todayISO();
  let direction: MoneyDirection;
  let source: MoneyEventSource;
  let state: MoneyEventState;
  const confidence: MoneyConfidence = 'high';

  if (tx.kind === 'income') {
    direction = 'inflow';
    if (tx.status === 'paid') {
      source = 'actual_income';
      state = 'paid';
    } else {
      source = 'receivable';
      if (tx.dueDate && tx.dueDate < today) {
        state = 'overdue';
      } else {
        state = 'unpaid';
      }
    }
  } else {
    direction = 'outflow';
    source = 'actual_cost';
    state = 'paid';
  }

  // Determine eventDate: paidAt > dueDate > occurredAt
  let eventDate = tx.occurredAt.split('T')[0];
  if (tx.status === 'paid' && tx.paidAt) {
    eventDate = tx.paidAt.split('T')[0];
  } else if (tx.status === 'unpaid' && tx.dueDate) {
    eventDate = tx.dueDate;
  }

  return {
    id: `tx-${tx.id}`,
    direction,
    source,
    state,
    amountMinor: tx.amountMinor,
    currency: tx.currency,
    eventDate,
    dueDate: tx.dueDate,
    paidDate: tx.paidAt?.split('T')[0],
    counterparty: tx.clientId && clientName
      ? { id: tx.clientId, name: clientName, type: 'client' }
      : undefined,
    title: tx.title || (tx.kind === 'income' ? 'Income' : 'Expense'),
    confidence,
    sourceEntityId: tx.id,
    sourceEntityType: 'transaction',
  };
}

/**
 * Normalize an Expense to MoneyEvent
 */
function normalizeExpense(
  expense: Expense,
  vendorName?: string
): MoneyEvent {
  return {
    id: `exp-${expense.id}`,
    profileId: expense.profileId,
    direction: 'outflow',
    source: 'profile_expense',
    state: 'paid',
    amountMinor: expense.amountMinor,
    currency: expense.currency,
    eventDate: expense.occurredAt.split('T')[0],
    paidDate: expense.occurredAt.split('T')[0],
    counterparty: vendorName
      ? { id: expense.vendorId || '', name: vendorName, type: 'vendor' }
      : undefined,
    title: expense.title || expense.vendor || 'Expense',
    confidence: 'high',
    sourceEntityId: expense.id,
    sourceEntityType: 'expense',
  };
}

/**
 * Normalize ProjectedIncome to MoneyEvent
 */
function normalizeProjectedIncome(
  pi: ProjectedIncome,
  clientName?: string,
  retainerTitle?: string
): MoneyEvent {
  const today = todayISO();
  let state: MoneyEventState;
  let confidence: MoneyConfidence;

  // Map projected income states
  if (pi.state === 'received') {
    state = 'paid';
    confidence = 'high';
  } else if (pi.state === 'partial') {
    state = 'unpaid';
    confidence = 'high';
  } else if (pi.state === 'due') {
    state = pi.expectedDate < today ? 'overdue' : 'unpaid';
    confidence = 'high';
  } else if (pi.state === 'missed') {
    state = 'missed';
    confidence = 'high';
  } else if (pi.state === 'canceled') {
    state = 'cancelled';
    confidence = 'high';
  } else {
    // upcoming
    state = 'upcoming';
    confidence = 'medium';
  }

  return {
    id: `pi-${pi.id}`,
    profileId: pi.profileId,
    direction: 'inflow',
    source: 'retainer',
    state,
    amountMinor: pi.expectedAmountMinor - pi.receivedAmountMinor,
    currency: pi.currency,
    eventDate: pi.expectedDate,
    expectedDate: pi.expectedDate,
    paidDate: pi.receivedAt?.split('T')[0],
    counterparty: pi.clientId && clientName
      ? { id: pi.clientId, name: clientName, type: 'client' }
      : undefined,
    title: retainerTitle || 'Retainer Payment',
    confidence,
    sourceEntityId: pi.id,
    sourceEntityType: 'projectedIncome',
  };
}

// ============================================================================
// Main Repository Functions
// ============================================================================

export const moneyEventRepo = {
  /**
   * Get all money events for a given month and currency
   */
  async getMoneyEvents(filters: MoneyAnswersFilters): Promise<MoneyEvent[]> {
    const { month, currency, includeReceivables = true, includeProjections = true } = filters;

    if (!month) {
      throw new Error('Month is required for money events');
    }

    const { start, end } = getMonthRange(month);
    const events: MoneyEvent[] = [];

    // Load reference data
    const clients = await db.clients.toArray();
    const clientMap = new Map(clients.map(c => [c.id, c.name]));

    const vendors = await db.vendors.toArray();
    const vendorMap = new Map(vendors.map(v => [v.id, v.canonicalName]));

    const retainers = await db.retainerAgreements.toArray();
    const retainerMap = new Map(retainers.map(r => [r.id, r.title]));

    // 1. Get transactions (income paid, income unpaid if includeReceivables, expenses)
    const transactions = await db.transactions
      .filter(tx => {
        if (tx.deletedAt) return false;
        if (tx.currency !== currency) return false;

        // Determine the relevant date for filtering
        let eventDate: string;
        if (tx.kind === 'income' && tx.status === 'paid' && tx.paidAt) {
          eventDate = tx.paidAt.split('T')[0];
        } else if (tx.kind === 'income' && tx.status === 'unpaid' && tx.dueDate) {
          eventDate = tx.dueDate;
        } else {
          eventDate = tx.occurredAt.split('T')[0];
        }

        // Filter by date range
        if (eventDate < start || eventDate > end) return false;

        // Filter unpaid income if not including receivables
        if (!includeReceivables && tx.kind === 'income' && tx.status === 'unpaid') {
          return false;
        }

        return true;
      })
      .toArray();

    for (const tx of transactions) {
      events.push(normalizeTransaction(tx, tx.clientId ? clientMap.get(tx.clientId) : undefined));
    }

    // 2. Get profile expenses
    const expenses = await db.expenses
      .filter(exp => {
        if (exp.deletedAt) return false;
        if (exp.currency !== currency) return false;
        const date = exp.occurredAt.split('T')[0];
        return date >= start && date <= end;
      })
      .toArray();

    for (const exp of expenses) {
      events.push(normalizeExpense(exp, exp.vendorId ? vendorMap.get(exp.vendorId) : exp.vendor));
    }

    // 3. Get projected income (retainers) if includeProjections
    if (includeProjections) {
      const projectedIncomeItems = await db.projectedIncome
        .filter(pi => {
          if (pi.currency !== currency) return false;
          if (pi.state === 'canceled') return false;
          return pi.expectedDate >= start && pi.expectedDate <= end;
        })
        .toArray();

      for (const pi of projectedIncomeItems) {
        // Skip already received items - they'll show as actual income
        if (pi.state === 'received' && pi.receivedAmountMinor >= pi.expectedAmountMinor) {
          continue;
        }
        events.push(normalizeProjectedIncome(
          pi,
          pi.clientId ? clientMap.get(pi.clientId) : undefined,
          pi.sourceId ? retainerMap.get(pi.sourceId) : undefined
        ));
      }
    }

    // Sort by eventDate
    events.sort((a, b) => a.eventDate.localeCompare(b.eventDate));

    return events;
  },

  /**
   * Get daily aggregates for a month with running balance
   */
  async getDailyAggregates(
    filters: MoneyAnswersFilters,
    openingBalanceMinor: number = 0
  ): Promise<DailyAggregate[]> {
    if (!filters.month) {
      throw new Error('Month is required for daily aggregates');
    }

    const events = await this.getMoneyEvents(filters);
    const days = getDaysInMonth(filters.month);

    // Group events by date
    const eventsByDate = new Map<string, MoneyEvent[]>();
    for (const event of events) {
      const dateEvents = eventsByDate.get(event.eventDate) || [];
      dateEvents.push(event);
      eventsByDate.set(event.eventDate, dateEvents);
    }

    let runningBalance = openingBalanceMinor;
    const aggregates: DailyAggregate[] = [];

    for (const date of days) {
      const dayEvents = eventsByDate.get(date) || [];

      let inflowMinor = 0;
      let outflowMinor = 0;
      let confidenceLevel: MoneyConfidence = 'high';

      for (const event of dayEvents) {
        if (event.direction === 'inflow') {
          // Only count paid inflows towards balance
          if (event.state === 'paid') {
            inflowMinor += event.amountMinor;
          }
        } else {
          outflowMinor += event.amountMinor;
        }

        // Lower confidence if any event is low confidence
        if (event.confidence === 'low') {
          confidenceLevel = 'low';
        } else if (event.confidence === 'medium' && confidenceLevel === 'high') {
          confidenceLevel = 'medium';
        }
      }

      const netMinor = inflowMinor - outflowMinor;
      runningBalance += netMinor;

      aggregates.push({
        date,
        inflowMinor,
        outflowMinor,
        netMinor,
        runningBalanceMinor: runningBalance,
        events: dayEvents,
        confidenceLevel,
      });
    }

    return aggregates;
  },

  /**
   * Get month summary totals
   */
  async getMonthSummary(filters: MoneyAnswersFilters): Promise<MonthSummary> {
    if (!filters.month) {
      throw new Error('Month is required for month summary');
    }

    const events = await this.getMoneyEvents(filters);

    let totalInflowMinor = 0;
    let totalOutflowMinor = 0;
    let awaitingMinor = 0;
    let projectedOutflowMinor = 0;

    for (const event of events) {
      if (event.direction === 'inflow') {
        if (event.state === 'paid') {
          totalInflowMinor += event.amountMinor;
        } else if (event.state === 'unpaid' || event.state === 'overdue') {
          awaitingMinor += event.amountMinor;
        } else if (event.state === 'upcoming') {
          awaitingMinor += event.amountMinor;
        }
      } else {
        if (event.state === 'paid') {
          totalOutflowMinor += event.amountMinor;
        } else if (event.state === 'upcoming') {
          projectedOutflowMinor += event.amountMinor;
        }
      }
    }

    return {
      month: filters.month,
      totalInflowMinor,
      totalOutflowMinor,
      netMinor: totalInflowMinor - totalOutflowMinor,
      awaitingMinor,
      projectedOutflowMinor,
    };
  },

  /**
   * Generate guidance items based on current data
   */
  async generateGuidance(filters: MoneyAnswersFilters): Promise<GuidanceItem[]> {
    const today = todayISO();
    const events = await this.getMoneyEvents(filters);
    const guidance: GuidanceItem[] = [];

    // Get month summary for threshold calculations
    const summary = await this.getMonthSummary(filters);
    const monthlyAvgInflow = summary.totalInflowMinor > 0 ? summary.totalInflowMinor : 100000; // Default for threshold

    // Rule 1: Overdue 30+ days (critical)
    const overdueEvents = events.filter(e =>
      e.direction === 'inflow' &&
      e.state === 'overdue' &&
      e.dueDate &&
      daysBetween(e.dueDate, today) > 30
    );

    if (overdueEvents.length > 0) {
      const totalOverdue = overdueEvents.reduce((sum, e) => sum + e.amountMinor, 0);
      guidance.push({
        id: 'overdue-30-days',
        severity: 'critical',
        category: 'collect',
        title: `${overdueEvents.length} payment${overdueEvents.length > 1 ? 's' : ''} overdue 30+ days`,
        description: 'These receivables are significantly overdue. Consider following up urgently.',
        impactMinor: totalOverdue,
        impactCurrency: filters.currency,
        relatedEventIds: overdueEvents.map(e => e.id),
        primaryAction: { label: 'View Details', type: 'viewReceivables' },
      });
    }

    // Rule 2: Large overdue (critical) - single receivable > 20% of month avg
    const largeOverdueEvents = events.filter(e =>
      e.direction === 'inflow' &&
      e.state === 'overdue' &&
      e.amountMinor > monthlyAvgInflow * 0.2
    );

    for (const event of largeOverdueEvents) {
      if (!overdueEvents.some(e => e.id === event.id && daysBetween(e.dueDate!, today) > 30)) {
        guidance.push({
          id: `large-overdue-${event.id}`,
          severity: 'critical',
          category: 'collect',
          title: `Large overdue: ${event.title}`,
          description: `This overdue amount represents a significant portion of your monthly income.`,
          impactMinor: event.amountMinor,
          impactCurrency: filters.currency,
          relatedEventIds: [event.id],
          primaryAction: { label: 'Mark Paid', type: 'markPaid', payload: { eventId: event.sourceEntityId } },
        });
      }
    }

    // Rule 3: Due in 7 days (warning)
    const dueSoonEvents = events.filter(e =>
      e.direction === 'inflow' &&
      e.state === 'unpaid' &&
      e.dueDate &&
      daysBetween(today, e.dueDate) >= 0 &&
      daysBetween(today, e.dueDate) <= 7
    );

    if (dueSoonEvents.length > 0) {
      const totalDueSoon = dueSoonEvents.reduce((sum, e) => sum + e.amountMinor, 0);
      guidance.push({
        id: 'due-soon-7-days',
        severity: 'warning',
        category: 'collect',
        title: `${dueSoonEvents.length} payment${dueSoonEvents.length > 1 ? 's' : ''} due within 7 days`,
        description: 'Send reminders to ensure timely payment.',
        impactMinor: totalDueSoon,
        impactCurrency: filters.currency,
        relatedEventIds: dueSoonEvents.map(e => e.id),
        primaryAction: { label: 'View Details', type: 'viewReceivables' },
      });
    }

    // Rule 4: Retainer overdue (warning)
    const retainerOverdue = events.filter(e =>
      e.source === 'retainer' &&
      (e.state === 'overdue' || e.state === 'missed')
    );

    if (retainerOverdue.length > 0) {
      const totalRetainerOverdue = retainerOverdue.reduce((sum, e) => sum + e.amountMinor, 0);
      guidance.push({
        id: 'retainer-overdue',
        severity: 'warning',
        category: 'collect',
        title: `${retainerOverdue.length} retainer payment${retainerOverdue.length > 1 ? 's' : ''} overdue`,
        description: 'Follow up on these recurring payments to maintain cash flow.',
        impactMinor: totalRetainerOverdue,
        impactCurrency: filters.currency,
        relatedEventIds: retainerOverdue.map(e => e.id),
        primaryAction: { label: 'View Retainers', type: 'viewRetainers' },
      });
    }

    // Rule 5: Large upcoming expense (warning)
    const largeUpcomingExpenses = events.filter(e =>
      e.direction === 'outflow' &&
      e.state === 'upcoming' &&
      e.amountMinor > monthlyAvgInflow * 0.3
    );

    for (const event of largeUpcomingExpenses) {
      guidance.push({
        id: `large-expense-${event.id}`,
        severity: 'warning',
        category: 'reduce',
        title: `Large upcoming expense: ${event.title}`,
        description: `This expense is significant. Ensure you have sufficient funds.`,
        impactMinor: event.amountMinor,
        impactCurrency: filters.currency,
        relatedEventIds: [event.id],
      });
    }

    // Rule 6: Missing due dates (info)
    const missingDueDates = events.filter(e =>
      e.direction === 'inflow' &&
      e.state === 'unpaid' &&
      !e.dueDate
    );

    if (missingDueDates.length > 0) {
      guidance.push({
        id: 'missing-due-dates',
        severity: 'info',
        category: 'hygiene',
        title: `${missingDueDates.length} receivable${missingDueDates.length > 1 ? 's' : ''} without due date`,
        description: 'Add due dates to track payment timelines better.',
        impactMinor: missingDueDates.reduce((sum, e) => sum + e.amountMinor, 0),
        impactCurrency: filters.currency,
        relatedEventIds: missingDueDates.map(e => e.id),
        primaryAction: { label: 'View Details', type: 'viewReceivables' },
      });
    }

    // Sort by severity
    const severityOrder: Record<GuidanceSeverity, number> = { critical: 0, warning: 1, info: 2 };
    guidance.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return guidance;
  },

  /**
   * Calculate KPI values for the month
   */
  async getMonthKPIs(
    filters: MoneyAnswersFilters,
    openingBalanceMinor: number = 0
  ): Promise<{
    willMakeItMinor: number;
    cashOnHandMinor: number;
    comingMinor: number;
    leakingMinor: number;
    netForecastMinor: number;
  }> {
    if (!filters.month) {
      throw new Error('Month is required for KPIs');
    }

    const today = todayISO();
    const events = await this.getMoneyEvents(filters);

    // Calculate cash on hand (actual paid inflows - actual paid outflows up to today)
    let cashOnHandMinor = openingBalanceMinor;
    let comingMinor = 0; // Upcoming inflows
    let leakingMinor = 0; // Upcoming outflows

    for (const event of events) {
      const isPast = event.eventDate <= today;

      if (event.direction === 'inflow') {
        if (event.state === 'paid' && isPast) {
          cashOnHandMinor += event.amountMinor;
        } else if (event.state === 'unpaid' || event.state === 'overdue' || event.state === 'upcoming') {
          comingMinor += event.amountMinor;
        }
      } else {
        if (event.state === 'paid' && isPast) {
          cashOnHandMinor -= event.amountMinor;
        } else if (event.state === 'upcoming' || event.eventDate > today) {
          leakingMinor += event.amountMinor;
        }
      }
    }

    // Will I make it? = Cash on hand + Coming - Leaking
    const willMakeItMinor = cashOnHandMinor + comingMinor - leakingMinor;

    // Net forecast = Coming - Leaking
    const netForecastMinor = comingMinor - leakingMinor;

    return {
      willMakeItMinor,
      cashOnHandMinor,
      comingMinor,
      leakingMinor,
      netForecastMinor,
    };
  },

  /**
   * Get events for a specific day
   */
  async getDayEvents(date: string, currency: Currency): Promise<MoneyEvent[]> {
    const monthKey = date.substring(0, 7); // YYYY-MM
    const events = await this.getMoneyEvents({
      month: monthKey,
      currency,
      includeReceivables: true,
      includeProjections: true,
    });

    return events.filter(e => e.eventDate === date);
  },

  /**
   * Get all month keys for a year
   */
  getYearMonthKeys(year: number): string[] {
    return Array.from({ length: 12 }, (_, i) =>
      `${year}-${String(i + 1).padStart(2, '0')}`
    );
  },

  /**
   * Get year summary with all month summaries and yearly totals
   */
  async getYearSummary(
    year: number,
    currency: Currency,
    includeReceivables: boolean = true,
    includeProjections: boolean = true
  ): Promise<import('../types').YearSummary> {
    const monthKeys = this.getYearMonthKeys(year);
    const months: import('../types').MonthSummary[] = [];

    let totalInflowMinor = 0;
    let totalOutflowMinor = 0;
    let totalAwaitingMinor = 0;
    let bestMonth: string | undefined;
    let worstMonth: string | undefined;
    let bestNet = -Infinity;
    let worstNet = Infinity;

    // Fetch summary for each month
    for (const monthKey of monthKeys) {
      const summary = await this.getMonthSummary({
        month: monthKey,
        currency,
        includeReceivables,
        includeProjections,
      });
      months.push(summary);

      totalInflowMinor += summary.totalInflowMinor;
      totalOutflowMinor += summary.totalOutflowMinor;
      totalAwaitingMinor += summary.awaitingMinor;

      // Track best and worst months (only if there's any activity)
      if (summary.totalInflowMinor > 0 || summary.totalOutflowMinor > 0) {
        if (summary.netMinor > bestNet) {
          bestNet = summary.netMinor;
          bestMonth = monthKey;
        }
        if (summary.netMinor < worstNet) {
          worstNet = summary.netMinor;
          worstMonth = monthKey;
        }
      }
    }

    // Calculate average awaiting
    const avgAwaitingMinor = Math.round(totalAwaitingMinor / 12);

    // Calculate retainer stability from ProjectedIncome
    let retainerStabilityPercent = 0;
    try {
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year}-12-31`;
      const projectedIncomeItems = await db.projectedIncome
        .filter(pi => {
          if (pi.currency !== currency) return false;
          return pi.expectedDate >= yearStart && pi.expectedDate <= yearEnd;
        })
        .toArray();

      if (projectedIncomeItems.length > 0) {
        const totalExpected = projectedIncomeItems.length;
        const totalReceived = projectedIncomeItems.filter(
          pi => pi.state === 'received' || pi.receivedAmountMinor >= pi.expectedAmountMinor
        ).length;
        retainerStabilityPercent = Math.round((totalReceived / totalExpected) * 100);
      }
    } catch {
      // If projectedIncome table doesn't exist or is empty, leave at 0
    }

    return {
      year,
      totalInflowMinor,
      totalOutflowMinor,
      netMinor: totalInflowMinor - totalOutflowMinor,
      avgAwaitingMinor,
      retainerStabilityPercent,
      months,
      bestMonth,
      worstMonth,
    };
  },

  /**
   * Get year summary for both currencies (for unified display)
   */
  async getYearSummaryBothCurrencies(
    year: number,
    includeReceivables: boolean = true,
    includeProjections: boolean = true
  ): Promise<{
    USD: import('../types').YearSummary;
    ILS: import('../types').YearSummary;
  }> {
    const [usdSummary, ilsSummary] = await Promise.all([
      this.getYearSummary(year, 'USD', includeReceivables, includeProjections),
      this.getYearSummary(year, 'ILS', includeReceivables, includeProjections),
    ]);

    return {
      USD: usdSummary,
      ILS: ilsSummary,
    };
  },

  /**
   * Get month KPIs for both currencies (for unified display)
   */
  async getMonthKPIsBothCurrencies(
    month: string,
    openingBalanceMinorUSD: number = 0,
    openingBalanceMinorILS: number = 0,
    includeReceivables: boolean = true,
    includeProjections: boolean = true
  ): Promise<{
    USD: {
      willMakeItMinor: number;
      cashOnHandMinor: number;
      comingMinor: number;
      leakingMinor: number;
      netForecastMinor: number;
    };
    ILS: {
      willMakeItMinor: number;
      cashOnHandMinor: number;
      comingMinor: number;
      leakingMinor: number;
      netForecastMinor: number;
    };
  }> {
    const [usdKPIs, ilsKPIs] = await Promise.all([
      this.getMonthKPIs({ month, currency: 'USD', includeReceivables, includeProjections }, openingBalanceMinorUSD),
      this.getMonthKPIs({ month, currency: 'ILS', includeReceivables, includeProjections }, openingBalanceMinorILS),
    ]);

    return {
      USD: usdKPIs,
      ILS: ilsKPIs,
    };
  },
};

export default moneyEventRepo;
