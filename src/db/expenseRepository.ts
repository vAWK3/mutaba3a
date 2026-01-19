import { db } from './database';
import type {
  Expense,
  RecurringRule,
  Receipt,
  ExpenseCategory,
  ExpenseFilters,
  ReceiptFilters,
  ExpenseDisplay,
  MonthlyExpenseTotal,
  ProfileExpenseSummary,
  Vendor,
  MonthCloseStatus,
  MonthCloseChecklist,
  MonthCloseComputedStatus,
  ReceiptMatchSuggestion,
} from '../types';
import { normalizeVendor, vendorSimilarity, suggestCanonicalName } from '../lib/vendorNormalization';

function generateId(): string {
  return crypto.randomUUID();
}

function nowISO(): string {
  return new Date().toISOString();
}

// ============================================================================
// Expense Repository
// ============================================================================

export const expenseRepo = {
  async list(filters: ExpenseFilters = {}): Promise<ExpenseDisplay[]> {
    const expenses = await db.expenses.toArray();
    const categories = await db.expenseCategories.toArray();
    const receipts = await db.receipts.toArray();

    const categoryMap = new Map(categories.map((c) => [c.id, c]));

    // Count receipts per expense
    const receiptCounts = new Map<string, number>();
    receipts.forEach((r) => {
      if (r.expenseId) {
        receiptCounts.set(r.expenseId, (receiptCounts.get(r.expenseId) || 0) + 1);
      }
    });

    let filtered = expenses.filter((e) => {
      if (!filters.includeDeleted && e.deletedAt) return false;
      if (filters.profileId && e.profileId !== filters.profileId) return false;
      if (filters.categoryId && e.categoryId !== filters.categoryId) return false;
      if (filters.currency && e.currency !== filters.currency) return false;

      // Filter by year
      if (filters.year) {
        const expenseYear = new Date(e.occurredAt).getFullYear();
        if (expenseYear !== filters.year) return false;
      }

      // Filter by month
      if (filters.month) {
        const expenseMonth = new Date(e.occurredAt).getMonth() + 1;
        if (expenseMonth !== filters.month) return false;
      }

      // Search
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const categoryName = e.categoryId ? categoryMap.get(e.categoryId)?.name : '';
        const matchesSearch =
          e.title?.toLowerCase().includes(searchLower) ||
          e.vendor?.toLowerCase().includes(searchLower) ||
          e.notes?.toLowerCase().includes(searchLower) ||
          categoryName?.toLowerCase().includes(searchLower);
        if (!matchesSearch) return false;
      }

      return true;
    });

    // Sort
    const sortBy = filters.sort?.by || 'occurredAt';
    const sortDir = filters.sort?.dir || 'desc';
    filtered.sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[sortBy];
      const bVal = (b as unknown as Record<string, unknown>)[sortBy];
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return 0;
    });

    // Pagination
    if (filters.offset) {
      filtered = filtered.slice(filters.offset);
    }
    if (filters.limit) {
      filtered = filtered.slice(0, filters.limit);
    }

    return filtered.map((e) => {
      const category = e.categoryId ? categoryMap.get(e.categoryId) : undefined;
      return {
        ...e,
        categoryName: category?.name,
        categoryColor: category?.color,
        receiptCount: receiptCounts.get(e.id) || 0,
        isFromRecurring: !!e.recurringRuleId,
      };
    });
  },

  async get(id: string): Promise<Expense | undefined> {
    return db.expenses.get(id);
  },

  async create(data: Omit<Expense, 'id' | 'createdAt' | 'updatedAt'>): Promise<Expense> {
    const now = nowISO();
    const expense: Expense = {
      ...data,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    await db.expenses.add(expense);
    return expense;
  },

  async update(id: string, data: Partial<Expense>): Promise<void> {
    await db.expenses.update(id, { ...data, updatedAt: nowISO() });
  },

  async softDelete(id: string): Promise<void> {
    await db.expenses.update(id, { deletedAt: nowISO(), updatedAt: nowISO() });
  },

  async delete(id: string): Promise<void> {
    await db.expenses.delete(id);
  },

  async getYearlyTotals(
    profileId: string,
    year: number
  ): Promise<{
    totalMinorUSD: number;
    totalMinorILS: number;
    byMonth: MonthlyExpenseTotal[];
  }> {
    const expenses = await db.expenses
      .where('profileId')
      .equals(profileId)
      .filter((e) => {
        if (e.deletedAt) return false;
        const expenseYear = new Date(e.occurredAt).getFullYear();
        return expenseYear === year;
      })
      .toArray();

    let totalMinorUSD = 0;
    let totalMinorILS = 0;
    const monthlyTotals: Map<number, { USD: number; ILS: number }> = new Map();

    // Initialize all months
    for (let m = 1; m <= 12; m++) {
      monthlyTotals.set(m, { USD: 0, ILS: 0 });
    }

    expenses.forEach((e) => {
      const month = new Date(e.occurredAt).getMonth() + 1;
      const monthData = monthlyTotals.get(month)!;

      if (e.currency === 'USD') {
        totalMinorUSD += e.amountMinor;
        monthData.USD += e.amountMinor;
      } else {
        totalMinorILS += e.amountMinor;
        monthData.ILS += e.amountMinor;
      }
    });

    const byMonth: MonthlyExpenseTotal[] = [];
    for (let m = 1; m <= 12; m++) {
      const data = monthlyTotals.get(m)!;
      byMonth.push({
        month: m,
        totalMinorUSD: data.USD,
        totalMinorILS: data.ILS,
      });
    }

    return { totalMinorUSD, totalMinorILS, byMonth };
  },

  async getAllProfilesTotals(year: number): Promise<ProfileExpenseSummary[]> {
    const profiles = await db.businessProfiles.filter((p) => !p.archivedAt).toArray();

    const summaries: ProfileExpenseSummary[] = [];

    for (const profile of profiles) {
      const totals = await this.getYearlyTotals(profile.id, year);

      summaries.push({
        profileId: profile.id,
        profileName: profile.name,
        year,
        totalMinorUSD: totals.totalMinorUSD,
        totalMinorILS: totals.totalMinorILS,
        monthlyBreakdown: totals.byMonth,
      });
    }

    return summaries;
  },

  async getReceiptCount(expenseId: string): Promise<number> {
    return db.receipts.where('expenseId').equals(expenseId).count();
  },
};

