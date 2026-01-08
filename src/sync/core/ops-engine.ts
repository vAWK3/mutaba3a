import { db } from '../../db/database';
import { HybridLogicalClock, tick, receive } from './hlc';
import type {
  EntityType,
  OpType,
  Conflict,
  EntityFieldMeta,
  MoneyEventVersion,
  LocalDevice,
  HLC,
  Operation,
} from './ops-types';
import type { Client, Project, Transaction, Category, FxRate } from '../../types';

// ============================================================================
// Device Identity
// ============================================================================

let cachedDevice: LocalDevice | null = null;

/**
 * Get or create the local device identity.
 * This is called at app startup to initialize the sync system.
 */
export async function getOrCreateLocalDevice(): Promise<LocalDevice> {
  if (cachedDevice) {
    return cachedDevice;
  }

  // Try to get existing device
  const existing = await db.localDevice.toArray();
  if (existing.length > 0) {
    cachedDevice = existing[0];
    return cachedDevice;
  }

  // Create new device identity
  const device: LocalDevice = {
    id: crypto.randomUUID(),
    name: await generateDeviceName(),
    type: detectDeviceType(),
    publicKey: '', // Will be generated when needed
    privateKey: '', // Will be generated when needed
    createdAt: new Date().toISOString(),
  };

  await db.localDevice.add(device);
  cachedDevice = device;
  return device;
}

/**
 * Get the cached local device. Throws if not initialized.
 */
export function getLocalDevice(): LocalDevice {
  if (!cachedDevice) {
    throw new Error('Local device not initialized. Call getOrCreateLocalDevice() first.');
  }
  return cachedDevice;
}

function detectDeviceType(): 'desktop' | 'web' | 'mobile' {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    return 'desktop';
  }
  return 'web';
}

async function generateDeviceName(): Promise<string> {
  const type = detectDeviceType();
  const platform = navigator.platform || 'Unknown';

  if (type === 'desktop') {
    // Try to get hostname via Tauri command
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const name = await invoke<string>('get_hostname');
      return name || `Desktop (${platform})`;
    } catch {
      return `Desktop (${platform})`;
    }
  }

  return `Web Browser (${platform})`;
}

// ============================================================================
// Operation Capture
// ============================================================================

interface CaptureParams {
  entityType: EntityType;
  entityId: string;
  opType: OpType;
  field?: string;
  value?: unknown;
  previousValue?: unknown;
}

/**
 * Capture a mutation as an operation in the ops log.
 * Called by synced repositories after performing a mutation.
 */
export async function captureOp(params: CaptureParams): Promise<Operation> {
  const device = getLocalDevice();
  const hlc = tick();

  const op: Operation = {
    id: crypto.randomUUID(),
    hlc: HybridLogicalClock.serialize(hlc),
    entityType: params.entityType,
    entityId: params.entityId,
    opType: params.opType,
    field: params.field,
    value: params.value,
    previousValue: params.previousValue,
    createdBy: device.id,
    createdAt: new Date().toISOString(),
    appliedAt: new Date().toISOString(), // Applied immediately for local ops
  };

  // Store in ops log
  await db.opLog.add(op);

  // Update field meta for LWW tracking (if this is a field update)
  if (params.field && params.opType === 'update') {
    await updateFieldMeta(params.entityType, params.entityId, params.field, hlc, params.value, device.id);
  }

  // Also store in Rust backend for mobile sync (pull)
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('store_local_sync_op', { op });
      console.log('[OpsEngine] Stored op for mobile sync:', op.id);
    } catch (error) {
      console.error('[OpsEngine] Failed to store op in Rust:', error);
    }
  }

  return op;
}

/**
 * Capture a create operation with all fields.
 */
export async function captureCreate<T extends Record<string, unknown>>(
  entityType: EntityType,
  entity: T & { id: string }
): Promise<Operation> {
  return captureOp({
    entityType,
    entityId: entity.id,
    opType: 'create',
    value: entity,
  });
}

/**
 * Capture field-level update operations.
 * Creates one op per changed field for fine-grained LWW.
 */
export async function captureUpdate<T extends Record<string, unknown>>(
  entityType: EntityType,
  entityId: string,
  changes: Partial<T>,
  previousValues: Partial<T>
): Promise<Operation[]> {
  const ops: Operation[] = [];

  for (const [field, value] of Object.entries(changes)) {
    // Skip internal fields
    if (field === 'id' || field === 'createdAt') continue;

    const op = await captureOp({
      entityType,
      entityId,
      opType: 'update',
      field,
      value,
      previousValue: previousValues[field],
    });
    ops.push(op);
  }

  return ops;
}

