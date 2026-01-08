import type {
  Client,
  Project,
  Transaction,
  Category,
  FxRate,
  Document,
  BusinessProfile,
} from '../../types';

// ============================================================================
// Hybrid Logical Clock
// ============================================================================

/**
 * Hybrid Logical Clock timestamp for consistent ordering across devices.
 * Combines physical time with logical counter for same-millisecond ordering.
 */
export interface HLC {
  /** Physical timestamp in milliseconds */
  ts: number;
  /** Logical counter for same-millisecond ordering */
  counter: number;
  /** Device ID for deterministic tie-breaking */
  nodeId: string;
}

// ============================================================================
// Device & Peer Types
// ============================================================================

export type DeviceType = 'desktop' | 'web' | 'mobile';

/**
 * Local device identity stored on this device.
 */
export interface LocalDevice {
  id: string;
  name: string;
  type: DeviceType;
  /** Base64-encoded public key for secure communication */
  publicKey: string;
  /** Base64-encoded private key (encrypted at rest) */
  privateKey: string;
  createdAt: string;
}

export type PeerStatus = 'pending' | 'verified' | 'revoked';

/**
 * A trusted peer device that we can sync with.
 */
export interface TrustedPeer {
  id: string;
  name: string;
  type: DeviceType;
  /** Base64-encoded public key */
  publicKey: string;
  /** Temporary pairing code during pairing flow */
  pairingCode?: string;
  pairedAt: string;
  lastSyncAt?: string;
  lastSeenAt?: string;
  status: PeerStatus;
}

/**
 * Discovered peer on LAN (not yet trusted).
 */
export interface DiscoveredPeer {
  deviceId: string;
  name: string;
  type: DeviceType;
  address: string;
  port: number;
  publicKeyFingerprint: string;
  requiresPairing: boolean;
}

// ============================================================================
// Operation Types
// ============================================================================

export type EntityType = 'client' | 'project' | 'transaction' | 'category' | 'fxRate' | 'document' | 'businessProfile';

export type OpType =
  // CRUD operations
  | 'create'
  | 'update'
  | 'delete'
  // Domain-specific operations
  | 'archive'
  | 'unarchive'
  | 'mark_paid'
  // Sync-specific operations
  | 'create_version'
  | 'set_active_version'
  | 'resolve_conflict';

/**
 * An immutable operation in the append-only log.
 * Operations are the unit of sync between devices.
 */
export interface Operation {
  /** Unique operation ID (UUIDv4) */
  id: string;
  /** Serialized HLC for indexing and ordering */
  hlc: string;
  /** Entity type being operated on */
  entityType: EntityType;
  /** ID of the entity being modified */
  entityId: string;
  /** Type of operation */
  opType: OpType;
  /** Field name for field-level updates */
  field?: string;
  /** New value (JSON-serializable) */
  value?: unknown;
  /** Previous value for conflict detection */
  previousValue?: unknown;
  /** Device ID that created this operation */
  createdBy: string;
  /** ISO timestamp when operation was created */
  createdAt: string;
  /** ISO timestamp when operation was applied locally (set on import) */
  appliedAt?: string;
}

// ============================================================================
// Sync Progress & Cursors
// ============================================================================

/**
 * Tracks sync progress with a specific peer.
 */
export interface PeerCursor {
  peerId: string;
  /** HLC of last operation received from this peer */
  lastReceivedHlc: string;
  /** HLC of last operation we sent to this peer */
  lastSentHlc: string;
  updatedAt: string;
}

// ============================================================================
// LWW Field Tracking
// ============================================================================

/**
 * Tracks the last write for a specific field on an entity.
 * Used for Last-Writer-Wins conflict resolution on profile data.
 */
export interface EntityFieldMeta {
  entityType: EntityType;
  entityId: string;
  field: string;
  /** HLC of the last update to this field */
  hlc: string;
  /** Current value of this field */
  value: unknown;
  /** Device that last updated this field */
  updatedBy: string;
}

// ============================================================================
// Money Event Versioning
// ============================================================================

/**
 * A version of a transaction (money event).
 * Transactions are versioned rather than overwritten to preserve audit trail.
 */
export interface MoneyEventVersion {
  /** Unique version ID */
  id: string;
  /** Transaction this version belongs to */
  transactionId: string;
  /** Version number (1, 2, 3...) */
  version: number;
  /** HLC when this version was created */
  hlc: string;
  /** Full transaction data snapshot */
  data: Transaction;
  /** Whether this is the currently active version */
  isActive: boolean;
  /** Device that created this version */
  createdBy: string;
  /** ISO timestamp */
  createdAt: string;
  /** Optional note explaining why version was created */
  note?: string;
}

// ============================================================================
// Conflicts
// ============================================================================

export type ConflictType = 'profile_field' | 'money_event_version';
export type ConflictStatus = 'open' | 'resolved';
export type ConflictResolution = 'local' | 'remote' | 'merged' | 'keep_both';

/**
 * A conflict that needs user resolution.
 */
