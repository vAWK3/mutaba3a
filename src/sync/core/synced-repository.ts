/**
 * Synced Repository Wrappers
 *
 * These wrappers intercept mutations on the base repositories and capture them
 * as operations in the ops log. Read operations are passed through unchanged.
 *
 * Usage:
 * Instead of importing { clientRepo } from '../db/repository',
 * import { syncedClientRepo } from '../sync/core/synced-repository'
 */

import {
  clientRepo,
  projectRepo,
  transactionRepo,
  categoryRepo,
  fxRateRepo,
  businessProfileRepo,
  documentRepo,
} from '../../db/repository';
import { captureOp } from './ops-engine';
import type {
  Client,
  Project,
  Transaction,
  Category,
  FxRate,
  BusinessProfile,
  Document,
} from '../../types';
import type { EntityType } from './ops-types';

// Helper to capture a create operation
async function captureCreateOp(entityType: EntityType, entity: { id: string }) {
  await captureOp({
    entityType,
    entityId: entity.id,
    opType: 'create',
    value: entity,
  });
}

// Helper to capture update operations for each changed field
async function captureUpdateOps<T extends object>(
  entityType: EntityType,
  entityId: string,
  changes: Partial<T>,
  previous: T | undefined
) {
  for (const [field, value] of Object.entries(changes)) {
    if (field === 'id' || field === 'createdAt') continue;

    await captureOp({
      entityType,
      entityId,
      opType: 'update',
      field,
      value,
      previousValue: previous ? (previous as Record<string, unknown>)[field] : undefined,
    });
  }
}

// Helper to capture a delete operation
async function captureDeleteOp(entityType: EntityType, entityId: string) {
  await captureOp({
    entityType,
    entityId,
    opType: 'delete',
  });
}

// Helper to capture an archive operation
async function captureArchiveOp(entityType: EntityType, entityId: string) {
  await captureOp({
    entityType,
    entityId,
    opType: 'archive',
    value: new Date().toISOString(),
  });
}

// ============================================================================
// Synced Client Repository
// ============================================================================

export const syncedClientRepo = {
  // Read operations - pass through unchanged
  list: clientRepo.list.bind(clientRepo),
  get: clientRepo.get.bind(clientRepo),

  // Write operations - capture ops
  async create(data: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>): Promise<Client> {
    const client = await clientRepo.create(data);
    await captureCreateOp('client', client);
    return client;
  },

  async update(id: string, data: Partial<Client>): Promise<void> {
    const existing = await clientRepo.get(id);
    await clientRepo.update(id, data);
    await captureUpdateOps('client', id, data, existing);
  },

  async archive(id: string): Promise<void> {
    await clientRepo.archive(id);
    await captureArchiveOp('client', id);
  },

  async delete(id: string): Promise<void> {
    await clientRepo.delete(id);
    await captureDeleteOp('client', id);
  },
};

// ============================================================================
// Synced Project Repository
// ============================================================================