/**
 * Capture a delete operation.
 */
export async function captureDelete(entityType: EntityType, entityId: string): Promise<Operation> {
  return captureOp({
    entityType,
    entityId,
    opType: 'delete',
  });
}

/**
 * Capture an archive operation.
 */
export async function captureArchive(entityType: EntityType, entityId: string): Promise<Operation> {
  return captureOp({
    entityType,
    entityId,
    opType: 'archive',
    value: new Date().toISOString(),
  });
}

/**
 * Capture a mark_paid operation for transactions.
 */
export async function captureMarkPaid(transactionId: string, paidAt: string): Promise<Operation> {
  return captureOp({
    entityType: 'transaction',
    entityId: transactionId,
    opType: 'mark_paid',
    value: paidAt,
  });
}

// ============================================================================
// Operation Application
// ============================================================================

interface ApplyResult {
  applied: boolean;
  conflict?: Conflict;
  skipped?: boolean;
  reason?: string;
}

/**
 * Apply a remote operation.
 * Returns whether it was applied and any conflict that was created.
 */
export async function applyOp(op: Operation): Promise<ApplyResult> {
  // Check if already applied (idempotency)
  const existing = await db.opLog.get(op.id);
  if (existing) {
    return { applied: false, skipped: true, reason: 'already_applied' };
  }

  // Update our clock with the remote timestamp
  const remoteHlc = HybridLogicalClock.parse(op.hlc);
  receive(remoteHlc);

  // Route to appropriate handler based on entity type
  let result: ApplyResult;

  if (op.entityType === 'transaction' && op.opType === 'update') {
    // Money events use versioning, not LWW
    result = await applyMoneyEventOp(op);
  } else if (op.opType === 'update' && op.field) {
    // Profile fields use LWW
    result = await applyProfileFieldOp(op);
  } else {
    // Other ops (create, delete, archive, etc.)
    result = await applyGenericOp(op);
  }

  // Store the operation in our log
  await db.opLog.add({
    ...op,
    appliedAt: new Date().toISOString(),
  });

  return result;
}

/**
 * Apply a profile field update with LWW conflict detection.
 */
async function applyProfileFieldOp(op: Operation): Promise<ApplyResult> {
  const remoteHlc = HybridLogicalClock.parse(op.hlc);

  // Get existing field meta
  const meta = await db.entityFieldMeta
    .where('[entityType+entityId+field]')
    .equals([op.entityType, op.entityId, op.field!])
    .first();

  if (meta) {
    const localHlc = HybridLogicalClock.parse(meta.hlc);

    // LWW: only apply if remote is newer
    if (HybridLogicalClock.lte(remoteHlc, localHlc)) {
      return { applied: false, reason: 'lww_local_wins' };
    }

    // Check for concurrent edits (conflict to surface)
    const device = getLocalDevice();
    if (meta.updatedBy === device.id && meta.updatedBy !== op.createdBy) {
      // Both sides edited - create conflict for user awareness
      const conflict = await createFieldConflict(op, meta);

      // Still apply (LWW wins) but surface conflict
      await doApplyFieldUpdate(op);
      await updateFieldMeta(op.entityType, op.entityId, op.field!, remoteHlc, op.value, op.createdBy);

      return { applied: true, conflict };
    }
  }

  // Apply the update
  await doApplyFieldUpdate(op);
  await updateFieldMeta(op.entityType, op.entityId, op.field!, remoteHlc, op.value, op.createdBy);

  return { applied: true };
}

/**
 * Apply a money event operation with versioning.
 */
async function applyMoneyEventOp(op: Operation): Promise<ApplyResult> {
  const transaction = await db.transactions.get(op.entityId);

  if (!transaction) {
    // Transaction doesn't exist, apply as create
    return applyGenericOp(op);
  }

  const device = getLocalDevice();
  const remoteHlc = HybridLogicalClock.parse(op.hlc);

  // Get the most recent version
  const versions = await db.moneyEventVersions
    .where('transactionId')
    .equals(op.entityId)
    .toArray();

  // Check if we have local changes since last sync
  const hasLocalChanges = versions.some((v) => v.createdBy === device.id);

  if (hasLocalChanges) {
    // Create a version conflict
    const conflict = await createMoneyEventConflict(op, transaction, versions);

    // Create new version from remote
    await createTransactionVersion(op.entityId, transaction, remoteHlc, op.createdBy, false);

    // Apply the remote changes as the new active state
    await doApplyFieldUpdate(op);

    return { applied: true, conflict };
  }

  // No conflict - just apply
  await createTransactionVersion(op.entityId, transaction, remoteHlc, op.createdBy, false);
  await doApplyFieldUpdate(op);

  return { applied: true };
}