export interface Conflict {
  id: string;
  entityType: EntityType;
  entityId: string;
  conflictType: ConflictType;
  /** Field name for profile conflicts */
  field?: string;
  /** The local operation that conflicts */
  localOp: Operation;
  /** The remote operation that conflicts */
  remoteOp: Operation;
  /** Local value at time of conflict */
  localValue: unknown;
  /** Remote value at time of conflict */
  remoteValue: unknown;
  /** Local device name for display */
  localDeviceName: string;
  /** Remote device name for display */
  remoteDeviceName: string;
  /** ISO timestamp when conflict was detected */
  detectedAt: string;
  /** ISO timestamp when conflict was resolved */
  resolvedAt?: string;
  status: ConflictStatus;
  /** How the conflict was resolved */
  resolution?: ConflictResolution;
  /** Operation ID of the resolution op */
  resolutionOpId?: string;
}

// ============================================================================
// Sync History
// ============================================================================

export type SyncMethod = 'wifi' | 'bundle_import' | 'bundle_export';
export type SyncStatus = 'success' | 'partial' | 'failed';

/**
 * A record of a sync operation for audit purposes.
 */
export interface SyncHistoryEntry {
  id: string;
  method: SyncMethod;
  peerId?: string;
  peerName?: string;
  /** Number of operations pulled (received) */
  pulledCount: number;
  /** Number of operations pushed (sent) */
  pushedCount: number;
  /** Number of conflicts created */
  conflictCount: number;
  startedAt: string;
  completedAt: string;
  status: SyncStatus;
  /** Error code if failed */
  errorCode?: string;
  /** Error message if failed */
  errorMessage?: string;
}

// ============================================================================
// Sync Bundle Format
// ============================================================================

/**
 * Manifest for a sync bundle (.msync file).
 */
export interface BundleManifest {
  /** Bundle format version */
  bundleVersion: 1;
  /** ISO timestamp when bundle was created */
  createdAt: string;
  /** Device ID that created the bundle */
  createdBy: string;
  /** Device name that created the bundle */
  createdByName: string;
  /** HLC cursor from which ops are included (exclusive) */
  sinceHlc?: string;
  /** HLC of the last op in bundle */
  untilHlc: string;
  /** Number of operations in bundle */
  opCount: number;
  /** SHA-256 hash of ops NDJSON for integrity */
  contentHash: string;
}

/**
 * Full bundle structure before encryption.
 */
export interface MsyncBundle {
  manifest: BundleManifest;
  ops: Operation[];
}

// ============================================================================
// Sync Protocol Types
// ============================================================================

export interface PullRequest {
  /** Requesting device ID */
  deviceId: string;
  /** Get ops with HLC > sinceHlc */
  sinceHlc: string;
  /** Maximum ops to return (for chunking) */
  maxOps?: number;
  /** Request signature for auth */
  signature?: string;
}

export interface PullResponse {
  ops: Operation[];
  /** Whether there are more ops to fetch */
  hasMore: boolean;
  /** Cursor for next request */
  nextCursor: string;
  /** Server's current HLC for clock sync */
  serverHlc: string;
}

export interface PushRequest {
  /** Sending device ID */
  deviceId: string;
  ops: Operation[];
  /** Request signature for auth */
  signature?: string;
}

export interface PushResponse {
  /** Number of ops accepted */
  accepted: number;
  /** Ops that were rejected */
  rejected: Array<{ opId: string; reason: string }>;
  /** Server's current HLC for clock sync */
  serverHlc: string;
}

// ============================================================================
// Entity Maps for Type Safety
// ============================================================================

export type EntityDataMap = {
  client: Client;
  project: Project;
  transaction: Transaction;
  category: Category;
  fxRate: FxRate;
  document: Document;
  businessProfile: BusinessProfile;
};

// ============================================================================
// Sync State
// ============================================================================

export type SyncConnectionStatus = 'idle' | 'syncing' | 'error' | 'offline';

export interface SyncState {
  status: SyncConnectionStatus;
  serverRunning: boolean;
  serverPort?: number;
  pendingOpsCount: number;
  pendingConflictsCount: number;
  lastSyncAt?: string;
  lastError?: string;
  discoveredPeers: DiscoveredPeer[];
  isDiscovering: boolean;
}

// ============================================================================
// Error Codes
// ============================================================================

export type SyncErrorCode =
  | 'LAN_NOT_AVAILABLE'
  | 'NO_TRUSTED_PEER_FOUND'
  | 'PEER_NOT_ONLINE'
  | 'FIREWALL_BLOCKED'
  | 'AUTH_FAILED'
  | 'BUNDLE_BAD_PASSPHRASE'
  | 'BUNDLE_CORRUPT'
  | 'BUNDLE_ALREADY_IMPORTED'
  | 'PAIRING_FAILED'
  | 'SYNC_INTERRUPTED'
  | 'UNKNOWN_ERROR';

export class SyncError extends Error {
  code: SyncErrorCode;

  constructor(code: SyncErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'SyncError';
  }
}
