import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { db } from '../database';
import {
  createBackup,
  getLatestBackup,
  getAllBackups,
  restoreFromBackup,
  validateMigration,
  autoFixMigrationIssues,
  getMigrationLog,
  checkAndPrepareForMigration,
} from '../migration-safety';

describe('Migration Safety', () => {
  beforeEach(async () => {
    // Clear all tables
    await db.clients.clear();
    await db.projects.clear();
    await db.transactions.clear();
    await db.categories.clear();
    await db.fxRates.clear();
    await db.settings.clear();
    await db.businessProfiles.clear();
    await db.documents.clear();
    await db.documentSequences.clear();
    await db.expenses.clear();
    await db.recurringRules.clear();
    await db.receipts.clear();
    await db.expenseCategories.clear();
    await db.vendors.clear();
    await db.monthCloseStatuses.clear();
    await db.retainerAgreements.clear();
    await db.projectedIncome.clear();
    await db.engagements.clear();
    await db.engagementVersions.clear();

    // Clear backup database
    try {
      await Dexie.delete('mutaba3a_backup');
    } catch {
      // Ignore if doesn't exist
    }

    // Clear localStorage
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createBackup', () => {
    it('should create a backup with all tables', async () => {
      // Add some test data
      const now = new Date().toISOString();
      await db.businessProfiles.add({
        id: 'profile-1',
        name: 'Test Profile',
        email: 'test@example.com',
        businessType: 'none',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      });

      await db.clients.add({
        id: 'client-1',
        name: 'Test Client',
        profileId: 'profile-1',
        createdAt: now,
        updatedAt: now,
      });

      await db.transactions.add({
        id: 'tx-1',
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: now,
        profileId: 'profile-1',
        receivedAmountMinor: 10000,
        createdAt: now,
        updatedAt: now,
      });

      const backup = await createBackup('Test backup');

      expect(backup).toBeDefined();
      expect(backup.version).toBe(db.verno);
      expect(backup.timestamp).toBeDefined();
      expect(backup.checksum).toBeDefined();
      expect(backup.tables.clients).toHaveLength(1);
      expect(backup.tables.transactions).toHaveLength(1);
      expect(backup.tables.businessProfiles).toHaveLength(1);
    });

    it('should generate consistent checksum for same data', async () => {
      const now = new Date().toISOString();
      await db.clients.add({
        id: 'client-1',
        name: 'Test Client',
        createdAt: now,
        updatedAt: now,
      });

      const backup1 = await createBackup();
      const backup2 = await createBackup();

      expect(backup1.checksum).toBe(backup2.checksum);
    });
  });

  describe('getLatestBackup', () => {
    it('should return null when no backups exist', async () => {
      const backup = await getLatestBackup();
      expect(backup).toBeNull();
    });

    it('should return the most recent backup', async () => {
      // Create multiple backups
      await createBackup('First backup');
      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay
      await createBackup('Second backup');

      const latest = await getLatestBackup();
      expect(latest).toBeDefined();
    });
  });

  describe('getAllBackups', () => {
    it('should return empty array when no backups exist', async () => {
      const backups = await getAllBackups();
      expect(backups).toEqual([]);
    });

    it('should return all backups in reverse chronological order', async () => {
      await createBackup('First');
      await new Promise(resolve => setTimeout(resolve, 10));
      await createBackup('Second');

      const backups = await getAllBackups();
      expect(backups.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('restoreFromBackup', () => {
    it('should restore data from backup', async () => {
      const now = new Date().toISOString();

      // Create initial data
      await db.clients.add({
        id: 'client-1',
        name: 'Original Client',
        createdAt: now,
        updatedAt: now,
      });

      // Create backup
      const backup = await createBackup();

      // Modify data
      await db.clients.clear();
      await db.clients.add({
        id: 'client-2',
        name: 'New Client',
        createdAt: now,
        updatedAt: now,
      });

      // Verify data changed
      let clients = await db.clients.toArray();
      expect(clients[0].name).toBe('New Client');

      // Restore from backup
      const success = await restoreFromBackup(backup);
      expect(success).toBe(true);

      // Verify data restored
      clients = await db.clients.toArray();
      expect(clients).toHaveLength(1);
      expect(clients[0].name).toBe('Original Client');
    });
  });

  describe('validateMigration', () => {
    it('should pass validation for properly migrated data', async () => {
      const now = new Date().toISOString();

      // Create business profile first
      await db.businessProfiles.add({
        id: 'profile-1',
        name: 'Test Profile',
        email: 'test@example.com',
        businessType: 'none',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      });

      // Add properly formed data
      await db.clients.add({
        id: 'client-1',
        name: 'Test Client',
        profileId: 'profile-1',
        createdAt: now,
        updatedAt: now,
      });

      await db.transactions.add({
        id: 'tx-1',
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: now,
        profileId: 'profile-1',
        receivedAmountMinor: 10000,
        createdAt: now,
        updatedAt: now,
      });

      const result = await validateMigration();

      expect(result.success).toBe(true);
      expect(result.issues.filter(i => i.severity === 'error')).toHaveLength(0);
    });

    it('should detect missing profileId on clients', async () => {
      const now = new Date().toISOString();

      // Add client without profileId
      await db.clients.add({
        id: 'client-1',
        name: 'Test Client',
        // Missing profileId
        createdAt: now,
        updatedAt: now,
      });

      const result = await validateMigration();

      expect(result.success).toBe(false);
      const clientIssue = result.issues.find(i => i.table === 'clients');
      expect(clientIssue).toBeDefined();
      expect(clientIssue?.message).toContain('profileId');
    });

    it('should detect missing receivedAmountMinor on income transactions', async () => {
      const now = new Date().toISOString();

      // Create profile first
      await db.businessProfiles.add({
        id: 'profile-1',
        name: 'Test Profile',
        email: 'test@example.com',
        businessType: 'none',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      });

      // Add income transaction without receivedAmountMinor
      await db.transactions.add({
        id: 'tx-1',
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: now,
        profileId: 'profile-1',
        // Missing receivedAmountMinor
        createdAt: now,
        updatedAt: now,
      });

      const result = await validateMigration();

      expect(result.success).toBe(false);
      const txIssue = result.issues.find(
        i => i.table === 'transactions' && i.message.includes('receivedAmountMinor')
      );
      expect(txIssue).toBeDefined();
    });
  });

  describe('autoFixMigrationIssues', () => {
    it('should fix missing profileId on entities', async () => {
      const now = new Date().toISOString();

      // Create business profile
      await db.businessProfiles.add({
        id: 'profile-1',
        name: 'Test Profile',
        email: 'test@example.com',
        businessType: 'none',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      });

      // Add client without profileId
      await db.clients.add({
        id: 'client-1',
        name: 'Test Client',
        createdAt: now,
        updatedAt: now,
      });

      // Add project without profileId
      await db.projects.add({
        id: 'project-1',
        name: 'Test Project',
        createdAt: now,
        updatedAt: now,
      });

      // Run auto-fix
      const fixedCount = await autoFixMigrationIssues();
      expect(fixedCount).toBeGreaterThan(0);

      // Verify fix
      const client = await db.clients.get('client-1');
      expect(client?.profileId).toBe('profile-1');

      const project = await db.projects.get('project-1');
      expect(project?.profileId).toBe('profile-1');
    });

    it('should fix missing receivedAmountMinor on income', async () => {
      const now = new Date().toISOString();

      // Create business profile
      await db.businessProfiles.add({
        id: 'profile-1',
        name: 'Test Profile',
        email: 'test@example.com',
        businessType: 'none',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      });

      // Add paid income without receivedAmountMinor
      await db.transactions.add({
        id: 'tx-1',
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: now,
        profileId: 'profile-1',
        createdAt: now,
        updatedAt: now,
      });

      // Add unpaid income without receivedAmountMinor
      await db.transactions.add({
        id: 'tx-2',
        kind: 'income',
        status: 'unpaid',
        amountMinor: 5000,
        currency: 'USD',
        occurredAt: now,
        profileId: 'profile-1',
        createdAt: now,
        updatedAt: now,
      });

      // Run auto-fix
      const fixedCount = await autoFixMigrationIssues();
      expect(fixedCount).toBeGreaterThan(0);

      // Verify fix
      const paidTx = await db.transactions.get('tx-1');
      expect(paidTx?.receivedAmountMinor).toBe(10000);

      const unpaidTx = await db.transactions.get('tx-2');
      expect(unpaidTx?.receivedAmountMinor).toBe(0);
    });
  });

  describe('getMigrationLog', () => {
    it('should return empty array when no events logged', () => {
      const log = getMigrationLog();
      expect(log).toEqual([]);
    });

    it('should return logged events after backup', async () => {
      await createBackup('Test backup');
      const log = getMigrationLog();

      expect(log.length).toBeGreaterThan(0);
      expect(log[0].type).toBe('backup_created');
    });
  });

  describe('checkAndPrepareForMigration', () => {
    it('should detect version change', async () => {
      // Set a lower version
      localStorage.setItem('mutaba3a_last_known_version', '10');

      const result = await checkAndPrepareForMigration();

      expect(result.migrationNeeded).toBe(true);
      expect(result.fromVersion).toBe(10);
      expect(result.toVersion).toBe(db.verno);
    });

    it('should not detect migration on fresh install', async () => {
      // No previous version stored
      const result = await checkAndPrepareForMigration();

      expect(result.migrationNeeded).toBe(false);
      expect(result.fromVersion).toBe(0);
    });
  });
});
