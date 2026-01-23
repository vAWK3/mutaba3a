/**
 * Conflict Resolution
 *
 * Handles resolution of sync conflicts for both profile data (LWW per field)
 * and money events (versioned updates).
 */

import { db } from '../../db/database';
import { captureOp } from './ops-engine';
import type {
  Conflict,
  ConflictResolution,
  MoneyEventVersion,
} from './ops-types';
import type { Transaction } from '../../types';

// ============================================================================
// Profile Field Conflicts
// ============================================================================

export interface ProfileResolution {
  action: 'keep_local' | 'keep_remote';
}

/**
 * Resolve a profile field conflict by keeping either local or remote value.
 */
export async function resolveProfileConflict(
  conflictId: string,
  resolution: ProfileResolution
): Promise<void> {
  const conflict = await db.conflictQueue.get(conflictId);
  if (!conflict) {
    throw new Error(`Conflict not found: ${conflictId}`);
  }

  if (conflict.status === 'resolved') {
    throw new Error('Conflict already resolved');
  }

  // Determine which value to use
  const valueToUse = resolution.action === 'keep_local' ? conflict.localValue : conflict.remoteValue;

  // If keeping remote, the value is already applied (LWW)
  // If keeping local, we need to revert to local value
  if (resolution.action === 'keep_local') {
    await revertToLocalValue(conflict);
  }

  // Create resolution operation (syncs to other devices)
  const resolutionOp = await captureOp({
    entityType: conflict.entityType,
    entityId: conflict.entityId,
    opType: 'resolve_conflict',
    field: conflict.field,
    value: {
      conflictId,
      resolution: resolution.action,
      finalValue: valueToUse,
    },
  });

  // Mark conflict as resolved
  await db.conflictQueue.update(conflictId, {
    status: 'resolved',
    resolution: resolution.action as ConflictResolution,
    resolvedAt: new Date().toISOString(),
    resolutionOpId: resolutionOp?.id,
  });
}

async function revertToLocalValue(conflict: Conflict): Promise<void> {
  if (!conflict.field) return;

  const table = getTableForEntityType(conflict.entityType);
  await table.update(conflict.entityId, {
    [conflict.field]: conflict.localValue,
    updatedAt: new Date().toISOString(),
  });

  // Update field meta to reflect local value is now active
  await db.entityFieldMeta.put({
    entityType: conflict.entityType,
    entityId: conflict.entityId,
    field: conflict.field,
    hlc: conflict.localOp.hlc,
    value: conflict.localValue,
    updatedBy: conflict.localOp.createdBy,
  });
}

// ============================================================================
// Money Event Conflicts
// ============================================================================

export interface MoneyResolution {
  action: 'keep_local' | 'keep_remote' | 'keep_both' | 'merge';
  /** Required for merge action */
  mergedData?: Partial<Transaction>;
}

/**
 * Resolve a money event version conflict.
 */
export async function resolveMoneyConflict(
  conflictId: string,
  resolution: MoneyResolution
): Promise<void> {
  const conflict = await db.conflictQueue.get(conflictId);
  if (!conflict) {
    throw new Error(`Conflict not found: ${conflictId}`);
  }

  if (conflict.status === 'resolved') {
    throw new Error('Conflict already resolved');
  }

  switch (resolution.action) {
    case 'keep_local':
      await setActiveVersion(conflict.entityId, 'local', conflict);
      break;

    case 'keep_remote':
      await setActiveVersion(conflict.entityId, 'remote', conflict);
      break;

    case 'keep_both':
      await keepBothVersions(conflict);
      break;

    case 'merge':
      if (!resolution.mergedData) {
        throw new Error('Merge resolution requires mergedData');
      }
      await mergeVersions(conflict, resolution.mergedData);
      break;
  }

  // Create resolution operation
  const resolutionOp = await captureOp({
    entityType: 'transaction',
    entityId: conflict.entityId,
    opType: 'resolve_conflict',
    value: {
      conflictId,
      resolution: resolution.action,
    },
  });

  // Mark conflict as resolved
  await db.conflictQueue.update(conflictId, {
    status: 'resolved',
    resolution: resolution.action as ConflictResolution,
    resolvedAt: new Date().toISOString(),
    resolutionOpId: resolutionOp?.id,
  });
}

async function setActiveVersion(
  transactionId: string,
  which: 'local' | 'remote',
  conflict: Conflict
): Promise<void> {
  // Get all versions for this transaction
  const versions = await db.moneyEventVersions
    .where('transactionId')
    .equals(transactionId)
    .toArray();

  // Find the version to activate based on which device created it
  const localDeviceId = conflict.localOp.createdBy;
  const targetDeviceId = which === 'local' ? localDeviceId : conflict.remoteOp.createdBy;

  const versionToActivate = versions.find((v) => v.createdBy === targetDeviceId);

  if (!versionToActivate) {
    // No version found, use the conflict values directly
    const data = (which === 'local' ? conflict.localValue : conflict.remoteValue) as Transaction;
    await db.transactions.put(data);
    return;
  }

  // Deactivate all versions
  for (const v of versions) {
    await db.moneyEventVersions.update(v.id, { isActive: false });
  }

  // Activate the selected version
  await db.moneyEventVersions.update(versionToActivate.id, { isActive: true });

  // Update the transaction with the active version's data
  await db.transactions.put(versionToActivate.data);

  // Create set_active_version op
  await captureOp({
    entityType: 'transaction',
    entityId: transactionId,
    opType: 'set_active_version',
    value: {
      transactionId,
      versionId: versionToActivate.id,
    },
  });
}