// ============================================================================
// Recurring Rule Repository
// ============================================================================

export const recurringRuleRepo = {
  async list(profileId?: string): Promise<RecurringRule[]> {
    let query = db.recurringRules.toCollection();
    if (profileId) {
      query = db.recurringRules.where('profileId').equals(profileId);
    }
    return query.toArray();
  },

  async listActive(profileId?: string): Promise<RecurringRule[]> {
    const rules = await this.list(profileId);
    return rules.filter((r) => !r.isPaused);
  },

  async get(id: string): Promise<RecurringRule | undefined> {
    return db.recurringRules.get(id);
  },

  async create(data: Omit<RecurringRule, 'id' | 'createdAt' | 'updatedAt'>): Promise<RecurringRule> {
    const now = nowISO();
    const rule: RecurringRule = {
      ...data,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    await db.recurringRules.add(rule);
    return rule;
  },

  async update(id: string, data: Partial<RecurringRule>): Promise<void> {
    await db.recurringRules.update(id, { ...data, updatedAt: nowISO() });
  },

  async pause(id: string): Promise<void> {
    await db.recurringRules.update(id, { isPaused: true, updatedAt: nowISO() });
  },

  async resume(id: string): Promise<void> {
    await db.recurringRules.update(id, { isPaused: false, updatedAt: nowISO() });
  },

  async delete(id: string): Promise<void> {
    await db.recurringRules.delete(id);
  },
};

// ============================================================================
// Receipt Repository
// ============================================================================

export const receiptRepo = {
  async list(filters: ReceiptFilters = {}): Promise<Receipt[]> {
    let receipts = await db.receipts.toArray();

    receipts = receipts.filter((r) => {
      if (filters.profileId && r.profileId !== filters.profileId) return false;
      if (filters.expenseId && r.expenseId !== filters.expenseId) return false;
      if (filters.monthKey && r.monthKey !== filters.monthKey) return false;
      if (filters.unlinkedOnly && r.expenseId) return false;
      return true;
    });

    // Sort by createdAt desc
    receipts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    // Pagination
    if (filters.offset) {
      receipts = receipts.slice(filters.offset);
    }
    if (filters.limit) {
      receipts = receipts.slice(0, filters.limit);
    }

    return receipts;
  },

  async get(id: string): Promise<Receipt | undefined> {
    return db.receipts.get(id);
  },

  async create(data: Omit<Receipt, 'id' | 'createdAt' | 'updatedAt'>): Promise<Receipt> {
    const now = nowISO();
    const receipt: Receipt = {
      ...data,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    await db.receipts.add(receipt);
    return receipt;
  },

  async update(id: string, data: Partial<Receipt>): Promise<void> {
    await db.receipts.update(id, { ...data, updatedAt: nowISO() });
  },

  async delete(id: string): Promise<void> {
    await db.receipts.delete(id);
  },

  async linkToExpense(receiptId: string, expenseId: string): Promise<void> {
    // Get the expense to derive monthKey
    const expense = await expenseRepo.get(expenseId);
    const monthKey = expense
      ? expense.occurredAt.substring(0, 7) // YYYY-MM
      : new Date().toISOString().substring(0, 7);

    await db.receipts.update(receiptId, {
      expenseId,
      monthKey,
      updatedAt: nowISO(),
    });
  },

  async unlinkFromExpense(receiptId: string): Promise<void> {
    await db.receipts.update(receiptId, {
      expenseId: undefined,
      updatedAt: nowISO(),
    });
  },

  async getUnlinkedByProfile(profileId: string): Promise<Receipt[]> {
    return db.receipts
      .where('profileId')
      .equals(profileId)
      .filter((r) => !r.expenseId)
      .toArray();
  },

  async getByProfileAndMonth(profileId: string, monthKey: string): Promise<Receipt[]> {
    return db.receipts
      .where('profileId')
      .equals(profileId)
      .filter((r) => r.monthKey === monthKey)
      .toArray();
  },

  async getLinkedByProfileAndMonth(profileId: string, monthKey: string): Promise<Receipt[]> {
    return db.receipts
      .where('profileId')
      .equals(profileId)
      .filter((r) => r.monthKey === monthKey && !!r.expenseId)
      .toArray();
  },
};

// ============================================================================
// Expense Category Repository (profile-scoped)
// ============================================================================

export const expenseCategoryRepo = {
  async list(profileId: string): Promise<ExpenseCategory[]> {
    return db.expenseCategories.where('profileId').equals(profileId).sortBy('name');
  },

  async get(id: string): Promise<ExpenseCategory | undefined> {
    return db.expenseCategories.get(id);
  },

  async create(data: Omit<ExpenseCategory, 'id'>): Promise<ExpenseCategory> {
    const category: ExpenseCategory = {
      ...data,
      id: generateId(),
    };
    await db.expenseCategories.add(category);
    return category;
  },

  async update(id: string, data: Partial<ExpenseCategory>): Promise<void> {
    await db.expenseCategories.update(id, data);
  },

  async delete(id: string): Promise<void> {
    await db.expenseCategories.delete(id);
  },
};

// ============================================================================
// Vendor Repository (profile-scoped)
// ============================================================================

export const vendorRepo = {
  async list(profileId: string): Promise<Vendor[]> {
    return db.vendors.where('profileId').equals(profileId).sortBy('canonicalName');
  },

  async get(id: string): Promise<Vendor | undefined> {
    return db.vendors.get(id);
  },

  async create(data: Omit<Vendor, 'id' | 'createdAt' | 'updatedAt'>): Promise<Vendor> {
    const now = nowISO();
    const vendor: Vendor = {
      ...data,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    await db.vendors.add(vendor);
    return vendor;
  },

  async update(id: string, data: Partial<Vendor>): Promise<void> {
    await db.vendors.update(id, { ...data, updatedAt: nowISO() });
  },

  async delete(id: string): Promise<void> {
    // Remove vendorId from linked expenses
    const expenses = await db.expenses.where('vendorId').equals(id).toArray();
    for (const expense of expenses) {
      await db.expenses.update(expense.id, { vendorId: undefined, updatedAt: nowISO() });
    }
    // Remove vendorId from linked receipts
    const receipts = await db.receipts.where('vendorId').equals(id).toArray();
    for (const receipt of receipts) {
      await db.receipts.update(receipt.id, { vendorId: undefined, updatedAt: nowISO() });
    }
    await db.vendors.delete(id);
  },

  /**
   * Find vendor by alias (raw vendor name)
   */
  async findByAlias(profileId: string, rawVendor: string): Promise<Vendor | undefined> {
    if (!rawVendor) return undefined;

    const normalized = normalizeVendor(rawVendor);
    if (!normalized) return undefined;

    const vendors = await this.list(profileId);

    // First try exact canonical match
    const exactMatch = vendors.find(
      (v) => normalizeVendor(v.canonicalName) === normalized
    );
    if (exactMatch) return exactMatch;

    // Then check aliases
    for (const vendor of vendors) {
      const normalizedAliases = vendor.aliases.map((a) => normalizeVendor(a));
      if (normalizedAliases.includes(normalized)) {
        return vendor;
      }
    }

    // Finally try similarity matching
    for (const vendor of vendors) {
      const similarity = vendorSimilarity(rawVendor, vendor.canonicalName);
      if (similarity >= 0.85) {
        return vendor;
      }
      // Check aliases
      for (const alias of vendor.aliases) {
        const aliasSimilarity = vendorSimilarity(rawVendor, alias);
        if (aliasSimilarity >= 0.85) {
          return vendor;
        }
      }
    }

    return undefined;
  },

  /**
   * Find or create vendor from raw vendor name
   */
  async findOrCreate(profileId: string, rawVendor: string): Promise<Vendor> {
    const existing = await this.findByAlias(profileId, rawVendor);
    if (existing) return existing;

    // Create new vendor with canonical name
    return this.create({
      profileId,
      canonicalName: suggestCanonicalName(rawVendor),
      aliases: [rawVendor],
    });
  },

  /**
   * Merge two vendors, moving all references to target
   */
  async mergeVendors(targetId: string, sourceId: string): Promise<void> {
    const target = await this.get(targetId);
    const source = await this.get(sourceId);
    if (!target || !source) return;

    // Merge aliases
    const mergedAliases = [...new Set([...target.aliases, ...source.aliases, source.canonicalName])];
    await this.update(targetId, { aliases: mergedAliases });

    // Update expenses referencing source
    const expenses = await db.expenses.where('vendorId').equals(sourceId).toArray();
    for (const expense of expenses) {
      await db.expenses.update(expense.id, { vendorId: targetId, updatedAt: nowISO() });
    }

    // Update receipts referencing source
    const receipts = await db.receipts.where('vendorId').equals(sourceId).toArray();
    for (const receipt of receipts) {
      await db.receipts.update(receipt.id, { vendorId: targetId, updatedAt: nowISO() });
    }

    // Delete source vendor
    await db.vendors.delete(sourceId);
  },

  /**
   * Add an alias to a vendor
   */
  async addAlias(vendorId: string, alias: string): Promise<void> {
    const vendor = await this.get(vendorId);
    if (!vendor) return;

    if (!vendor.aliases.includes(alias)) {
      await this.update(vendorId, {
        aliases: [...vendor.aliases, alias],
      });
    }
  },
};

// ============================================================================
// Month Close Repository
// ============================================================================

export const monthCloseRepo = {
  async get(id: string): Promise<MonthCloseStatus | undefined> {
    return db.monthCloseStatuses.get(id);
  },

  async getByProfileAndMonth(profileId: string, monthKey: string): Promise<MonthCloseStatus | undefined> {
    const id = `${profileId}:${monthKey}`;
    return this.get(id);
  },

  async getOrCreate(profileId: string, monthKey: string): Promise<MonthCloseStatus> {
    const id = `${profileId}:${monthKey}`;
    const existing = await this.get(id);
    if (existing) return existing;

    const now = nowISO();
    const status: MonthCloseStatus = {
      id,
      profileId,
      monthKey,
      isClosed: false,
      checklist: {
        receiptsLinked: false,
        recurringConfirmed: false,
        categorized: false,
        zipExported: false,
      },
      createdAt: now,
      updatedAt: now,
    };
    await db.monthCloseStatuses.add(status);
    return status;
  },

  async updateChecklist(
    profileId: string,
    monthKey: string,
    updates: Partial<MonthCloseChecklist>
  ): Promise<void> {
    const status = await this.getOrCreate(profileId, monthKey);
    await db.monthCloseStatuses.update(status.id, {
      checklist: { ...status.checklist, ...updates },
      updatedAt: nowISO(),
    });
  },

  async closeMonth(profileId: string, monthKey: string, notes?: string): Promise<void> {
    const status = await this.getOrCreate(profileId, monthKey);
    await db.monthCloseStatuses.update(status.id, {
      isClosed: true,
      closedAt: nowISO(),
      notes,
      updatedAt: nowISO(),
    });
  },

  async reopenMonth(profileId: string, monthKey: string): Promise<void> {
    const status = await this.getOrCreate(profileId, monthKey);
    await db.monthCloseStatuses.update(status.id, {
      isClosed: false,
      closedAt: undefined,
      updatedAt: nowISO(),
    });
  },

  async isMonthClosed(profileId: string, monthKey: string): Promise<boolean> {
    const status = await this.getByProfileAndMonth(profileId, monthKey);
    return status?.isClosed ?? false;
  },

  /**
   * Get computed status based on actual data
   */
  async getComputedStatus(profileId: string, monthKey: string): Promise<MonthCloseComputedStatus> {
    // Get receipts for this month
    const receipts = await receiptRepo.getByProfileAndMonth(profileId, monthKey);
    const unlinkedReceiptsCount = receipts.filter((r) => !r.expenseId).length;

    // Get expenses for this month
    const [year, month] = monthKey.split('-').map(Number);
    const expenses = await expenseRepo.list({
      profileId,
      year,
      month,
    });
    const uncategorizedExpensesCount = expenses.filter((e) => !e.categoryId).length;

    return {
      monthKey,
      profileId,
      unlinkedReceiptsCount,
      uncategorizedExpensesCount,
      isFullyLinked: unlinkedReceiptsCount === 0,
      isFullyCategorized: uncategorizedExpensesCount === 0,
    };
  },

  async list(profileId: string): Promise<MonthCloseStatus[]> {
    return db.monthCloseStatuses.where('profileId').equals(profileId).toArray();
  },
};

// ============================================================================
// Receipt Matching Functions
// ============================================================================

/**
 * Calculate match score between a receipt and an expense
 */
function calculateMatchScore(
  receipt: Receipt,
  expense: ExpenseDisplay
): { score: number; breakdown: { amountScore: number; dateScore: number; vendorScore: number } } {
  let amountScore = 0;
  let dateScore = 0;
  let vendorScore = 0;

  // Amount scoring (0-50)
  if (receipt.amountMinor && expense.amountMinor) {
    const diff = Math.abs(receipt.amountMinor - expense.amountMinor);
    const percentDiff = diff / expense.amountMinor;

    if (percentDiff <= 0.01) {
      amountScore = 50; // Within 1%
    } else if (percentDiff <= 0.05) {
      amountScore = 40; // Within 5%
    } else if (percentDiff <= 0.1) {
      amountScore = 30; // Within 10%
    } else if (percentDiff <= 0.2) {
      amountScore = 20; // Within 20%
    }
  }

  // Date scoring (0-25)
  if (receipt.occurredAt && expense.occurredAt) {
    const receiptDate = new Date(receipt.occurredAt);
    const expenseDate = new Date(expense.occurredAt);
    const daysDiff = Math.abs(
      Math.floor((receiptDate.getTime() - expenseDate.getTime()) / (1000 * 60 * 60 * 24))
    );

    if (daysDiff === 0) {
      dateScore = 25; // Same day
    } else if (daysDiff <= 3) {
      dateScore = 20; // Within 3 days
    } else if (daysDiff <= 7) {
      dateScore = 15; // Within 7 days
    } else if (daysDiff <= 30) {
      dateScore = 10; // Within same month
    }
  } else {
    // If no date on receipt, use month matching
    const expenseMonthKey = expense.occurredAt.substring(0, 7);
    if (receipt.monthKey === expenseMonthKey) {
      dateScore = 10;
    }
  }

  // Vendor scoring (0-25)
  if (receipt.vendorId && expense.vendorId && receipt.vendorId === expense.vendorId) {
    vendorScore = 25; // Same vendor
  } else if (receipt.vendorRaw && expense.vendor) {
    const similarity = vendorSimilarity(receipt.vendorRaw, expense.vendor);
    if (similarity >= 0.8) {
      vendorScore = 20;
    } else if (similarity >= 0.5) {
      vendorScore = 10;
    }
  }

  const score = amountScore + dateScore + vendorScore;
  return { score, breakdown: { amountScore, dateScore, vendorScore } };
}

/**
 * Get match suggestions for a receipt
 */
export async function getReceiptMatchSuggestions(
  receiptId: string,
  limit = 5
): Promise<ReceiptMatchSuggestion[]> {
  const receipt = await receiptRepo.get(receiptId);
  if (!receipt || receipt.expenseId) return []; // Already linked

  // Get expenses for the same profile and nearby months
  const [year, month] = receipt.monthKey.split('-').map(Number);
  const expenses: ExpenseDisplay[] = [];

  // Get expenses from the receipt month and adjacent months
  for (let m = month - 1; m <= month + 1; m++) {
    let y = year;
    let adjustedMonth = m;
    if (m < 1) {
      y = year - 1;
      adjustedMonth = 12;
    } else if (m > 12) {
      y = year + 1;
      adjustedMonth = 1;
    }

    const monthExpenses = await expenseRepo.list({
      profileId: receipt.profileId,
      year: y,
      month: adjustedMonth,
    });
    expenses.push(...monthExpenses);
  }

  // Filter out already linked expenses
  const linkedExpenseIds = new Set(
    (await receiptRepo.list({ profileId: receipt.profileId }))
      .filter((r) => r.expenseId)
      .map((r) => r.expenseId!)
  );

  const unlinkedExpenses = expenses.filter((e) => !linkedExpenseIds.has(e.id));

  // Calculate scores
  const suggestions: ReceiptMatchSuggestion[] = [];

  for (const expense of unlinkedExpenses) {
    const { score, breakdown } = calculateMatchScore(receipt, expense);

    if (score >= 40) {
      // Minimum threshold
      let confidence: 'high' | 'medium' | 'low';
      if (score >= 80) {
        confidence = 'high';
      } else if (score >= 60) {
        confidence = 'medium';
      } else {
        confidence = 'low';
      }

      suggestions.push({
        receiptId,
        expenseId: expense.id,
        score,
        confidence,
        breakdown,
        expense,
      });
    }
  }

  // Sort by score descending and limit
  return suggestions.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Get all unlinked receipts with their match suggestions
 */
export async function getUnlinkedReceiptsWithSuggestions(
  profileId: string
): Promise<Array<{ receipt: Receipt; suggestions: ReceiptMatchSuggestion[] }>> {
  const unlinkedReceipts = await receiptRepo.getUnlinkedByProfile(profileId);

  const results = [];
  for (const receipt of unlinkedReceipts) {
    const suggestions = await getReceiptMatchSuggestions(receipt.id);
    results.push({ receipt, suggestions });
  }

  return results;
}

/**
 * Check if a receipt is a duplicate
 */
export async function isReceiptDuplicate(
  profileId: string,
  fileName: string,
  sizeBytes: number,
  monthKey: string
): Promise<boolean> {
  const existingReceipts = await receiptRepo.getByProfileAndMonth(profileId, monthKey);
  return existingReceipts.some(
    (r) => r.fileName === fileName && r.sizeBytes === sizeBytes
  );
}

/**
 * Create an expense and link it to a receipt atomically
 */
export async function createExpenseAndLinkReceipt(
  expenseData: Omit<Expense, 'id' | 'createdAt' | 'updatedAt'>,
  receiptId: string
): Promise<Expense> {
  const expense = await expenseRepo.create(expenseData);
  await receiptRepo.linkToExpense(receiptId, expense.id);
  return expense;
}

/**
 * Create multiple receipts in bulk
 */
export async function createReceiptsBulk(
  receipts: Array<Omit<Receipt, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<Receipt[]> {
  const now = nowISO();
  const created: Receipt[] = [];

  for (const data of receipts) {
    const receipt: Receipt = {
      ...data,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    await db.receipts.add(receipt);
    created.push(receipt);
  }

  return created;
}
