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
} from '../../db/repository';
import { captureOp } from './ops-engine';
import type { Client, Project, Transaction, Category, FxRate } from '../../types';
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
// Re-export unchanged repositories
// ============================================================================

// Settings are not synced - they're device-local
export { settingsRepo } from '../../db/repository';

// Summary repos are read-only views, no sync needed
export { projectSummaryRepo, clientSummaryRepo } from '../../db/repository';