async function keepBothVersions(conflict: Conflict): Promise<void> {
  const localTx = conflict.localValue as Transaction;
  const remoteTx = conflict.remoteValue as Transaction;

  // The original transaction keeps local values
  await db.transactions.put(localTx);

  // Create a new transaction for the remote version
  const newId = crypto.randomUUID();
  const newTx: Transaction = {
    ...remoteTx,
    id: newId,
    title: remoteTx.title ? `${remoteTx.title} (from sync)` : '(from sync)',
    notes: remoteTx.notes
      ? `${remoteTx.notes}\n\n[Created during conflict resolution - duplicate of ${remoteTx.id}]`
      : `[Created during conflict resolution - duplicate of ${remoteTx.id}]`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await db.transactions.add(newTx);

  // Capture the create for the duplicate
  await captureOp({
    entityType: 'transaction',
    entityId: newId,
    opType: 'create',
    value: newTx,
  });
}

async function mergeVersions(conflict: Conflict, mergedData: Partial<Transaction>): Promise<void> {
  const localTx = conflict.localValue as Transaction;

  // Merge the data
  const mergedTx: Transaction = {
    ...localTx,
    ...mergedData,
    updatedAt: new Date().toISOString(),
  };

  await db.transactions.put(mergedTx);

  // Capture updates for changed fields
  for (const [field, value] of Object.entries(mergedData)) {
    if (value !== localTx[field as keyof Transaction]) {
      await captureOp({
        entityType: 'transaction',
        entityId: conflict.entityId,
        opType: 'update',
        field,
        value,
        previousValue: localTx[field as keyof Transaction],
      });
    }
  }
}

// ============================================================================
// Batch Resolution
// ============================================================================

/**
 * Resolve all profile conflicts for an entity with the same resolution.
 */
export async function resolveAllProfileConflicts(
  entityType: string,
  entityId: string,
  resolution: ProfileResolution
): Promise<number> {
  const conflicts = await db.conflictQueue
    .where('entityId')
    .equals(entityId)
    .filter((c) => c.entityType === entityType && c.status === 'open')
    .toArray();

  for (const conflict of conflicts) {
    await resolveProfileConflict(conflict.id, resolution);
  }

  return conflicts.length;
}

/**
 * Resolve all open conflicts with a default resolution (keep remote - LWW wins).
 * Useful for "accept all" scenarios.
 */
export async function resolveAllConflicts(): Promise<number> {
  const conflicts = await db.conflictQueue.where('status').equals('open').toArray();

  for (const conflict of conflicts) {
    if (conflict.conflictType === 'profile_field') {
      await resolveProfileConflict(conflict.id, { action: 'keep_remote' });
    } else {
      await resolveMoneyConflict(conflict.id, { action: 'keep_remote' });
    }
  }

  return conflicts.length;
}

// ============================================================================
// Conflict Queries
// ============================================================================

export interface ConflictSummary {
  total: number;
  profileConflicts: number;
  moneyConflicts: number;
  byEntity: Record<string, number>;
}

/**
 * Get a summary of all open conflicts.
 */
export async function getConflictSummary(): Promise<ConflictSummary> {
  const conflicts = await db.conflictQueue.where('status').equals('open').toArray();

  const byEntity: Record<string, number> = {};
  let profileConflicts = 0;
  let moneyConflicts = 0;

  for (const c of conflicts) {
    const key = `${c.entityType}:${c.entityId}`;
    byEntity[key] = (byEntity[key] || 0) + 1;

    if (c.conflictType === 'profile_field') {
      profileConflicts++;
    } else {
      moneyConflicts++;
    }
  }

  return {
    total: conflicts.length,
    profileConflicts,
    moneyConflicts,
    byEntity,
  };
}

/**
 * Get all open conflicts for an entity.
 */
export async function getEntityConflicts(entityType: string, entityId: string): Promise<Conflict[]> {
  return db.conflictQueue
    .where('entityId')
    .equals(entityId)
    .filter((c) => c.entityType === entityType && c.status === 'open')
    .toArray();
}

/**
 * Get version history for a transaction.
 */
export async function getTransactionVersions(transactionId: string): Promise<MoneyEventVersion[]> {
  return db.moneyEventVersions
    .where('transactionId')
    .equals(transactionId)
    .sortBy('version');
}

// ============================================================================
// Helpers
// ============================================================================

function getTableForEntityType(entityType: string) {
  switch (entityType) {
    case 'client':
      return db.clients;
    case 'project':
      return db.projects;
    case 'transaction':
      return db.transactions;
    case 'category':
      return db.categories;
    case 'fxRate':
      return db.fxRates;
    default:
      throw new Error(`Unknown entity type: ${entityType}`);
  }
}
