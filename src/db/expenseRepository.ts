import { db } from './database';
import { excludeDeleted } from './baseQuery';
import type {
  Expense,
  RecurringRule,
  Receipt,
  ExpenseCategory,
  ExpenseFilters,
  ReceiptFilters,
  ExpenseDisplay,
  Vendor,
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

    // Log filtering for debugging
    const deletedCount = expenses.filter(e => e.deletedAt).length;
    console.log(`[expenseRepo.list] Total expenses: ${expenses.length}, Deleted: ${deletedCount}, includeDeleted: ${filters.includeDeleted}`);

    let filtered = expenses.filter((e) => {
      if (!filters.includeDeleted && !excludeDeleted(e)) return false;
      if (filters.profileId && e.profileId !== filters.profileId) return false;
      if (filters.clientId && e.clientId !== filters.clientId) return false;
      if (filters.projectId && e.projectId !== filters.projectId) return false;
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

      // Filter by date range
      if (filters.dateFrom) {
        const expenseDate = e.occurredAt.split('T')[0];
        if (expenseDate < filters.dateFrom) return false;
      }
      if (filters.dateTo) {
        const expenseDate = e.occurredAt.split('T')[0];
        if (expenseDate > filters.dateTo) return false;
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
    const deleteTimestamp = nowISO();
    const result = await db.expenses.update(id, {
      deletedAt: deleteTimestamp,
      updatedAt: deleteTimestamp
    });

    if (result === 0) {
      console.warn(`[expenseRepo.softDelete] No expense found with id: ${id}`);
      throw new Error(`Expense not found: ${id}`);
    }

    console.log(`[expenseRepo.softDelete] Successfully soft-deleted expense ${id} at ${deleteTimestamp}`);
  },

  async delete(id: string): Promise<void> {
    await db.expenses.delete(id);
  },


};

// ============================================================================
// Recurring Rule Repository
// ============================================================================

export const recurringRuleRepo = {
  async list(filters?: {
    profileId?: string;
    isPaused?: boolean;
    scope?: 'general' | 'project';
  }): Promise<RecurringRule[]> {
    const rules = await db.recurringRules.toArray();

    return rules.filter((r) => {
      if (!excludeDeleted(r)) return false;
      if (filters?.profileId && r.profileId !== filters.profileId) return false;
      if (filters?.isPaused !== undefined && r.isPaused !== filters.isPaused) return false;
      if (filters?.scope && r.scope !== filters.scope) return false;
      return true;
    });
  },

  async listActive(profileId: string): Promise<RecurringRule[]> {
    return this.list({ profileId, isPaused: false });
  },

  async get(id: string): Promise<RecurringRule | undefined> {
    const rule = await db.recurringRules.get(id);
    if (rule && !excludeDeleted(rule)) return undefined;
    return rule;
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

  async softDelete(id: string): Promise<void> {
    await db.recurringRules.update(id, { deletedAt: nowISO(), updatedAt: nowISO() });
  },

  async delete(id: string): Promise<void> {
    await db.recurringRules.delete(id);
  },
};

// ============================================================================
// Recurring Occurrence Repository
// ============================================================================

import type { RecurringOccurrence, RecurringOccurrenceStatus } from '../types';

export const recurringOccurrenceRepo = {
  async list(filters: {
    profileId: string;
    ruleId?: string;
    status?: RecurringOccurrenceStatus | RecurringOccurrenceStatus[];
    dateFrom?: string;
    dateTo?: string;
  }): Promise<RecurringOccurrence[]> {
    const occurrences = await db.recurringOccurrences.toArray();

    return occurrences.filter((o) => {
      if (o.profileId !== filters.profileId) return false;
      if (filters.ruleId && o.ruleId !== filters.ruleId) return false;

      // Status filtering
      if (filters.status) {
        const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
        if (!statuses.includes(o.status)) return false;
      }

      // Date range filtering
      if (filters.dateFrom && o.expectedDate < filters.dateFrom) return false;
      if (filters.dateTo && o.expectedDate > filters.dateTo) return false;

      return true;
    });
  },

  async get(id: string): Promise<RecurringOccurrence | undefined> {
    return db.recurringOccurrences.get(id);
  },

  async getByRuleAndDate(ruleId: string, expectedDate: string): Promise<RecurringOccurrence | undefined> {
    const occurrences = await db.recurringOccurrences
      .where('[ruleId+expectedDate]')
      .equals([ruleId, expectedDate])
      .toArray();
    return occurrences[0];
  },

  async getHistoryForRule(ruleId: string): Promise<RecurringOccurrence[]> {
    return db.recurringOccurrences
      .where('ruleId')
      .equals(ruleId)
      .sortBy('expectedDate');
  },

  async create(data: Omit<RecurringOccurrence, 'id' | 'createdAt' | 'updatedAt'>): Promise<RecurringOccurrence> {
    const now = nowISO();
    const occurrence: RecurringOccurrence = {
      ...data,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    await db.recurringOccurrences.add(occurrence);
    return occurrence;
  },

  async update(id: string, data: Partial<RecurringOccurrence>): Promise<void> {
    await db.recurringOccurrences.update(id, { ...data, updatedAt: nowISO() });
  },

  async delete(id: string): Promise<void> {
    await db.recurringOccurrences.delete(id);
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

  async count(): Promise<number> {
    return db.receipts.count();
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

    
};