/**
 * Apply a generic operation (create, delete, archive, etc.)
 */
async function applyGenericOp(op: Operation): Promise<ApplyResult> {
  switch (op.opType) {
    case 'create':
      await applyCreate(op);
      break;
    case 'delete':
      await applyDelete(op);
      break;
    case 'archive':
      await applyArchive(op);
      break;
    case 'unarchive':
      await applyUnarchive(op);
      break;
    case 'mark_paid':
      await applyMarkPaid(op);
      break;
    case 'resolve_conflict':
      await applyConflictResolution(op);
      break;
    case 'set_active_version':
      await applySetActiveVersion(op);
      break;
    default:
      console.warn(`Unknown op type: ${op.opType}`);
  }

  return { applied: true };
}

// ============================================================================
// Entity-Specific Apply Functions
// ============================================================================

async function applyCreate(op: Operation): Promise<void> {
  const data = op.value;

  switch (op.entityType) {
    case 'client':
      await db.clients.put(data as unknown as Client);
      break;
    case 'project':
      await db.projects.put(data as unknown as Project);
      break;
    case 'transaction':
      await db.transactions.put(data as unknown as Transaction);
      break;
    case 'category':
      await db.categories.put(data as unknown as Category);
      break;
    case 'fxRate':
      await db.fxRates.put(data as unknown as FxRate);
      break;
  }
}

async function doApplyFieldUpdate(op: Operation): Promise<void> {
  if (!op.field) return;

  const table = getTableForEntityType(op.entityType);
  const entity = await table.get(op.entityId);

  if (entity) {
    await table.update(op.entityId, {
      [op.field]: op.value,
      updatedAt: new Date().toISOString(),
    });
  }
}

async function applyDelete(op: Operation): Promise<void> {
  const table = getTableForEntityType(op.entityType);

  if (op.entityType === 'transaction') {
    // Soft delete for transactions
    await table.update(op.entityId, {
      deletedAt: new Date().toISOString(),
    });
  } else {
    // Hard delete for other entities
    await table.delete(op.entityId);
  }
}

async function applyArchive(op: Operation): Promise<void> {
  const table = getTableForEntityType(op.entityType);
  await table.update(op.entityId, {
    archivedAt: op.value as string,
    updatedAt: new Date().toISOString(),
  });
}

async function applyUnarchive(op: Operation): Promise<void> {
  const table = getTableForEntityType(op.entityType);
  await table.update(op.entityId, {
    archivedAt: undefined,
    updatedAt: new Date().toISOString(),
  });
}

async function applyMarkPaid(op: Operation): Promise<void> {
  await db.transactions.update(op.entityId, {
    status: 'paid',
    paidAt: op.value as string,
    updatedAt: new Date().toISOString(),
  });
}

async function applyConflictResolution(op: Operation): Promise<void> {
  const resolution = op.value as { conflictId: string; resolution: string };

  await db.conflictQueue.update(resolution.conflictId, {
    status: 'resolved',
    resolution: resolution.resolution as 'local' | 'remote' | 'merged' | 'keep_both',
    resolvedAt: new Date().toISOString(),
    resolutionOpId: op.id,
  });
}

