import Dexie, { type Table } from 'dexie';
import type {
  Client,
  Project,
  Category,
  Transaction,
  FxRate,
  Settings,
  BusinessProfile,
  Document,
  DocumentSequence,
} from '../types';
import type {
  LocalDevice,
  TrustedPeer,
  Operation,
  PeerCursor,
  EntityFieldMeta,
  MoneyEventVersion,
  Conflict,
  SyncHistoryEntry,
} from '../sync/core/ops-types';

export class MiniCrmDatabase extends Dexie {
  // Core business tables
  clients!: Table<Client, string>;
  projects!: Table<Project, string>;
  categories!: Table<Category, string>;
  transactions!: Table<Transaction, string>;
  fxRates!: Table<FxRate, string>;
  settings!: Table<Settings, string>;

  // Document/Invoice tables
  businessProfiles!: Table<BusinessProfile, string>;
  documents!: Table<Document, string>;
  documentSequences!: Table<DocumentSequence, string>;

  // Sync tables
  localDevice!: Table<LocalDevice, string>;
  trustedPeers!: Table<TrustedPeer, string>;
  opLog!: Table<Operation, string>;
  peerCursors!: Table<PeerCursor, string>;
  entityFieldMeta!: Table<EntityFieldMeta, string>;
  moneyEventVersions!: Table<MoneyEventVersion, string>;
  conflictQueue!: Table<Conflict, string>;
  syncHistory!: Table<SyncHistoryEntry, string>;

  constructor() {
    super('mutaba3a');

    // Version 1: Original schema
    this.version(1).stores({
      clients: 'id, name, createdAt, updatedAt, archivedAt',
      projects: 'id, name, clientId, field, createdAt, updatedAt, archivedAt',
      categories: 'id, kind, name',
      transactions: 'id, kind, status, clientId, projectId, categoryId, currency, occurredAt, dueDate, paidAt, createdAt, updatedAt, deletedAt',
      fxRates: 'id, baseCurrency, quoteCurrency, effectiveDate, createdAt',
      settings: 'id',
    });

    // Version 2: Add sync tables
    this.version(2).stores({
      // Keep existing tables unchanged
      clients: 'id, name, createdAt, updatedAt, archivedAt',
      projects: 'id, name, clientId, field, createdAt, updatedAt, archivedAt',
      categories: 'id, kind, name',
      transactions: 'id, kind, status, clientId, projectId, categoryId, currency, occurredAt, dueDate, paidAt, createdAt, updatedAt, deletedAt',
      fxRates: 'id, baseCurrency, quoteCurrency, effectiveDate, createdAt',
      settings: 'id',

      // New sync tables
      // Local device identity (singleton)
      localDevice: 'id',

      // Paired/trusted devices
      trustedPeers: 'id, pairingCode, status, pairedAt',

      // Append-only operations log
      // Primary key: id
      // Indexed: hlc (for ordering), entityType+entityId (for entity queries), appliedAt
      opLog: 'id, hlc, [entityType+entityId], createdBy, appliedAt',

      // Sync cursors per peer (tracks last synced position)
      peerCursors: 'peerId',

      // LWW field metadata for conflict detection
      // Compound key: entityType+entityId+field
      entityFieldMeta: '[entityType+entityId+field], hlc',

      // Transaction version history for money events
      moneyEventVersions: 'id, transactionId, hlc, isActive, createdBy',

      // Pending conflicts queue
      conflictQueue: 'id, entityType, entityId, status, detectedAt',

      // Sync history for audit
      syncHistory: 'id, peerId, method, status, completedAt',
    });

    // Version 3: Add document/invoice tables
    this.version(3).stores({
      // Keep all existing tables unchanged
      clients: 'id, name, createdAt, updatedAt, archivedAt',
      projects: 'id, name, clientId, field, createdAt, updatedAt, archivedAt',
      categories: 'id, kind, name',
      transactions: 'id, kind, status, clientId, projectId, categoryId, currency, occurredAt, dueDate, paidAt, createdAt, updatedAt, deletedAt, linkedDocumentId',
      fxRates: 'id, baseCurrency, quoteCurrency, effectiveDate, createdAt',
      settings: 'id',

      // Sync tables unchanged
      localDevice: 'id',
      trustedPeers: 'id, pairingCode, status, pairedAt',
      opLog: 'id, hlc, [entityType+entityId], createdBy, appliedAt',
      peerCursors: 'peerId',
      entityFieldMeta: '[entityType+entityId+field], hlc',
      moneyEventVersions: 'id, transactionId, hlc, isActive, createdBy',
      conflictQueue: 'id, entityType, entityId, status, detectedAt',
      syncHistory: 'id, peerId, method, status, completedAt',

      // New document/invoice tables
      // Business profiles (multi-identity support)
      businessProfiles: 'id, name, isDefault, createdAt, archivedAt',

      // Documents (invoices, receipts, credit notes, etc.)
      documents: 'id, number, type, status, businessProfileId, clientId, issueDate, dueDate, createdAt, updatedAt, deletedAt',

      // Document sequences for auto-numbering
      documentSequences: 'id, [businessProfileId+documentType]',
    });
  }
}

export const db = new MiniCrmDatabase();
