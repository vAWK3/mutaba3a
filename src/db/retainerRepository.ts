import { db } from './database';
import type {
  RetainerAgreement,
  RetainerAgreementDisplay,
  ProjectedIncome,
  ProjectedIncomeDisplay,
  RetainerFilters,
  ProjectedIncomeFilters,
  RetainerMatchSuggestion,
  MatchScoreBreakdown,
  Currency,
  Transaction,
  TransactionDisplay,
} from '../types';

// ============================================================================
// Utility Functions
// ============================================================================

function generateId(): string {
  return crypto.randomUUID();
}

function nowISO(): string {
  return new Date().toISOString();
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Calculate days between two dates
 */
function daysBetween(date1: string, date2: string): number {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffTime = d2.getTime() - d1.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Get the last day of a month
 */
function getLastDayOfMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Calculate the payment date for a given month, capped at the last day of the month
 */
function getPaymentDate(year: number, month: number, paymentDay: number): string {
  const lastDay = getLastDayOfMonth(year, month);
  const day = Math.min(paymentDay, lastDay);
  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return dateStr;
}

/**
 * Calculate period start and end for monthly cadence
 */
function getMonthlyPeriod(year: number, month: number): { periodStart: string; periodEnd: string } {
  const periodStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = getLastDayOfMonth(year, month);
  const periodEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { periodStart, periodEnd };
}

/**
 * Calculate period start and end for quarterly cadence
 */
function getQuarterlyPeriod(year: number, quarter: number): { periodStart: string; periodEnd: string } {
  const startMonth = quarter * 3;
  const endMonth = startMonth + 2;
  const periodStart = `${year}-${String(startMonth + 1).padStart(2, '0')}-01`;
  const lastDay = getLastDayOfMonth(year, endMonth);
  const periodEnd = `${year}-${String(endMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { periodStart, periodEnd };
}

// ============================================================================
// Retainer Agreement Repository
// ============================================================================

export const retainerRepo = {
  /**
   * List retainers with display enrichment
   */
  async list(filters: RetainerFilters = {}): Promise<RetainerAgreementDisplay[]> {
    const retainers = await db.retainerAgreements.toArray();
    const clients = await db.clients.toArray();
    const projects = await db.projects.toArray();
    const profiles = await db.businessProfiles.toArray();
    const projectedIncomeItems = await db.projectedIncome.toArray();

    const clientMap = new Map(clients.map((c) => [c.id, c.name]));
    const projectMap = new Map(projects.map((p) => [p.id, p.name]));
    const profileMap = new Map(profiles.map((p) => [p.id, p.name]));

    // Group projected income by retainer
    const projectedByRetainer = new Map<string, ProjectedIncome[]>();
    projectedIncomeItems.forEach((pi) => {
      const list = projectedByRetainer.get(pi.sourceId) || [];
      list.push(pi);
      projectedByRetainer.set(pi.sourceId, list);
    });

    let filtered = retainers.filter((r) => {
      // Exclude archived
      if (r.archivedAt) return false;

      // Apply filters
      if (filters.profileId && r.profileId !== filters.profileId) return false;
      if (filters.status && r.status !== filters.status) return false;
      if (filters.currency && r.currency !== filters.currency) return false;
      if (filters.clientId && r.clientId !== filters.clientId) return false;
      if (filters.projectId && r.projectId !== filters.projectId) return false;

      // Search
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const clientName = clientMap.get(r.clientId) || '';
        const projectName = r.projectId ? projectMap.get(r.projectId) || '' : '';
        const matchesSearch =
          r.title.toLowerCase().includes(searchLower) ||
          clientName.toLowerCase().includes(searchLower) ||
          projectName.toLowerCase().includes(searchLower);
        if (!matchesSearch) return false;
      }

      return true;
    });

    // Filter by due items if requested
    if (filters.dueOnly) {
      filtered = filtered.filter((r) => {
        const items = projectedByRetainer.get(r.id) || [];
        return items.some((pi) => pi.state === 'due');
      });
    }

    // Sort by createdAt desc
    filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    // Enrich with display data
    return filtered.map((r) => {
      const items = projectedByRetainer.get(r.id) || [];
      const dueItems = items.filter((pi) => pi.state === 'due');
      const receivedItems = items.filter((pi) => pi.state === 'received' || pi.state === 'partial');
      const upcomingItems = items.filter((pi) => pi.state === 'upcoming');

      // Calculate due now total
      const dueNowAmountMinor = dueItems.reduce(
        (sum, pi) => sum + (pi.expectedAmountMinor - pi.receivedAmountMinor),
        0
      );

      // Next expected date from upcoming items
      const nextExpectedDate = upcomingItems.length > 0
        ? upcomingItems.sort((a, b) => a.expectedDate.localeCompare(b.expectedDate))[0].expectedDate
        : undefined;

      // Last received info
      const lastReceived = receivedItems.length > 0
        ? receivedItems.sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || ''))[0]
        : undefined;

      return {
        ...r,
        profileName: profileMap.get(r.profileId),
        clientName: clientMap.get(r.clientId),
        projectName: r.projectId ? projectMap.get(r.projectId) : undefined,
        nextExpectedDate,
        dueNowAmountMinor,
        lastReceivedDate: lastReceived?.receivedAt,
        lastReceivedAmountMinor: lastReceived?.receivedAmountMinor,
      };
    });
  },

  /**
   * Get a single retainer by ID
   */
  async get(id: string): Promise<RetainerAgreement | undefined> {
    return db.retainerAgreements.get(id);
  },

  /**
   * Get retainer with display enrichment
   */
  async getDisplay(id: string): Promise<RetainerAgreementDisplay | undefined> {
    const retainer = await this.get(id);
    if (!retainer) return undefined;

    const profile = retainer.profileId ? await db.businessProfiles.get(retainer.profileId) : undefined;
    const client = retainer.clientId ? await db.clients.get(retainer.clientId) : undefined;
    const project = retainer.projectId ? await db.projects.get(retainer.projectId) : undefined;
    const items = await projectedIncomeRepo.getByRetainer(id);

    const dueItems = items.filter((pi) => pi.state === 'due');
    const receivedItems = items.filter((pi) => pi.state === 'received' || pi.state === 'partial');
    const upcomingItems = items.filter((pi) => pi.state === 'upcoming');

    const dueNowAmountMinor = dueItems.reduce(
      (sum, pi) => sum + (pi.expectedAmountMinor - pi.receivedAmountMinor),
      0
    );

    const nextExpectedDate = upcomingItems.length > 0
      ? upcomingItems.sort((a, b) => a.expectedDate.localeCompare(b.expectedDate))[0].expectedDate
      : undefined;

    const lastReceived = receivedItems.length > 0
      ? receivedItems.sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || ''))[0]
      : undefined;

    return {
      ...retainer,
      profileName: profile?.name,
      clientName: client?.name,
      projectName: project?.name,
      nextExpectedDate,
      dueNowAmountMinor,
      lastReceivedDate: lastReceived?.receivedAt,
      lastReceivedAmountMinor: lastReceived?.receivedAmountMinor,
    };
  },

  /**
   * Create a new retainer and generate schedule
   */
  async create(
    data: Omit<RetainerAgreement, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<RetainerAgreement> {
    const now = nowISO();
    const retainer: RetainerAgreement = {
      ...data,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    await db.retainerAgreements.add(retainer);

    // Generate schedule if active
    if (retainer.status === 'active') {
      await scheduleGenerator.generateSchedule(retainer.id);
    }

    return retainer;
  },

  /**
   * Update a retainer and regenerate schedule if needed
   */
  async update(id: string, data: Partial<RetainerAgreement>): Promise<void> {
    const existing = await this.get(id);
    if (!existing) return;

    await db.retainerAgreements.update(id, { ...data, updatedAt: nowISO() });

    // Regenerate schedule if key fields changed
    const regenerateFields = ['amountMinor', 'cadence', 'paymentDay', 'startDate', 'endDate'];
    const needsRegenerate = regenerateFields.some((field) => field in data);

    if (needsRegenerate && existing.status === 'active') {
      await scheduleGenerator.regenerateSchedule(id);
    }
  },

  /**
   * Archive a retainer (soft delete)
   */
  async archive(id: string): Promise<void> {
    await db.retainerAgreements.update(id, {
      archivedAt: nowISO(),
      updatedAt: nowISO()
    });
  },

  /**
   * Activate a draft retainer
   */
  async activate(id: string): Promise<void> {
    const retainer = await this.get(id);
    if (!retainer || retainer.status !== 'draft') return;

    await db.retainerAgreements.update(id, {
      status: 'active',
      updatedAt: nowISO()
    });

    // Generate schedule
    await scheduleGenerator.generateSchedule(id);
  },

  /**
   * Pause an active retainer
   */
  async pause(id: string): Promise<void> {
    const retainer = await this.get(id);
    if (!retainer || retainer.status !== 'active') return;

    await db.retainerAgreements.update(id, {
      status: 'paused',
      updatedAt: nowISO()
    });

    // Cancel future upcoming items
    const items = await projectedIncomeRepo.getByRetainer(id);
    for (const item of items) {
      if (item.state === 'upcoming') {
        await db.projectedIncome.update(item.id, {
          state: 'canceled',
          updatedAt: nowISO()
        });
      }
    }
  },

  /**
   * Resume a paused retainer
   */
  async resume(id: string): Promise<void> {
    const retainer = await this.get(id);
    if (!retainer || retainer.status !== 'paused') return;

    await db.retainerAgreements.update(id, {
      status: 'active',
      updatedAt: nowISO()
    });

    // Regenerate schedule
    await scheduleGenerator.regenerateSchedule(id);
  },

  /**
   * End a retainer
   */
  async end(id: string): Promise<void> {
    const retainer = await this.get(id);
    if (!retainer || (retainer.status !== 'active' && retainer.status !== 'paused')) return;

    await db.retainerAgreements.update(id, {
      status: 'ended',
      endDate: todayISO(),
      updatedAt: nowISO()
    });

    // Cancel future upcoming items
    const items = await projectedIncomeRepo.getByRetainer(id);
    for (const item of items) {
      if (item.state === 'upcoming') {
        await db.projectedIncome.update(item.id, {
          state: 'canceled',
          updatedAt: nowISO()
        });
      }
    }
  },
};

// ============================================================================
// Projected Income Repository
// ============================================================================

export const projectedIncomeRepo = {
  /**
   * List projected income with display enrichment
   */
  async list(filters: ProjectedIncomeFilters = {}): Promise<ProjectedIncomeDisplay[]> {
    const items = await db.projectedIncome.toArray();
    const clients = await db.clients.toArray();
    const projects = await db.projects.toArray();
    const retainers = await db.retainerAgreements.toArray();

    const clientMap = new Map(clients.map((c) => [c.id, c.name]));
    const projectMap = new Map(projects.map((p) => [p.id, p.name]));
    const retainerMap = new Map(retainers.map((r) => [r.id, r.title]));

    const today = todayISO();

    const filtered = items.filter((pi) => {
      if (filters.profileId && pi.profileId !== filters.profileId) return false;
      if (filters.sourceId && pi.sourceId !== filters.sourceId) return false;
      if (filters.clientId && pi.clientId !== filters.clientId) return false;
      if (filters.currency && pi.currency !== filters.currency) return false;

      // Filter by state (single or multiple)
      if (filters.state) {
        const states = Array.isArray(filters.state) ? filters.state : [filters.state];
        if (!states.includes(pi.state)) return false;
      }

      // Date range filter
      if (filters.dateFrom && pi.expectedDate < filters.dateFrom) return false;
      if (filters.dateTo && pi.expectedDate > filters.dateTo) return false;

      return true;
    });

    // Sort by expected date
    filtered.sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));

    return filtered.map((pi) => {
      const daysOverdue = pi.state === 'due' ? daysBetween(pi.expectedDate, today) : undefined;

      return {
        ...pi,
        clientName: clientMap.get(pi.clientId),
        projectName: pi.projectId ? projectMap.get(pi.projectId) : undefined,
        retainerTitle: retainerMap.get(pi.sourceId),
        daysOverdue: daysOverdue !== undefined && daysOverdue > 0 ? daysOverdue : undefined,
      };
    });
  },

  /**
   * Get projected income items for a specific retainer
   */
  async getByRetainer(retainerId: string): Promise<ProjectedIncome[]> {
    return db.projectedIncome.where('sourceId').equals(retainerId).toArray();
  },

  /**
   * Get all due items optionally filtered by currency
   */
  async getDueItems(currency?: Currency): Promise<ProjectedIncomeDisplay[]> {
    return this.list({
      state: 'due',
      currency,
    });
  },

  /**
   * Get items for forecast (upcoming and due)
   */
  async getForForecast(
    dateFrom: string,
    dateTo: string,
    currency?: Currency
  ): Promise<ProjectedIncomeDisplay[]> {
    return this.list({
      state: ['upcoming', 'due', 'partial'],
      dateFrom,
      dateTo,
      currency,
    });
  },

  /**
   * Get a single projected income item
   */
  async get(id: string): Promise<ProjectedIncome | undefined> {
    return db.projectedIncome.get(id);
  },

  /**
   * Update a projected income item
   */
  async update(id: string, data: Partial<ProjectedIncome>): Promise<void> {
    await db.projectedIncome.update(id, { ...data, updatedAt: nowISO() });
  },
};

// ============================================================================
// Schedule Generator
// ============================================================================

export const scheduleGenerator = {
  /**
   * Generate schedule for a retainer (up to 12 months ahead)
   */
  async generateSchedule(retainerId: string): Promise<void> {
    const retainer = await retainerRepo.get(retainerId);
    if (!retainer || retainer.status !== 'active') return;

    const now = nowISO();
    const today = todayISO();

    // Calculate horizon (end date or 12 months from today)
    const horizonDate = new Date();
    horizonDate.setMonth(horizonDate.getMonth() + 12);
    const horizon = retainer.endDate
      ? retainer.endDate < horizonDate.toISOString().split('T')[0]
        ? retainer.endDate
        : horizonDate.toISOString().split('T')[0]
      : horizonDate.toISOString().split('T')[0];

    // Get existing items for idempotency
    const existingItems = await projectedIncomeRepo.getByRetainer(retainerId);
    const existingPeriods = new Set(
      existingItems.map((pi) => `${pi.periodStart}-${pi.periodEnd}`)
    );

    // Generate periods based on cadence
    const newItems: ProjectedIncome[] = [];
    const currentDate = new Date(retainer.startDate);

    while (currentDate.toISOString().split('T')[0] <= horizon) {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth();

      let periodStart: string;
      let periodEnd: string;
      let expectedDate: string;

      if (retainer.cadence === 'monthly') {
        const period = getMonthlyPeriod(year, month);
        periodStart = period.periodStart;
        periodEnd = period.periodEnd;
        expectedDate = getPaymentDate(year, month, retainer.paymentDay);

        // Move to next month
        currentDate.setMonth(currentDate.getMonth() + 1);
      } else {
        // Quarterly
        const quarter = Math.floor(month / 3);
        const period = getQuarterlyPeriod(year, quarter);
        periodStart = period.periodStart;
        periodEnd = period.periodEnd;
        // Payment date is in the last month of the quarter
        const lastMonthOfQuarter = quarter * 3 + 2;
        expectedDate = getPaymentDate(year, lastMonthOfQuarter, retainer.paymentDay);

        // Move to next quarter
        currentDate.setMonth(currentDate.getMonth() + 3);
      }

      // Skip if before start date
      if (periodEnd < retainer.startDate) continue;

      // Skip if already exists
      const periodKey = `${periodStart}-${periodEnd}`;
      if (existingPeriods.has(periodKey)) continue;

      // Skip if past end date
      if (retainer.endDate && periodStart > retainer.endDate) break;

      // Determine initial state
      const state = expectedDate <= today ? 'due' : 'upcoming';

      const item: ProjectedIncome = {
        id: generateId(),
        profileId: retainer.profileId,
        sourceType: 'retainer',
        sourceId: retainerId,
        clientId: retainer.clientId,
        projectId: retainer.projectId,
        currency: retainer.currency,
        expectedAmountMinor: retainer.amountMinor,
        expectedDate,
        periodStart,
        periodEnd,
        state,
        receivedAmountMinor: 0,
        matchedTransactionIds: [],
        createdAt: now,
        updatedAt: now,
      };

      newItems.push(item);
    }

    // Bulk insert new items
    if (newItems.length > 0) {
      await db.projectedIncome.bulkAdd(newItems);
    }
  },

  /**
   * Regenerate schedule after retainer edit (preserves received/partial states)
   */
  async regenerateSchedule(retainerId: string): Promise<void> {
    const retainer = await retainerRepo.get(retainerId);
    if (!retainer) return;

    const existingItems = await projectedIncomeRepo.getByRetainer(retainerId);

    // Delete only upcoming and canceled items
    const itemsToDelete = existingItems.filter(
      (pi) => pi.state === 'upcoming' || pi.state === 'canceled'
    );
    for (const item of itemsToDelete) {
      await db.projectedIncome.delete(item.id);
    }

    // Regenerate schedule if active
    if (retainer.status === 'active') {
      await this.generateSchedule(retainerId);
    }
  },

  /**
   * Update due states based on today's date
   * Should be called periodically (e.g., on app load)
   */
  async updateDueStates(): Promise<void> {
    const today = todayISO();
    const upcomingItems = await db.projectedIncome
      .where('state')
      .equals('upcoming')
      .toArray();

    for (const item of upcomingItems) {
      if (item.expectedDate <= today) {
        await db.projectedIncome.update(item.id, {
          state: 'due',
          updatedAt: nowISO(),
        });
      }
    }
  },
};

// ============================================================================
// Transaction Matching
// ============================================================================

export const retainerMatching = {
  /**
   * Get match suggestions for a transaction
   */
  async getSuggestionsForTransaction(
    transactionId: string
  ): Promise<RetainerMatchSuggestion[]> {
    const transaction = await db.transactions.get(transactionId);
    if (!transaction) return [];

    // Only match income transactions that are paid
    if (transaction.kind !== 'income' || transaction.status !== 'paid') return [];

    // Get unmatched projected income items
    const items = await projectedIncomeRepo.list({
      state: ['due', 'partial'],
      currency: transaction.currency,
    });

    // Filter out items that are already fully matched
    const unmatchedItems = items.filter(
      (pi) =>
        pi.receivedAmountMinor < pi.expectedAmountMinor &&
        !pi.matchedTransactionIds.includes(transactionId)
    );

    // Calculate scores
    const suggestions: RetainerMatchSuggestion[] = [];

    for (const item of unmatchedItems) {
      const scoreBreakdown = this.calculateMatchScore(transaction, item);
      const score = scoreBreakdown.total;

      if (score >= 40) {
        let confidence: 'high' | 'medium' | 'low';
        if (score >= 80) {
          confidence = 'high';
        } else if (score >= 60) {
          confidence = 'medium';
        } else {
          confidence = 'low';
        }

        suggestions.push({
          projectedIncomeId: item.id,
          score,
          confidence,
          projectedIncome: item,
          scoreBreakdown,
        });
      }
    }

    // Sort by score descending
    return suggestions.sort((a, b) => b.score - a.score).slice(0, 10);
  },

  /**
   * Calculate match score between a transaction and projected income
   * Score (0-100):
   * - Currency match: 30 points (required)
   * - Client match: 30 points
   * - Amount proximity: 25 points
   * - Date proximity: 15 points
   */
  calculateMatchScore(
    transaction: Transaction,
    projectedIncome: ProjectedIncomeDisplay
  ): MatchScoreBreakdown {
    const breakdown: MatchScoreBreakdown = {
      total: 0,
      currency: 0,
      client: 0,
      amount: 0,
      date: 0,
    };

    // Currency match (required)
    if (transaction.currency !== projectedIncome.currency) {
      return breakdown;
    }
    breakdown.currency = 30;

    // Client match
    if (transaction.clientId && transaction.clientId === projectedIncome.clientId) {
      breakdown.client = 30;
    }

    // Amount proximity
    const remainingAmount =
      projectedIncome.expectedAmountMinor - projectedIncome.receivedAmountMinor;
    const diff = Math.abs(transaction.amountMinor - remainingAmount);
    const percentDiff = remainingAmount > 0 ? diff / remainingAmount : 1;

    if (percentDiff <= 0.01) {
      breakdown.amount = 25; // Exact or within 1%
    } else if (percentDiff <= 0.05) {
      breakdown.amount = 20; // Within 5%
    } else if (percentDiff <= 0.1) {
      breakdown.amount = 15; // Within 10%
    } else if (percentDiff <= 0.2) {
      breakdown.amount = 10; // Within 20%
    }

    // Date proximity
    const transactionDate = transaction.occurredAt.split('T')[0];
    const daysDiff = Math.abs(daysBetween(transactionDate, projectedIncome.expectedDate));

    if (daysDiff <= 3) {
      breakdown.date = 15;
    } else if (daysDiff <= 7) {
      breakdown.date = 12;
    } else if (daysDiff <= 14) {
      breakdown.date = 8;
    } else if (daysDiff <= 30) {
      breakdown.date = 4;
    }

    breakdown.total = breakdown.currency + breakdown.client + breakdown.amount + breakdown.date;
    return breakdown;
  },

  /**
   * Match a transaction to a projected income item
   */
  async matchTransaction(
    projectedIncomeId: string,
    transactionId: string
  ): Promise<void> {
    const projectedIncome = await projectedIncomeRepo.get(projectedIncomeId);
    const transaction = await db.transactions.get(transactionId);

    if (!projectedIncome || !transaction) return;

    // Add transaction to matched list
    const matchedTransactionIds = [
      ...projectedIncome.matchedTransactionIds,
      transactionId,
    ];

    // Calculate new received amount
    const receivedAmountMinor =
      projectedIncome.receivedAmountMinor + transaction.amountMinor;

    // Determine new state
    let state = projectedIncome.state;
    if (receivedAmountMinor >= projectedIncome.expectedAmountMinor) {
      state = 'received';
    } else if (receivedAmountMinor > 0) {
      state = 'partial';
    }

    // Update projected income
    await db.projectedIncome.update(projectedIncomeId, {
      matchedTransactionIds,
      receivedAmountMinor,
      receivedAt: state === 'received' ? nowISO() : projectedIncome.receivedAt,
      state,
      updatedAt: nowISO(),
    });

    // Update transaction with link
    await db.transactions.update(transactionId, {
      linkedProjectedIncomeId: projectedIncomeId,
      updatedAt: nowISO(),
    });
  },

  /**
   * Unmatch a transaction from a projected income item
   */
  async unmatchTransaction(
    projectedIncomeId: string,
    transactionId: string
  ): Promise<void> {
    const projectedIncome = await projectedIncomeRepo.get(projectedIncomeId);
    const transaction = await db.transactions.get(transactionId);

    if (!projectedIncome || !transaction) return;

    // Remove transaction from matched list
    const matchedTransactionIds = projectedIncome.matchedTransactionIds.filter(
      (id) => id !== transactionId
    );

    // Calculate new received amount
    const receivedAmountMinor = Math.max(
      0,
      projectedIncome.receivedAmountMinor - transaction.amountMinor
    );

    // Determine new state
    let state = projectedIncome.state;
    const today = todayISO();
    if (receivedAmountMinor === 0) {
      state = projectedIncome.expectedDate <= today ? 'due' : 'upcoming';
    } else {
      state = 'partial';
    }

    // Update projected income
    await db.projectedIncome.update(projectedIncomeId, {
      matchedTransactionIds,
      receivedAmountMinor,
      receivedAt: matchedTransactionIds.length > 0 ? projectedIncome.receivedAt : undefined,
      state,
      updatedAt: nowISO(),
    });

    // Remove link from transaction
    await db.transactions.update(transactionId, {
      linkedProjectedIncomeId: undefined,
      updatedAt: nowISO(),
    });
  },

  /**
   * Get all suggestions for unlinked income transactions
   */
  async getAllSuggestionsForUnlinkedTransactions(): Promise<
    Array<{ transaction: TransactionDisplay; suggestions: RetainerMatchSuggestion[] }>
  > {
    // Get all paid income transactions without a projected income link
    const transactions = await db.transactions
      .filter(
        (t) =>
          t.kind === 'income' &&
          t.status === 'paid' &&
          !t.deletedAt &&
          !t.linkedProjectedIncomeId
      )
      .toArray();

    const clients = await db.clients.toArray();
    const projects = await db.projects.toArray();
    const categories = await db.categories.toArray();

    const clientMap = new Map(clients.map((c) => [c.id, c.name]));
    const projectMap = new Map(projects.map((p) => [p.id, p.name]));
    const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

    const results = [];

    for (const tx of transactions) {
      const suggestions = await this.getSuggestionsForTransaction(tx.id);

      if (suggestions.length > 0) {
        const transactionDisplay: TransactionDisplay = {
          ...tx,
          clientName: tx.clientId ? clientMap.get(tx.clientId) : undefined,
          projectName: tx.projectId ? projectMap.get(tx.projectId) : undefined,
          categoryName: tx.categoryId ? categoryMap.get(tx.categoryId) : undefined,
        };

        results.push({
          transaction: transactionDisplay,
          suggestions,
        });
      }
    }

    return results;
  },
};

/**
 * Mark projected income as missed (manual action)
 */
export async function markProjectedIncomeMissed(id: string): Promise<void> {
  await db.projectedIncome.update(id, {
    state: 'missed',
    updatedAt: nowISO(),
  });
}

/**
 * Retainer summary with amounts broken down by currency
 */
export interface RetainerSummary {
  activeCount: number;
  // Monthly expected by currency
  totalExpectedMonthlyUsdMinor: number;
  totalExpectedMonthlyIlsMinor: number;
  // Due by currency
  totalDueUsdMinor: number;
  totalDueIlsMinor: number;
  // Overdue by currency
  totalOverdueUsdMinor: number;
  totalOverdueIlsMinor: number;
}

/**
 * Get retainer totals summary with amounts broken down by currency
 */
export async function getRetainerSummary(profileId?: string, currency?: Currency): Promise<RetainerSummary> {
  const retainers = await db.retainerAgreements
    .filter((r) => r.status === 'active' && !r.archivedAt)
    .toArray();

  // Get due items without currency filter to get both currencies
  const allDueItems = await projectedIncomeRepo.list({
    profileId,
    state: 'due',
  });
  const today = todayISO();

  let activeCount = 0;
  let totalExpectedMonthlyUsdMinor = 0;
  let totalExpectedMonthlyIlsMinor = 0;

  for (const r of retainers) {
    if (profileId && r.profileId !== profileId) continue;
    // When currency filter is applied, only count matching retainers
    if (currency && r.currency !== currency) continue;
    activeCount++;

    // Convert to monthly equivalent
    const monthlyAmount =
      r.cadence === 'quarterly' ? r.amountMinor / 3 : r.amountMinor;

    if (r.currency === 'USD') {
      totalExpectedMonthlyUsdMinor += monthlyAmount;
    } else {
      totalExpectedMonthlyIlsMinor += monthlyAmount;
    }
  }

  let totalDueUsdMinor = 0;
  let totalDueIlsMinor = 0;
  let totalOverdueUsdMinor = 0;
  let totalOverdueIlsMinor = 0;

  for (const item of allDueItems) {
    // When currency filter is applied, only count matching items
    if (currency && item.currency !== currency) continue;

    const remaining = item.expectedAmountMinor - item.receivedAmountMinor;

    if (item.currency === 'USD') {
      totalDueUsdMinor += remaining;
      if (item.expectedDate < today) {
        totalOverdueUsdMinor += remaining;
      }
    } else {
      totalDueIlsMinor += remaining;
      if (item.expectedDate < today) {
        totalOverdueIlsMinor += remaining;
      }
    }
  }

  return {
    activeCount,
    totalExpectedMonthlyUsdMinor,
    totalExpectedMonthlyIlsMinor,
    totalDueUsdMinor,
    totalDueIlsMinor,
    totalOverdueUsdMinor,
    totalOverdueIlsMinor,
  };
}