export const syncedProjectRepo = {
  // Read operations - pass through unchanged
  list: projectRepo.list.bind(projectRepo),
  get: projectRepo.get.bind(projectRepo),

  // Write operations - capture ops
  async create(data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<Project> {
    const project = await projectRepo.create(data);
    await captureCreateOp('project', project);
    return project;
  },

  async update(id: string, data: Partial<Project>): Promise<void> {
    const existing = await projectRepo.get(id);
    await projectRepo.update(id, data);
    await captureUpdateOps('project', id, data, existing);
  },

  async archive(id: string): Promise<void> {
    await projectRepo.archive(id);
    await captureArchiveOp('project', id);
  },

  async delete(id: string): Promise<void> {
    await projectRepo.delete(id);
    await captureDeleteOp('project', id);
  },
};

// ============================================================================
// Synced Transaction Repository
// ============================================================================

export const syncedTransactionRepo = {
  // Read operations - pass through unchanged
  list: transactionRepo.list.bind(transactionRepo),
  get: transactionRepo.get.bind(transactionRepo),
  getOverviewTotals: transactionRepo.getOverviewTotals.bind(transactionRepo),
  getOverviewTotalsByCurrency: transactionRepo.getOverviewTotalsByCurrency.bind(transactionRepo),
  getAttentionReceivables: transactionRepo.getAttentionReceivables.bind(transactionRepo),

  // Write operations - capture ops
  async create(data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>): Promise<Transaction> {
    const transaction = await transactionRepo.create(data);
    await captureCreateOp('transaction', transaction);
    return transaction;
  },

  async update(id: string, data: Partial<Transaction>): Promise<void> {
    const existing = await transactionRepo.get(id);
    await transactionRepo.update(id, data);
    await captureUpdateOps('transaction', id, data, existing);
  },

  async markPaid(id: string): Promise<void> {
    await transactionRepo.markPaid(id);
    const tx = await transactionRepo.get(id);
    if (tx?.paidAt) {
      await captureOp({
        entityType: 'transaction',
        entityId: id,
        opType: 'mark_paid',
        value: tx.paidAt,
      });
    }
  },

  async softDelete(id: string): Promise<void> {
    await transactionRepo.softDelete(id);
    await captureDeleteOp('transaction', id);
  },
};

// ============================================================================
// Synced Category Repository
// ============================================================================

export const syncedCategoryRepo = {
  // Read operations - pass through unchanged
  list: categoryRepo.list.bind(categoryRepo),
  get: categoryRepo.get.bind(categoryRepo),

  // Write operations - capture ops
  async create(data: Omit<Category, 'id'>): Promise<Category> {
    const category = await categoryRepo.create(data);
    await captureCreateOp('category', category);
    return category;
  },

  async update(id: string, data: Partial<Category>): Promise<void> {
    const existing = await categoryRepo.get(id);
    await categoryRepo.update(id, data);
    await captureUpdateOps('category', id, data, existing);
  },

  async delete(id: string): Promise<void> {
    await categoryRepo.delete(id);
    await captureDeleteOp('category', id);
  },
};

// ============================================================================
// Synced FX Rate Repository
// ============================================================================

export const syncedFxRateRepo = {
  // Read operations - pass through unchanged
  list: fxRateRepo.list.bind(fxRateRepo),
  getLatest: fxRateRepo.getLatest.bind(fxRateRepo),

  // Write operations - capture ops
  async create(data: Omit<FxRate, 'id' | 'createdAt'>): Promise<FxRate> {
    const rate = await fxRateRepo.create(data);
    await captureCreateOp('fxRate', rate);
    return rate;
  },

  async delete(id: string): Promise<void> {
    await fxRateRepo.delete(id);
    await captureDeleteOp('fxRate', id);
  },
};

// ============================================================================
// Synced Business Profile Repository
// ============================================================================

export const syncedBusinessProfileRepo = {
  // Read operations - pass through unchanged
  list: businessProfileRepo.list.bind(businessProfileRepo),
  get: businessProfileRepo.get.bind(businessProfileRepo),
  getDefault: businessProfileRepo.getDefault.bind(businessProfileRepo),

  // Write operations - capture ops
  async create(data: Omit<BusinessProfile, 'id' | 'createdAt' | 'updatedAt'>): Promise<BusinessProfile> {
    const profile = await businessProfileRepo.create(data);
    await captureCreateOp('businessProfile', profile);
    return profile;
  },

  async update(id: string, data: Partial<BusinessProfile>): Promise<void> {
    const existing = await businessProfileRepo.get(id);
    await businessProfileRepo.update(id, data);
    await captureUpdateOps('businessProfile', id, data, existing);
  },

  async setDefault(id: string): Promise<void> {
    // Get all profiles and mark the old default as not default
    const profiles = await businessProfileRepo.list();
    const oldDefault = profiles.find((p) => p.isDefault);

    await businessProfileRepo.setDefault(id);

    // Capture the change on old default if it exists
    if (oldDefault && oldDefault.id !== id) {
      await captureUpdateOps('businessProfile', oldDefault.id, { isDefault: false }, oldDefault);
    }

    // Capture the change on new default
    const existing = await businessProfileRepo.get(id);
    if (existing) {
      await captureUpdateOps('businessProfile', id, { isDefault: true }, { ...existing, isDefault: false });
    }
  },

  async archive(id: string): Promise<void> {
    await businessProfileRepo.archive(id);
    await captureArchiveOp('businessProfile', id);
  },

  async delete(id: string): Promise<void> {
    await businessProfileRepo.delete(id);
    await captureDeleteOp('businessProfile', id);
  },
};

// ============================================================================
// Synced Document Repository
// ============================================================================

export const syncedDocumentRepo = {
  // Read operations - pass through unchanged
  list: documentRepo.list.bind(documentRepo),
  get: documentRepo.get.bind(documentRepo),
  getByNumber: documentRepo.getByNumber.bind(documentRepo),

  // Write operations - capture ops
  async create(data: Omit<Document, 'id' | 'number' | 'createdAt' | 'updatedAt'>): Promise<Document> {
    const document = await documentRepo.create(data);
    await captureCreateOp('document', document);
    return document;
  },

  async update(id: string, data: Partial<Document>): Promise<void> {
    const existing = await documentRepo.get(id);
    await documentRepo.update(id, data);
    await captureUpdateOps('document', id, data, existing);
  },

  async markPaid(id: string): Promise<void> {
    await documentRepo.markPaid(id);
    const doc = await documentRepo.get(id);
    if (doc?.paidAt) {
      await captureOp({
        entityType: 'document',
        entityId: id,
        opType: 'mark_paid',
        value: doc.paidAt,
      });
    }
  },

  async markVoided(id: string): Promise<void> {
    const existing = await documentRepo.get(id);
    await documentRepo.markVoided(id);
    await captureUpdateOps('document', id, { status: 'voided' }, existing);
  },

  async softDelete(id: string): Promise<void> {
    await documentRepo.softDelete(id);
    await captureDeleteOp('document', id);
  },

  async linkTransactions(documentId: string, transactionIds: string[]): Promise<void> {
    const existing = await documentRepo.get(documentId);
    await documentRepo.linkTransactions(documentId, transactionIds);
    const updated = await documentRepo.get(documentId);
    if (existing && updated) {
      await captureUpdateOps('document', documentId, {
        linkedTransactionIds: updated.linkedTransactionIds,
      }, existing);
    }
  },

  async unlinkTransaction(documentId: string, transactionId: string): Promise<void> {
    const existing = await documentRepo.get(documentId);
    await documentRepo.unlinkTransaction(documentId, transactionId);
    const updated = await documentRepo.get(documentId);
    if (existing && updated) {
      await captureUpdateOps('document', documentId, {
        linkedTransactionIds: updated.linkedTransactionIds,
      }, existing);
    }
  },
};

// ============================================================================
// Re-export unchanged repositories
// ============================================================================

// Settings are not synced - they're device-local
export { settingsRepo } from '../../db/repository';

// Summary repos are read-only views, no sync needed
export { projectSummaryRepo, clientSummaryRepo } from '../../db/repository';

// Document sequence repo - auto-numbering, synced via documents
export { documentSequenceRepo } from '../../db/repository';
