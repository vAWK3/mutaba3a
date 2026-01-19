import { db } from './database';
import type {
  Client,
  Project,
  Category,
  Transaction,
  FxRate,
  Settings,
  QueryFilters,
  OverviewTotals,
  ProjectSummary,
  ClientSummary,
  TransactionDisplay,
  Currency,
  BusinessProfile,
  Document,
  DocumentSequence,
  DocumentFilters,
  DocumentDisplay,
  DocumentType,
} from '../types';
import {
  aggregateTransactionTotals,
  aggregateTransactionTotalsByCurrency,
  aggregateTransactionTotalsWithActivity,
  filterTransactionsByDateAndCurrency,
  filterTransactionsByEntity,
  filterTransactionsByEntityAndDate,
  createNameMap,
  sortByLastActivity,
  type TransactionTotalsByCurrency,
} from './aggregations';

function generateId(): string {
  return crypto.randomUUID();
}

function nowISO(): string {
  return new Date().toISOString();
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

// Client Repository
export const clientRepo = {
  async list(includeArchived = false): Promise<Client[]> {
    let query = db.clients.toCollection();
    if (!includeArchived) {
      query = db.clients.filter((c) => !c.archivedAt);
    }
    return query.sortBy('name');
  },

  async get(id: string): Promise<Client | undefined> {
    return db.clients.get(id);
  },

  async create(data: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>): Promise<Client> {
    const now = nowISO();
    const client: Client = {
      ...data,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    await db.clients.add(client);
    return client;
  },

  async update(id: string, data: Partial<Client>): Promise<void> {
    await db.clients.update(id, { ...data, updatedAt: nowISO() });
  },

  async archive(id: string): Promise<void> {
    await db.clients.update(id, { archivedAt: nowISO(), updatedAt: nowISO() });
  },

  async delete(id: string): Promise<void> {
    await db.clients.delete(id);
  },
};

// Project Repository
export const projectRepo = {
  async list(filters?: { clientId?: string; includeArchived?: boolean }): Promise<Project[]> {
    const collection = db.projects.toCollection();

    const results = await collection.toArray();
    return results
      .filter((p) => {
        if (!filters?.includeArchived && p.archivedAt) return false;
        if (filters?.clientId && p.clientId !== filters.clientId) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async get(id: string): Promise<Project | undefined> {
    return db.projects.get(id);
  },

  async create(data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<Project> {
    const now = nowISO();
    const project: Project = {
      ...data,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    await db.projects.add(project);
    return project;
  },

  async update(id: string, data: Partial<Project>): Promise<void> {
    await db.projects.update(id, { ...data, updatedAt: nowISO() });
  },

  async archive(id: string): Promise<void> {
    await db.projects.update(id, { archivedAt: nowISO(), updatedAt: nowISO() });
  },

  async delete(id: string): Promise<void> {
    await db.projects.delete(id);
  },
};

// Category Repository
export const categoryRepo = {
  async list(kind?: 'income' | 'expense'): Promise<Category[]> {
    if (kind) {
      return db.categories.where('kind').equals(kind).sortBy('name');
    }
    return db.categories.orderBy('name').toArray();
  },

  async get(id: string): Promise<Category | undefined> {
    return db.categories.get(id);
  },

  async create(data: Omit<Category, 'id'>): Promise<Category> {
    const category: Category = {
      ...data,
      id: generateId(),
    };
    await db.categories.add(category);
    return category;
  },

  async update(id: string, data: Partial<Category>): Promise<void> {
    await db.categories.update(id, data);
  },

  async delete(id: string): Promise<void> {
    await db.categories.delete(id);
  },
};

// Transaction Repository
export const transactionRepo = {
  async list(filters: QueryFilters = {}): Promise<TransactionDisplay[]> {
    const transactions = await db.transactions.toArray();
    const clients = await db.clients.toArray();
    const projects = await db.projects.toArray();
    const categories = await db.categories.toArray();

    const clientMap = new Map(clients.map((c) => [c.id, c.name]));
    const projectMap = new Map(projects.map((p) => [p.id, p.name]));
    const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

    const today = todayISO();

    let filtered = transactions.filter((tx) => {
      if (tx.deletedAt) return false;
      if (filters.dateFrom && tx.occurredAt < filters.dateFrom) return false;
      if (filters.dateTo && tx.occurredAt > filters.dateTo + 'T23:59:59') return false;
      if (filters.currency && tx.currency !== filters.currency) return false;
      if (filters.kind && tx.kind !== filters.kind) return false;
      if (filters.clientId && tx.clientId !== filters.clientId) return false;
      if (filters.projectId && tx.projectId !== filters.projectId) return false;

      if (filters.status) {
        if (filters.status === 'overdue') {
          if (!(tx.kind === 'income' && tx.status === 'unpaid' && tx.dueDate && tx.dueDate < today)) {
            return false;
          }
        } else if (tx.status !== filters.status) {
          return false;
        }
      }

      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const clientName = tx.clientId ? clientMap.get(tx.clientId) : '';
        const projectName = tx.projectId ? projectMap.get(tx.projectId) : '';
        const matchesSearch =
          tx.title?.toLowerCase().includes(searchLower) ||
          tx.notes?.toLowerCase().includes(searchLower) ||
          clientName?.toLowerCase().includes(searchLower) ||
          projectName?.toLowerCase().includes(searchLower);
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

    return filtered.map((tx) => ({
      ...tx,
      clientName: tx.clientId ? clientMap.get(tx.clientId) : undefined,
      projectName: tx.projectId ? projectMap.get(tx.projectId) : undefined,
      categoryName: tx.categoryId ? categoryMap.get(tx.categoryId) : undefined,
    }));
  },

  async get(id: string): Promise<Transaction | undefined> {
    return db.transactions.get(id);
  },

  async create(data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>): Promise<Transaction> {
    const now = nowISO();
    const transaction: Transaction = {
      ...data,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    await db.transactions.add(transaction);
    return transaction;
  },

  async update(id: string, data: Partial<Transaction>): Promise<void> {
    await db.transactions.update(id, { ...data, updatedAt: nowISO() });
  },

  async markPaid(id: string): Promise<void> {
    const now = nowISO();
    await db.transactions.update(id, {
      status: 'paid',
      paidAt: now,
      updatedAt: now,
    });
  },

  async softDelete(id: string): Promise<void> {
    await db.transactions.update(id, { deletedAt: nowISO(), updatedAt: nowISO() });
  },

  async getOverviewTotals(filters: { dateFrom: string; dateTo: string; currency?: Currency }): Promise<OverviewTotals> {
    const transactions = await db.transactions.toArray();
    const filtered = filterTransactionsByDateAndCurrency(transactions, filters);
    return aggregateTransactionTotals(filtered);
  },

  async getOverviewTotalsByCurrency(filters: { dateFrom: string; dateTo: string }): Promise<TransactionTotalsByCurrency> {
    const transactions = await db.transactions.toArray();
    // Filter by date only, not currency - we want all currencies
    const filtered = filterTransactionsByDateAndCurrency(transactions, {
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    });
    return aggregateTransactionTotalsByCurrency(filtered);
  },

  async getAttentionReceivables(filters: { currency?: Currency }): Promise<TransactionDisplay[]> {
    const today = todayISO();
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    const sevenDaysISO = sevenDaysFromNow.toISOString().split('T')[0];

    const transactions = await this.list({
      kind: 'income',
      currency: filters.currency,
    });

    return transactions.filter((tx) => {
      if (tx.status !== 'unpaid' || !tx.dueDate) return false;
      // Overdue or due in next 7 days
      return tx.dueDate < today || tx.dueDate <= sevenDaysISO;
    }).sort((a, b) => {
      // Sort by due date ascending (most urgent first)
      return (a.dueDate || '').localeCompare(b.dueDate || '');
    });
  },
};

// Project Summary Repository
export const projectSummaryRepo = {
  async list(filters?: { currency?: Currency; search?: string; field?: string }): Promise<ProjectSummary[]> {
    const projects = await projectRepo.list();
    const clients = await db.clients.toArray();
    const transactions = await db.transactions.toArray();

    const clientMap = createNameMap(clients);

    const summaries = projects
      .filter((p) => {
        if (filters?.search) {
          const searchLower = filters.search.toLowerCase();
          const clientName = p.clientId ? clientMap.get(p.clientId) : '';
          if (
            !p.name.toLowerCase().includes(searchLower) &&
            !clientName?.toLowerCase().includes(searchLower)
          ) {
            return false;
          }
        }
        if (filters?.field && p.field !== filters.field) return false;
        return true;
      })
      .map((p) => {
        const projectTxs = filterTransactionsByEntity(transactions, 'project', p.id, filters?.currency);
        const totals = aggregateTransactionTotalsWithActivity(projectTxs);

        // When no currency filter, also compute per-currency breakdowns
        let perCurrencyData = {};
        if (!filters?.currency) {
          const allProjectTxs = filterTransactionsByEntity(transactions, 'project', p.id);
          const byCurrency = aggregateTransactionTotalsByCurrency(allProjectTxs);
          perCurrencyData = {
            paidIncomeMinorUSD: byCurrency.USD.paidIncomeMinor,
            paidIncomeMinorILS: byCurrency.ILS.paidIncomeMinor,
            unpaidIncomeMinorUSD: byCurrency.USD.unpaidIncomeMinor,
            unpaidIncomeMinorILS: byCurrency.ILS.unpaidIncomeMinor,
            expensesMinorUSD: byCurrency.USD.expensesMinor,
            expensesMinorILS: byCurrency.ILS.expensesMinor,
          };
        }

        return {
          id: p.id,
          name: p.name,
          clientId: p.clientId,
          clientName: p.clientId ? clientMap.get(p.clientId) : undefined,
          field: p.field,
          ...totals,
          netMinor: totals.paidIncomeMinor - totals.expensesMinor,
          ...perCurrencyData,
        };
      });

    return sortByLastActivity(summaries);
  },

  async get(projectId: string, filters?: { dateFrom?: string; dateTo?: string; currency?: Currency }): Promise<ProjectSummary | undefined> {
    const project = await projectRepo.get(projectId);
    if (!project) return undefined;

    const client = project.clientId ? await clientRepo.get(project.clientId) : undefined;
    const transactions = await db.transactions.toArray();

    const projectTxs = filterTransactionsByEntityAndDate(transactions, 'project', projectId, filters || {});
    const totals = aggregateTransactionTotalsWithActivity(projectTxs);

    // When no currency filter, also compute per-currency breakdowns
    let perCurrencyData = {};
    if (!filters?.currency) {
      const allProjectTxs = filterTransactionsByEntityAndDate(transactions, 'project', projectId, { dateFrom: filters?.dateFrom, dateTo: filters?.dateTo });
      const byCurrency = aggregateTransactionTotalsByCurrency(allProjectTxs);
      perCurrencyData = {
        paidIncomeMinorUSD: byCurrency.USD.paidIncomeMinor,
        paidIncomeMinorILS: byCurrency.ILS.paidIncomeMinor,
        unpaidIncomeMinorUSD: byCurrency.USD.unpaidIncomeMinor,
        unpaidIncomeMinorILS: byCurrency.ILS.unpaidIncomeMinor,
        expensesMinorUSD: byCurrency.USD.expensesMinor,
        expensesMinorILS: byCurrency.ILS.expensesMinor,
      };
    }

    return {
      id: project.id,
      name: project.name,
      clientId: project.clientId,
      clientName: client?.name,
      field: project.field,
      ...totals,
      netMinor: totals.paidIncomeMinor - totals.expensesMinor,
      ...perCurrencyData,
    };
  },
};

// Client Summary Repository
export const clientSummaryRepo = {
  async list(filters?: { currency?: Currency; search?: string }): Promise<ClientSummary[]> {
    const clients = await clientRepo.list();
    const projects = await db.projects.toArray();
    const transactions = await db.transactions.toArray();

    const summaries = clients
      .filter((c) => {
        if (filters?.search) {
          const searchLower = filters.search.toLowerCase();
          if (!c.name.toLowerCase().includes(searchLower)) {
            return false;
          }
        }
        return true;
      })
      .map((c) => {
        const clientProjects = projects.filter((p) => p.clientId === c.id && !p.archivedAt);
        const clientTxs = filterTransactionsByEntity(transactions, 'client', c.id, filters?.currency);
        const totals = aggregateTransactionTotalsWithActivity(clientTxs, { trackPayments: true });

        // When no currency filter, also compute per-currency breakdowns
        let perCurrencyData = {};
        if (!filters?.currency) {
          const allClientTxs = filterTransactionsByEntity(transactions, 'client', c.id);
          const byCurrency = aggregateTransactionTotalsByCurrency(allClientTxs);
          perCurrencyData = {
            paidIncomeMinorUSD: byCurrency.USD.paidIncomeMinor,
            paidIncomeMinorILS: byCurrency.ILS.paidIncomeMinor,
            unpaidIncomeMinorUSD: byCurrency.USD.unpaidIncomeMinor,
            unpaidIncomeMinorILS: byCurrency.ILS.unpaidIncomeMinor,
          };
        }

        return {
          id: c.id,
          name: c.name,
          activeProjectCount: clientProjects.length,
          paidIncomeMinor: totals.paidIncomeMinor,
          unpaidIncomeMinor: totals.unpaidIncomeMinor,
          lastPaymentAt: totals.lastPaymentAt,
          lastActivityAt: totals.lastActivityAt,
          ...perCurrencyData,
        };
      });

    return sortByLastActivity(summaries);
  },

  async get(clientId: string, filters?: { dateFrom?: string; dateTo?: string; currency?: Currency }): Promise<ClientSummary | undefined> {
    const client = await clientRepo.get(clientId);
    if (!client) return undefined;

    const projects = await db.projects.toArray();
    const transactions = await db.transactions.toArray();

    const clientProjects = projects.filter((p) => p.clientId === clientId && !p.archivedAt);
    const clientTxs = filterTransactionsByEntityAndDate(transactions, 'client', clientId, filters || {});
    const totals = aggregateTransactionTotalsWithActivity(clientTxs, { trackPayments: true });

    return {
      id: client.id,
      name: client.name,
      activeProjectCount: clientProjects.length,
      paidIncomeMinor: totals.paidIncomeMinor,
      unpaidIncomeMinor: totals.unpaidIncomeMinor,
      lastPaymentAt: totals.lastPaymentAt,
      lastActivityAt: totals.lastActivityAt,
    };
  },
};

// FX Rate Repository
export const fxRateRepo = {
  async list(): Promise<FxRate[]> {
    return db.fxRates.orderBy('effectiveDate').reverse().toArray();
  },

  async getLatest(baseCurrency: Currency, quoteCurrency: Currency): Promise<FxRate | undefined> {
    const rates = await db.fxRates
      .where('[baseCurrency+quoteCurrency]')
      .equals([baseCurrency, quoteCurrency])
      .sortBy('effectiveDate');
    return rates[rates.length - 1];
  },

  async create(data: Omit<FxRate, 'id' | 'createdAt'>): Promise<FxRate> {
    const rate: FxRate = {
      ...data,
      id: generateId(),
      createdAt: nowISO(),
    };
    await db.fxRates.add(rate);
    return rate;
  },

  async delete(id: string): Promise<void> {
    await db.fxRates.delete(id);
  },
};

// Settings Repository
export const settingsRepo = {
  async get(): Promise<Settings> {
    const settings = await db.settings.get('default');
    if (settings) return settings;

    // Return defaults
    return {
      id: 'default',
      enabledCurrencies: ['USD', 'ILS'],
      defaultCurrency: 'USD',
      defaultBaseCurrency: 'ILS',
    };
  },

  async update(data: Partial<Settings>): Promise<void> {
    const current = await this.get();
    await db.settings.put({ ...current, ...data, id: 'default' });
  },
};

// ============================================================================
// Business Profile Repository
// ============================================================================

export const businessProfileRepo = {
  async list(includeArchived = false): Promise<BusinessProfile[]> {
    let query = db.businessProfiles.toCollection();
    if (!includeArchived) {
      query = db.businessProfiles.filter((p) => !p.archivedAt);
    }
    return query.sortBy('name');
  },

  async get(id: string): Promise<BusinessProfile | undefined> {
    return db.businessProfiles.get(id);
  },

  async getDefault(): Promise<BusinessProfile | undefined> {
    const profiles = await db.businessProfiles.filter((p) => p.isDefault && !p.archivedAt).toArray();
    return profiles[0];
  },

  async create(data: Omit<BusinessProfile, 'id' | 'createdAt' | 'updatedAt'>): Promise<BusinessProfile> {
    const now = nowISO();

    // If this is the first profile or marked as default, ensure only one default
    if (data.isDefault) {
      await db.businessProfiles.toCollection().modify({ isDefault: false });
    }

    const profile: BusinessProfile = {
      ...data,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    await db.businessProfiles.add(profile);
    return profile;
  },

  async update(id: string, data: Partial<BusinessProfile>): Promise<void> {
    // If setting as default, unset all others first
    if (data.isDefault) {
      await db.businessProfiles.toCollection().modify({ isDefault: false });
    }
    await db.businessProfiles.update(id, { ...data, updatedAt: nowISO() });
  },

  async setDefault(id: string): Promise<void> {
    await db.businessProfiles.toCollection().modify({ isDefault: false });
    await db.businessProfiles.update(id, { isDefault: true, updatedAt: nowISO() });
  },

  async archive(id: string): Promise<void> {
    const profile = await this.get(id);
    if (profile?.isDefault) {
      // If archiving default, try to set another as default
      const others = await db.businessProfiles.filter((p) => p.id !== id && !p.archivedAt).toArray();
      if (others.length > 0) {
        await db.businessProfiles.update(others[0].id, { isDefault: true });
      }
    }
    await db.businessProfiles.update(id, { archivedAt: nowISO(), updatedAt: nowISO(), isDefault: false });
  },

  async delete(id: string): Promise<void> {
    await db.businessProfiles.delete(id);
  },
};

// ============================================================================
// Document Sequence Repository (for auto-numbering)
// ============================================================================

// Document type to prefix mapping
const DOCUMENT_PREFIXES: Record<DocumentType, string> = {
  invoice: 'INV',
  receipt: 'REC',
  invoice_receipt: 'IR',
  credit_note: 'CN',
  price_offer: 'PO',
  proforma_invoice: 'PI',
  donation_receipt: 'DR',
};

export const documentSequenceRepo = {
  async getNextNumber(businessProfileId: string, documentType: DocumentType): Promise<string> {
    const sequenceId = `${businessProfileId}:${documentType}`;
    let sequence = await db.documentSequences.get(sequenceId);

    if (!sequence) {
      // Create new sequence with defaults
      sequence = {
        id: sequenceId,
        businessProfileId,
        documentType,
        lastNumber: 0,
        prefix: DOCUMENT_PREFIXES[documentType],
        prefixEnabled: true,
        updatedAt: nowISO(),
      };
    }

    // Find highest existing number for this document type (handles gaps/manual edits)
    const existingDocs = await db.documents
      .where('type')
      .equals(documentType)
      .filter((doc) => !doc.deletedAt)
      .toArray();

    let highestNumber = sequence.lastNumber;
    for (const doc of existingDocs) {
      // Extract number from end of document number (handles both PREFIX-NNNN and NNNN formats)
      const match = doc.number.match(/(\d+)$/);
      if (match) {
        highestNumber = Math.max(highestNumber, parseInt(match[1], 10));
      }
    }

    const nextNumber = highestNumber + 1;

    // Update sequence
    sequence.lastNumber = nextNumber;
    sequence.updatedAt = nowISO();
    await db.documentSequences.put(sequence);

    // Format based on prefixEnabled
    const paddedNumber = String(nextNumber).padStart(4, '0');
    return sequence.prefixEnabled
      ? `${sequence.prefix}-${paddedNumber}`
      : paddedNumber;
  },

  async get(businessProfileId: string, documentType: DocumentType): Promise<DocumentSequence | undefined> {
    return db.documentSequences.get(`${businessProfileId}:${documentType}`);
  },

  async listByBusinessProfile(businessProfileId: string): Promise<DocumentSequence[]> {
    return db.documentSequences
      .where('businessProfileId')
      .equals(businessProfileId)
      .toArray();
  },

  async update(businessProfileId: string, documentType: DocumentType, data: Partial<DocumentSequence>): Promise<void> {
    const sequenceId = `${businessProfileId}:${documentType}`;
    let existing = await db.documentSequences.get(sequenceId);

    if (!existing) {
      // Create with defaults if doesn't exist
      existing = {
        id: sequenceId,
        businessProfileId,
        documentType,
        lastNumber: 0,
        prefix: DOCUMENT_PREFIXES[documentType],
        prefixEnabled: true,
        updatedAt: nowISO(),
      };
    }

    await db.documentSequences.put({
      ...existing,
      ...data,
      updatedAt: nowISO(),
    });
  },

  async getOrCreate(businessProfileId: string, documentType: DocumentType): Promise<DocumentSequence> {
    const sequenceId = `${businessProfileId}:${documentType}`;
    let sequence = await db.documentSequences.get(sequenceId);

    if (!sequence) {
      sequence = {
        id: sequenceId,
        businessProfileId,
        documentType,
        lastNumber: 0,
        prefix: DOCUMENT_PREFIXES[documentType],
        prefixEnabled: true,
        updatedAt: nowISO(),
      };
      await db.documentSequences.put(sequence);
    }

    return sequence;
  },
};

// ============================================================================
// Document Repository
// ============================================================================

export const documentRepo = {
  async list(filters: DocumentFilters = {}): Promise<DocumentDisplay[]> {
    const documents = await db.documents.toArray();
    const clients = await db.clients.toArray();
    const profiles = await db.businessProfiles.toArray();

    const clientMap = new Map(clients.map((c) => [c.id, c.name]));
    const profileMap = new Map(profiles.map((p) => [p.id, p.name]));

    let filtered = documents.filter((doc) => {
      if (doc.deletedAt) return false;
      if (filters.dateFrom && doc.issueDate < filters.dateFrom) return false;
      if (filters.dateTo && doc.issueDate > filters.dateTo + 'T23:59:59') return false;
      if (filters.currency && doc.currency !== filters.currency) return false;
      if (filters.type && doc.type !== filters.type) return false;
      if (filters.status && doc.status !== filters.status) return false;
      if (filters.businessProfileId && doc.businessProfileId !== filters.businessProfileId) return false;
      if (filters.clientId && doc.clientId !== filters.clientId) return false;

      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const clientName = doc.clientId ? clientMap.get(doc.clientId) : '';
        const matchesSearch =
          doc.number?.toLowerCase().includes(searchLower) ||
          doc.subject?.toLowerCase().includes(searchLower) ||
          doc.notes?.toLowerCase().includes(searchLower) ||
          clientName?.toLowerCase().includes(searchLower);
        if (!matchesSearch) return false;
      }

      return true;
    });

    // Sort
    const sortBy = filters.sort?.by || 'issueDate';
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

    return filtered.map((doc) => ({
      ...doc,
      clientName: doc.clientId ? clientMap.get(doc.clientId) : undefined,
      businessProfileName: profileMap.get(doc.businessProfileId),
    }));
  },

  async get(id: string): Promise<Document | undefined> {
    return db.documents.get(id);
  },

  async getByNumber(number: string): Promise<Document | undefined> {
    const docs = await db.documents.where('number').equals(number).toArray();
    return docs[0];
  },

  async isNumberTaken(number: string, excludeId?: string): Promise<boolean> {
    const existing = await db.documents
      .where('number')
      .equals(number)
      .filter((doc) => !doc.deletedAt && doc.id !== excludeId)
      .first();
    return !!existing;
  },

  async create(data: Omit<Document, 'id' | 'number' | 'createdAt' | 'updatedAt'>): Promise<Document> {
    const now = nowISO();
    const number = await documentSequenceRepo.getNextNumber(data.businessProfileId, data.type);

    const document: Document = {
      ...data,
      id: generateId(),
      number,
      createdAt: now,
      updatedAt: now,
    };
    await db.documents.add(document);
    return document;
  },

  async update(id: string, data: Partial<Document>): Promise<void> {
    await db.documents.update(id, { ...data, updatedAt: nowISO() });
  },

  async markPaid(id: string): Promise<void> {
    const now = nowISO();
    await db.documents.update(id, {
      status: 'paid',
      paidAt: now,
      updatedAt: now,
    });
  },

  async markVoided(id: string): Promise<void> {
    await db.documents.update(id, {
      status: 'voided',
      updatedAt: nowISO(),
    });
  },

  async markIssued(id: string): Promise<void> {
    await db.documents.update(id, {
      status: 'issued',
      updatedAt: nowISO(),
    });
  },

  async softDelete(id: string): Promise<void> {
    await db.documents.update(id, { deletedAt: nowISO(), updatedAt: nowISO() });
  },

  async linkTransactions(documentId: string, transactionIds: string[]): Promise<void> {
    const doc = await this.get(documentId);
    if (!doc) return;

    const existingIds = new Set(doc.linkedTransactionIds || []);
    transactionIds.forEach((id) => existingIds.add(id));

    await this.update(documentId, {
      linkedTransactionIds: Array.from(existingIds),
    });

    // Also update transactions to link back to document
    for (const txId of transactionIds) {
      await transactionRepo.update(txId, { linkedDocumentId: documentId });
    }
  },

  async unlinkTransaction(documentId: string, transactionId: string): Promise<void> {
    const doc = await this.get(documentId);
    if (!doc) return;

    await this.update(documentId, {
      linkedTransactionIds: (doc.linkedTransactionIds || []).filter((id) => id !== transactionId),
    });

    await transactionRepo.update(transactionId, { linkedDocumentId: undefined });
  },
};