async function applySetActiveVersion(op: Operation): Promise<void> {
  const { transactionId, versionId } = op.value as { transactionId: string; versionId: string };

  // Deactivate all versions
  await db.moneyEventVersions
    .where('transactionId')
    .equals(transactionId)
    .modify({ isActive: false });

  // Activate the selected version
  await db.moneyEventVersions.update(versionId, { isActive: true });

  // Update the transaction with the active version's data
  const version = await db.moneyEventVersions.get(versionId);
  if (version) {
    await db.transactions.put(version.data);
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function getTableForEntityType(entityType: EntityType) {
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

async function updateFieldMeta(
  entityType: EntityType,
  entityId: string,
  field: string,
  hlc: HLC,
  value: unknown,
  updatedBy: string
): Promise<void> {
  const meta: EntityFieldMeta = {
    entityType,
    entityId,
    field,
    hlc: HybridLogicalClock.serialize(hlc),
    value,
    updatedBy,
  };

  await db.entityFieldMeta.put(meta);
}

async function createFieldConflict(op: Operation, localMeta: EntityFieldMeta): Promise<Conflict> {
  const device = getLocalDevice();

  // Find the local op that caused the conflict
  const localOp = await db.opLog
    .where('[entityType+entityId]')
    .equals([op.entityType, op.entityId])
    .filter((o) => o.field === op.field && o.createdBy === device.id)
    .last();

  const peerName = await getPeerName(op.createdBy);

  const conflict: Conflict = {
    id: crypto.randomUUID(),
    entityType: op.entityType,
    entityId: op.entityId,
    conflictType: 'profile_field',
    field: op.field,
    localOp: localOp!,
    remoteOp: op,
    localValue: localMeta.value,
    remoteValue: op.value,
    localDeviceName: device.name,
    remoteDeviceName: peerName,
    detectedAt: new Date().toISOString(),
    status: 'open',
  };

  await db.conflictQueue.add(conflict);
  return conflict;
}

async function createMoneyEventConflict(
  op: Operation,
  transaction: Transaction,
  _versions: MoneyEventVersion[]
): Promise<Conflict> {
  const device = getLocalDevice();
  const peerName = await getPeerName(op.createdBy);

  // Find local op for this transaction
  const localOp = await db.opLog
    .where('[entityType+entityId]')
    .equals(['transaction', op.entityId])
    .filter((o) => o.createdBy === device.id)
    .last();

  const conflict: Conflict = {
    id: crypto.randomUUID(),
    entityType: 'transaction',
    entityId: op.entityId,
    conflictType: 'money_event_version',
    localOp: localOp!,
    remoteOp: op,
    localValue: transaction,
    remoteValue: op.value,
    localDeviceName: device.name,
    remoteDeviceName: peerName,
    detectedAt: new Date().toISOString(),
    status: 'open',
  };

  await db.conflictQueue.add(conflict);
  return conflict;
}

async function createTransactionVersion(
  transactionId: string,
  data: Transaction,
  hlc: HLC,
  createdBy: string,
  isActive: boolean
): Promise<MoneyEventVersion> {
  // Get next version number
  const existingVersions = await db.moneyEventVersions
    .where('transactionId')
    .equals(transactionId)
    .count();

  const version: MoneyEventVersion = {
    id: crypto.randomUUID(),
    transactionId,
    version: existingVersions + 1,
    hlc: HybridLogicalClock.serialize(hlc),
    data,
    isActive,
    createdBy,
    createdAt: new Date().toISOString(),
  };

  await db.moneyEventVersions.add(version);
  return version;
}

async function getPeerName(deviceId: string): Promise<string> {
  const peer = await db.trustedPeers.get(deviceId);
  return peer?.name || 'Unknown Device';
}

// ============================================================================
// Batch Operations
// ============================================================================

/**
 * Apply multiple operations in order.
 * Used when syncing with a peer or importing a bundle.
 */
export async function applyOps(ops: Operation[]): Promise<{
  applied: number;
  skipped: number;
  conflicts: Conflict[];
}> {
  // Sort ops by HLC to ensure correct ordering
  const sorted = [...ops].sort((a, b) => a.hlc.localeCompare(b.hlc));

  let applied = 0;
  let skipped = 0;
  const conflicts: Conflict[] = [];

  for (const op of sorted) {
    const result = await applyOp(op);

    if (result.applied) {
      applied++;
    } else if (result.skipped) {
      skipped++;
    }

    if (result.conflict) {
      conflicts.push(result.conflict);
    }
  }

  return { applied, skipped, conflicts };
}

/**
 * Get operations since a given HLC cursor.
 * Used for push operations during sync.
 */
export async function getOpsSince(sinceHlc: string, maxOps = 1000): Promise<Operation[]> {
  return db.opLog
    .where('hlc')
    .above(sinceHlc)
    .limit(maxOps)
    .sortBy('hlc');
}

/**
 * Get all operations created by the local device since a given HLC.
 */
export async function getLocalOpsSince(sinceHlc: string): Promise<Operation[]> {
  const device = getLocalDevice();

  return db.opLog
    .where('hlc')
    .above(sinceHlc)
    .filter((op) => op.createdBy === device.id)
    .sortBy('hlc');
}

/**
 * Get the count of pending (unsynced) operations.
 */
export async function getPendingOpsCount(peerCursorHlc: string): Promise<number> {
  const device = getLocalDevice();

  return db.opLog
    .where('hlc')
    .above(peerCursorHlc)
    .filter((op) => op.createdBy === device.id)
    .count();
}

/**
 * Get all open conflicts.
 */
export async function getOpenConflicts(): Promise<Conflict[]> {
  return db.conflictQueue.where('status').equals('open').toArray();
}

/**
 * Get count of open conflicts.
 */
export async function getOpenConflictsCount(): Promise<number> {
  return db.conflictQueue.where('status').equals('open').count();
}
