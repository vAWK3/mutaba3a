/**
 * Bundle Encoder/Decoder
 *
 * Handles creation and parsing of .msync bundle files.
 * Bundles contain operations since the last sync, encrypted with a passphrase.
 */

import { db } from '../../db/database';
import { getLocalDevice, getLocalOpsSince } from '../core/ops-engine';
import { HybridLogicalClock } from '../core/hlc';
import type { MsyncBundle, BundleManifest, Operation, SyncHistoryEntry } from '../core/ops-types';
import { encryptBundle, decryptBundle } from './crypto';

// ============================================================================
// Bundle Creation
// ============================================================================

export interface ExportOptions {
  /** HLC cursor - only include ops after this */
  sinceHlc?: string;
  /** Passphrase for encryption */
  passphrase: string;
  /** Target peer device ID (for cursor tracking) */
  targetPeerId?: string;
}

export interface ExportResult {
  /** Encrypted bundle data */
  data: ArrayBuffer;
  /** Suggested filename */
  filename: string;
  /** Number of ops included */
  opCount: number;
  /** Bundle manifest for display */
  manifest: BundleManifest;
}

/**
 * Create an encrypted sync bundle with operations since the given cursor.
 */
export async function createBundle(options: ExportOptions): Promise<ExportResult> {
  const device = getLocalDevice();

  // Get the starting cursor
  let sinceHlc = options.sinceHlc || HybridLogicalClock.zeroString();

  // If we have a target peer, use their cursor
  if (options.targetPeerId) {
    const cursor = await db.peerCursors.get(options.targetPeerId);
    if (cursor?.lastSentHlc) {
      sinceHlc = cursor.lastSentHlc;
    }
  }

  // Get local ops since cursor
  const ops = await getLocalOpsSince(sinceHlc);

  if (ops.length === 0) {
    throw new Error('No operations to export');
  }

  // Compute content hash
  const opsJson = JSON.stringify(ops);
  const contentHash = await computeHash(opsJson);

  // Get the last HLC
  const untilHlc = ops[ops.length - 1].hlc;

  // Create manifest
  const manifest: BundleManifest = {
    bundleVersion: 1,
    createdAt: new Date().toISOString(),
    createdBy: device.id,
    createdByName: device.name,
    sinceHlc: sinceHlc !== HybridLogicalClock.zeroString() ? sinceHlc : undefined,
    untilHlc,
    opCount: ops.length,
    contentHash,
  };

  // Create bundle
  const bundle: MsyncBundle = {
    manifest,
    ops,
  };

  // Encrypt
  const encrypted = await encryptBundle(bundle, options.passphrase);

  // Generate filename
  const date = new Date().toISOString().split('T')[0];
  const time = new Date().toISOString().split('T')[1].slice(0, 5).replace(':', '');
  const filename = `mutaba3a-sync_${device.name.replace(/[^a-zA-Z0-9]/g, '-')}_${date}_${time}.msync`;

  return {
    data: encrypted,
    filename,
    opCount: ops.length,
    manifest,
  };
}

/**
 * Create a full backup bundle (all ops from the beginning).
 */
export async function createFullBackupBundle(passphrase: string): Promise<ExportResult> {
  return createBundle({
    sinceHlc: HybridLogicalClock.zeroString(),
    passphrase,
  });
}

// ============================================================================
// Bundle Import
// ============================================================================

export interface ImportPreview {
  /** Bundle manifest */
  manifest: BundleManifest;
  /** Whether this bundle has already been imported */
  alreadyImported: boolean;
  /** Number of new ops that would be applied */
  newOpsCount: number;
}

export interface ImportResult {
  /** Number of ops successfully applied */
  applied: number;
  /** Number of ops skipped (already existed) */
  skipped: number;
  /** Number of conflicts created */
  conflicts: number;
  /** Sync history entry ID */
  historyId: string;
}

/**
 * Preview a bundle before importing.
 * Checks if the bundle has already been imported and how many new ops it contains.
 */
export async function previewBundle(data: ArrayBuffer, passphrase: string): Promise<ImportPreview> {
  const bundle = await decryptBundle(data, passphrase);

  // Check how many ops already exist
  const existingCount = await countExistingOps(bundle.ops);
  const newOpsCount = bundle.ops.length - existingCount;

  return {
    manifest: bundle.manifest,
    alreadyImported: newOpsCount === 0,
    newOpsCount,
  };
}

/**
 * Import a bundle and apply its operations.
 */
export async function importBundle(
  data: ArrayBuffer,
  passphrase: string
): Promise<ImportResult> {
  const bundle = await decryptBundle(data, passphrase);

  // Verify integrity
  const opsJson = JSON.stringify(bundle.ops);
  const hash = await computeHash(opsJson);

  if (hash !== bundle.manifest.contentHash) {
    throw new Error('Bundle integrity check failed - content may be corrupted');
  }

  // Import ops using ops engine
  const { applyOps } = await import('../core/ops-engine');
  const result = await applyOps(bundle.ops);

  // Record in sync history
  const historyEntry: SyncHistoryEntry = {
    id: crypto.randomUUID(),
    method: 'bundle_import',
    peerName: bundle.manifest.createdByName,
    pulledCount: result.applied,
    pushedCount: 0,
    conflictCount: result.conflicts.length,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    status: result.conflicts.length > 0 ? 'partial' : 'success',
  };

  await db.syncHistory.add(historyEntry);

  return {
    applied: result.applied,
    skipped: result.skipped,
    conflicts: result.conflicts.length,
    historyId: historyEntry.id,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

async function computeHash(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return 'sha256:' + hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function countExistingOps(ops: Operation[]): Promise<number> {
  let count = 0;
  for (const op of ops) {
    const existing = await db.opLog.get(op.id);
    if (existing) {
      count++;
    }
  }
  return count;
}

// ============================================================================
// File Helpers
// ============================================================================

/**
 * Download a bundle as a file in the browser.
 */
export function downloadBundle(data: ArrayBuffer, filename: string): void {
  const blob = new Blob([data], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}

/**
 * Read a bundle file from a File input.
 */
export async function readBundleFile(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Validate that a file has the .msync extension.
 */
export function isMsyncFile(filename: string): boolean {
  return filename.toLowerCase().endsWith('.msync');
}
