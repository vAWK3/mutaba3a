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
  Expense,
  RecurringRule,
  Receipt,
  ExpenseCategory,
  Vendor,
  MonthCloseStatus,
  RetainerAgreement,
  ProjectedIncome,
} from '../types';
import type {
  Engagement,
  EngagementVersion,
} from '../features/engagements/types';
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

  // Expense tables (profile-scoped)
  expenses!: Table<Expense, string>;
  recurringRules!: Table<RecurringRule, string>;
  receipts!: Table<Receipt, string>;
  expenseCategories!: Table<ExpenseCategory, string>;
  vendors!: Table<Vendor, string>;
  monthCloseStatuses!: Table<MonthCloseStatus, string>;

  // Retainer tables
  retainerAgreements!: Table<RetainerAgreement, string>;
  projectedIncome!: Table<ProjectedIncome, string>;

  // Engagement tables
  engagements!: Table<Engagement, string>;
  engagementVersions!: Table<EngagementVersion, string>;

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

    // Version 4: Add expense tables (profile-scoped)
    this.version(4).stores({
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

      // Document tables unchanged
      businessProfiles: 'id, name, isDefault, createdAt, archivedAt',
      documents: 'id, number, type, status, businessProfileId, clientId, issueDate, dueDate, createdAt, updatedAt, deletedAt',
      documentSequences: 'id, [businessProfileId+documentType]',

      // New expense tables (profile-scoped)
      expenses: 'id, profileId, categoryId, currency, occurredAt, recurringRuleId, createdAt, deletedAt',
      recurringRules: 'id, profileId, categoryId, frequency, startDate, isPaused, createdAt',
      receipts: 'id, profileId, expenseId, monthKey, createdAt',
      expenseCategories: 'id, profileId, name',
    });

    // Version 5: Add vendors and monthly close tables
    this.version(5).stores({
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

      // Document tables unchanged
      businessProfiles: 'id, name, isDefault, createdAt, archivedAt',
      documents: 'id, number, type, status, businessProfileId, clientId, issueDate, dueDate, createdAt, updatedAt, deletedAt',
      documentSequences: 'id, [businessProfileId+documentType]',

      // Expense tables with vendorId index
      expenses: 'id, profileId, categoryId, vendorId, currency, occurredAt, recurringRuleId, createdAt, deletedAt',
      recurringRules: 'id, profileId, categoryId, frequency, startDate, isPaused, createdAt',
      receipts: 'id, profileId, expenseId, vendorId, monthKey, createdAt',
      expenseCategories: 'id, profileId, name',

      // New tables for vendor normalization and monthly close
      vendors: 'id, profileId, canonicalName, createdAt',
      monthCloseStatuses: 'id, profileId, monthKey, isClosed',
    });

    // Version 6: Add retainer tables
    this.version(6).stores({
      // Keep all existing tables unchanged
      clients: 'id, name, createdAt, updatedAt, archivedAt',
      projects: 'id, name, clientId, field, createdAt, updatedAt, archivedAt',
      categories: 'id, kind, name',
      // Add linkedProjectedIncomeId index to transactions
      transactions: 'id, kind, status, clientId, projectId, categoryId, currency, occurredAt, dueDate, paidAt, createdAt, updatedAt, deletedAt, linkedDocumentId, linkedProjectedIncomeId',
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

      // Document tables unchanged
      businessProfiles: 'id, name, isDefault, createdAt, archivedAt',
      documents: 'id, number, type, status, businessProfileId, clientId, issueDate, dueDate, createdAt, updatedAt, deletedAt',
      documentSequences: 'id, [businessProfileId+documentType]',

      // Expense tables unchanged
      expenses: 'id, profileId, categoryId, vendorId, currency, occurredAt, recurringRuleId, createdAt, deletedAt',
      recurringRules: 'id, profileId, categoryId, frequency, startDate, isPaused, createdAt',
      receipts: 'id, profileId, expenseId, vendorId, monthKey, createdAt',
      expenseCategories: 'id, profileId, name',
      vendors: 'id, profileId, canonicalName, createdAt',
      monthCloseStatuses: 'id, profileId, monthKey, isClosed',

      // New retainer tables
      retainerAgreements: 'id, clientId, projectId, status, currency, startDate, createdAt, archivedAt',
      projectedIncome: 'id, sourceId, clientId, expectedDate, state, currency, [sourceId+periodStart+periodEnd]',
    });

    // Version 7: Add profileId to retainer tables
    this.version(7).stores({
      // Keep all existing tables unchanged
      clients: 'id, name, createdAt, updatedAt, archivedAt',
      projects: 'id, name, clientId, field, createdAt, updatedAt, archivedAt',
      categories: 'id, kind, name',
      transactions: 'id, kind, status, clientId, projectId, categoryId, currency, occurredAt, dueDate, paidAt, createdAt, updatedAt, deletedAt, linkedDocumentId, linkedProjectedIncomeId',
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

      // Document tables unchanged
      businessProfiles: 'id, name, isDefault, createdAt, archivedAt',
      documents: 'id, number, type, status, businessProfileId, clientId, issueDate, dueDate, createdAt, updatedAt, deletedAt',
      documentSequences: 'id, [businessProfileId+documentType]',

      // Expense tables unchanged
      expenses: 'id, profileId, categoryId, vendorId, currency, occurredAt, recurringRuleId, createdAt, deletedAt',
      recurringRules: 'id, profileId, categoryId, frequency, startDate, isPaused, createdAt',
      receipts: 'id, profileId, expenseId, vendorId, monthKey, createdAt',
      expenseCategories: 'id, profileId, name',
      vendors: 'id, profileId, canonicalName, createdAt',
      monthCloseStatuses: 'id, profileId, monthKey, isClosed',

      // Retainer tables with profileId index
      retainerAgreements: 'id, profileId, clientId, projectId, status, currency, startDate, createdAt, archivedAt',
      projectedIncome: 'id, profileId, sourceId, clientId, expectedDate, state, currency, [sourceId+periodStart+periodEnd]',
    });

    // Version 8: Document immutability, unique numbering, and archive support
    this.version(8).stores({
      // Keep all existing tables unchanged
      clients: 'id, name, createdAt, updatedAt, archivedAt',
      projects: 'id, name, clientId, field, createdAt, updatedAt, archivedAt',
      categories: 'id, kind, name',
      // Add lockedAt and archivedAt indexes to transactions
      transactions: 'id, kind, status, clientId, projectId, categoryId, currency, occurredAt, dueDate, paidAt, createdAt, updatedAt, deletedAt, linkedDocumentId, linkedProjectedIncomeId, lockedAt, archivedAt',
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

      // Document tables with new indexes for uniqueness and immutability
      businessProfiles: 'id, name, isDefault, createdAt, archivedAt',
      // Add compound index for unique number enforcement and lockedAt/archivedAt indexes
      documents: 'id, number, type, status, businessProfileId, clientId, issueDate, dueDate, createdAt, updatedAt, deletedAt, [businessProfileId+type+number], lockedAt, archivedAt',
      documentSequences: 'id, [businessProfileId+documentType]',

      // Expense tables unchanged
      expenses: 'id, profileId, categoryId, vendorId, currency, occurredAt, recurringRuleId, createdAt, deletedAt',
      recurringRules: 'id, profileId, categoryId, frequency, startDate, isPaused, createdAt',
      receipts: 'id, profileId, expenseId, vendorId, monthKey, createdAt',
      expenseCategories: 'id, profileId, name',
      vendors: 'id, profileId, canonicalName, createdAt',
      monthCloseStatuses: 'id, profileId, monthKey, isClosed',

      // Retainer tables unchanged
      retainerAgreements: 'id, profileId, clientId, projectId, status, currency, startDate, createdAt, archivedAt',
      projectedIncome: 'id, profileId, sourceId, clientId, expectedDate, state, currency, [sourceId+periodStart+periodEnd]',
    }).upgrade(tx => {
      // Migration: set exportCount = 0 for all existing documents
      return tx.table('documents').toCollection().modify(doc => {
        if (doc.exportCount === undefined) {
          doc.exportCount = 0;
        }
      });
    });

    // Version 9: Add engagement kit tables
    this.version(9).stores({
      // Keep all existing tables unchanged
      clients: 'id, name, createdAt, updatedAt, archivedAt',
      projects: 'id, name, clientId, field, createdAt, updatedAt, archivedAt',
      categories: 'id, kind, name',
      transactions: 'id, kind, status, clientId, projectId, categoryId, currency, occurredAt, dueDate, paidAt, createdAt, updatedAt, deletedAt, linkedDocumentId, linkedProjectedIncomeId, lockedAt, archivedAt',
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

      // Document tables unchanged
      businessProfiles: 'id, name, isDefault, createdAt, archivedAt',
      documents: 'id, number, type, status, businessProfileId, clientId, issueDate, dueDate, createdAt, updatedAt, deletedAt, [businessProfileId+type+number], lockedAt, archivedAt',
      documentSequences: 'id, [businessProfileId+documentType]',

      // Expense tables unchanged
      expenses: 'id, profileId, categoryId, vendorId, currency, occurredAt, recurringRuleId, createdAt, deletedAt',
      recurringRules: 'id, profileId, categoryId, frequency, startDate, isPaused, createdAt',
      receipts: 'id, profileId, expenseId, vendorId, monthKey, createdAt',
      expenseCategories: 'id, profileId, name',
      vendors: 'id, profileId, canonicalName, createdAt',
      monthCloseStatuses: 'id, profileId, monthKey, isClosed',

      // Retainer tables unchanged
      retainerAgreements: 'id, profileId, clientId, projectId, status, currency, startDate, createdAt, archivedAt',
      projectedIncome: 'id, profileId, sourceId, clientId, expectedDate, state, currency, [sourceId+periodStart+periodEnd]',

      // New engagement kit tables
      engagements: 'id, clientId, projectId, type, category, status, primaryLanguage, createdAt, updatedAt, archivedAt',
      engagementVersions: 'id, engagementId, versionNumber, status, createdAt',
    });

    // Version 10: Add profileId to engagements
    this.version(10).stores({
      // Keep all existing tables unchanged
      clients: 'id, name, createdAt, updatedAt, archivedAt',
      projects: 'id, name, clientId, field, createdAt, updatedAt, archivedAt',
      categories: 'id, kind, name',
      transactions: 'id, kind, status, clientId, projectId, categoryId, currency, occurredAt, dueDate, paidAt, createdAt, updatedAt, deletedAt, linkedDocumentId, linkedProjectedIncomeId, lockedAt, archivedAt',
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

      // Document tables unchanged
      businessProfiles: 'id, name, isDefault, createdAt, archivedAt',
      documents: 'id, number, type, status, businessProfileId, clientId, issueDate, dueDate, createdAt, updatedAt, deletedAt, [businessProfileId+type+number], lockedAt, archivedAt',
      documentSequences: 'id, [businessProfileId+documentType]',

      // Expense tables unchanged
      expenses: 'id, profileId, categoryId, vendorId, currency, occurredAt, recurringRuleId, createdAt, deletedAt',
      recurringRules: 'id, profileId, categoryId, frequency, startDate, isPaused, createdAt',
      receipts: 'id, profileId, expenseId, vendorId, monthKey, createdAt',
      expenseCategories: 'id, profileId, name',
      vendors: 'id, profileId, canonicalName, createdAt',
      monthCloseStatuses: 'id, profileId, monthKey, isClosed',

      // Retainer tables unchanged
      retainerAgreements: 'id, profileId, clientId, projectId, status, currency, startDate, createdAt, archivedAt',
      projectedIncome: 'id, profileId, sourceId, clientId, expectedDate, state, currency, [sourceId+periodStart+periodEnd]',

      // Engagement tables with profileId index
      engagements: 'id, profileId, clientId, projectId, type, category, status, primaryLanguage, createdAt, updatedAt, archivedAt',
      engagementVersions: 'id, engagementId, versionNumber, status, createdAt',
    }).upgrade(async tx => {
      // Assign existing engagements to default profile
      const profiles = await tx.table('businessProfiles').toArray();
      if (profiles.length === 0) return;

      const defaultProfile = profiles.find((p: { isDefault?: boolean }) => p.isDefault) || profiles[0];

      await tx.table('engagements').toCollection().modify((engagement: { profileId?: string }) => {
        if (!engagement.profileId) {
          engagement.profileId = defaultProfile.id;
        }
      });
    });

    // Version 11: Add pdfVersion to documents for PDF versioning
    this.version(11).stores({
      // Keep all existing tables unchanged
      clients: 'id, name, createdAt, updatedAt, archivedAt',
      projects: 'id, name, clientId, field, createdAt, updatedAt, archivedAt',
      categories: 'id, kind, name',
      transactions: 'id, kind, status, clientId, projectId, categoryId, currency, occurredAt, dueDate, paidAt, createdAt, updatedAt, deletedAt, linkedDocumentId, linkedProjectedIncomeId, lockedAt, archivedAt',
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

      // Document tables unchanged (no schema change, just data migration)
      businessProfiles: 'id, name, isDefault, createdAt, archivedAt',
      documents: 'id, number, type, status, businessProfileId, clientId, issueDate, dueDate, createdAt, updatedAt, deletedAt, [businessProfileId+type+number], lockedAt, archivedAt',
      documentSequences: 'id, [businessProfileId+documentType]',

      // Expense tables unchanged
      expenses: 'id, profileId, categoryId, vendorId, currency, occurredAt, recurringRuleId, createdAt, deletedAt',
      recurringRules: 'id, profileId, categoryId, frequency, startDate, isPaused, createdAt',
      receipts: 'id, profileId, expenseId, vendorId, monthKey, createdAt',
      expenseCategories: 'id, profileId, name',
      vendors: 'id, profileId, canonicalName, createdAt',
      monthCloseStatuses: 'id, profileId, monthKey, isClosed',

      // Retainer tables unchanged
      retainerAgreements: 'id, profileId, clientId, projectId, status, currency, startDate, createdAt, archivedAt',
      projectedIncome: 'id, profileId, sourceId, clientId, expectedDate, state, currency, [sourceId+periodStart+periodEnd]',

      // Engagement tables unchanged
      engagements: 'id, profileId, clientId, projectId, type, category, status, primaryLanguage, createdAt, updatedAt, archivedAt',
      engagementVersions: 'id, engagementId, versionNumber, status, createdAt',
    }).upgrade(tx => {
      // Migration: set pdfVersion for all existing documents
      // - If document has pdfSavedPath (already exported), set pdfVersion = 1
      // - Otherwise, set pdfVersion = 0 (never exported)
      return tx.table('documents').toCollection().modify((doc: { pdfVersion?: number; pdfSavedPath?: string }) => {
        if (doc.pdfVersion === undefined) {
          doc.pdfVersion = doc.pdfSavedPath ? 1 : 0;
        }
      });
    });

    // Version 12: Add compound index for FX rate lookup by currency pair
    this.version(12).stores({
      // Keep all existing tables unchanged
      clients: 'id, name, createdAt, updatedAt, archivedAt',
      projects: 'id, name, clientId, field, createdAt, updatedAt, archivedAt',
      categories: 'id, kind, name',
      transactions: 'id, kind, status, clientId, projectId, categoryId, currency, occurredAt, dueDate, paidAt, createdAt, updatedAt, deletedAt, linkedDocumentId, linkedProjectedIncomeId, lockedAt, archivedAt',
      // Add compound index for fxRates currency pair lookup
      fxRates: 'id, baseCurrency, quoteCurrency, effectiveDate, createdAt, [baseCurrency+quoteCurrency]',
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

      // Document tables unchanged
      businessProfiles: 'id, name, isDefault, createdAt, archivedAt',
      documents: 'id, number, type, status, businessProfileId, clientId, issueDate, dueDate, createdAt, updatedAt, deletedAt, [businessProfileId+type+number], lockedAt, archivedAt',
      documentSequences: 'id, [businessProfileId+documentType]',

      // Expense tables unchanged
      expenses: 'id, profileId, categoryId, vendorId, currency, occurredAt, recurringRuleId, createdAt, deletedAt',
      recurringRules: 'id, profileId, categoryId, frequency, startDate, isPaused, createdAt',
      receipts: 'id, profileId, expenseId, vendorId, monthKey, createdAt',
      expenseCategories: 'id, profileId, name',
      vendors: 'id, profileId, canonicalName, createdAt',
      monthCloseStatuses: 'id, profileId, monthKey, isClosed',

      // Retainer tables unchanged
      retainerAgreements: 'id, profileId, clientId, projectId, status, currency, startDate, createdAt, archivedAt',
      projectedIncome: 'id, profileId, sourceId, clientId, expectedDate, state, currency, [sourceId+periodStart+periodEnd]',

      // Engagement tables unchanged
      engagements: 'id, profileId, clientId, projectId, type, category, status, primaryLanguage, createdAt, updatedAt, archivedAt',
      engagementVersions: 'id, engagementId, versionNumber, status, createdAt',
    });
  }
}

export const db = new MiniCrmDatabase();
