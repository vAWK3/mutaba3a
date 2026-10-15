// ============================================================================
// Dataset: whole-database operations (MUT-47)
// ============================================================================
//
// Backup and restore, per-business export and import, the legacy and CSV
// imports, "Delete all data", and the integrity and orphan checks. Before
// MUT-47 the Settings pages, the migration wizard and the orphan banner did
// these by importing `db` or these modules directly; now they reach them
// through `getRepositories().base.dataset`, so a non-Dexie source can supply
// its own. Each method keeps the behaviour it had at its old call site; the
// one deliberate change is that `importLegacyV1` is all or nothing (D8).

import { db } from './database';
import { serializeAllTables, restoreFromBackup } from './backup';
import { deleteAllData, clearDatabase } from './seed';
import { importProfileFile } from './profileImport';
import { importCsvRows } from './csvImport';
import { runIntegrityCheck } from './integrityCheck';
import { findOrphanedRecords } from './orphanedRecords';
import { reconcileFeaturesAfterDataLoad } from '../lib/features/features';
import type { Client, Project, Transaction } from '../types';
import type { LegacyImportFile, ProfileExportRows } from './interfaces';

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }

  return result;
}

/** The six tables a legacy (pre-v2) JSON export carries, in import order. */
const LEGACY_TABLES = ['clients', 'projects', 'categories', 'transactions', 'fxRates', 'settings'] as const;

export const datasetRepo = {
  serializeBackup: serializeAllTables,

  restoreBackup: restoreFromBackup,

  /**
   * Everything one business owns, plus the rows its documents and entries
   * point at (older records may have no profileId). Archived clients and
   * projects are included so their entries stay linked after an import
   * (review F3); deleted entries are not.
   */
  async exportProfile(profileId: string): Promise<ProfileExportRows> {
    const profile = await db.businessProfiles.get(profileId);
    if (!profile) throw new Error('Profile not found');

    const documents = await db.documents
      .filter((d) => d.businessProfileId === profileId && !d.deletedAt)
      .toArray();

    const documentSequences = await db.documentSequences
      .filter((s) => s.businessProfileId === profileId)
      .toArray();

    // Build seed IDs from profile-scoped and document-linked entities.
    // This keeps exports complete for current profile-scoped data and also
    // supports older records where profileId may be missing.
    const clientIds = new Set<string>();
    const projectIds = new Set<string>();
    const transactionIds = new Set<string>();

    documents.forEach((doc) => {
      if (doc.clientId) clientIds.add(doc.clientId);
      if (doc.linkedTransactionIds) {
        doc.linkedTransactionIds.forEach((id) => transactionIds.add(id));
      }
    });

    const profileClients = await db.clients
      .filter((c) => c.profileId === profileId)
      .toArray();

    const profileProjects = await db.projects
      .filter((p) => p.profileId === profileId)
      .toArray();

    const profileTransactions = await db.transactions
      .filter((t) => t.profileId === profileId && !t.deletedAt)
      .toArray();

    profileClients.forEach((c) => clientIds.add(c.id));
    profileProjects.forEach((p) => projectIds.add(p.id));
    profileTransactions.forEach((t) => {
      if (t.clientId) clientIds.add(t.clientId);
      if (t.projectId) projectIds.add(t.projectId);
    });

    const relatedClients = await db.clients
      .filter((c) => (c.profileId === profileId || !c.profileId) && clientIds.has(c.id))
      .toArray();

    relatedClients.forEach((c) => clientIds.add(c.id));

    const relatedProjects = await db.projects
      .filter((p) => {
        if (p.profileId && p.profileId !== profileId) return false;
        if (projectIds.has(p.id)) return true;
        return !!p.clientId && clientIds.has(p.clientId);
      })
      .toArray();

    relatedProjects.forEach((p) => projectIds.add(p.id));

    const relatedTransactions = await db.transactions
      .filter((t) => {
        if (t.deletedAt) return false;
        if (t.profileId && t.profileId !== profileId) return false;
        if (transactionIds.has(t.id)) return true;
        if (t.projectId && projectIds.has(t.projectId)) return true;
        if (t.clientId && clientIds.has(t.clientId)) return true;
        return false;
      })
      .toArray();

    // FX rates are shared across businesses, so all of them go out.
    const fxRates = await db.fxRates.toArray();

    return {
      profile,
      documents,
      documentSequences,
      clients: uniqueById([...profileClients, ...relatedClients]),
      projects: uniqueById([...profileProjects, ...relatedProjects]),
      transactions: uniqueById([...profileTransactions, ...relatedTransactions]),
      fxRates,
    };
  },

  importProfile: importProfileFile,

  /**
   * Replace the six legacy tables with a pre-v2 export. Clear and writes run
   * in one transaction: a failing write leaves the database as it was (D8).
   */
  async importLegacyV1(file: LegacyImportFile): Promise<{ transactions: number }> {
    const tables = LEGACY_TABLES.map((name) => db.table(name));
    await db.transaction('rw', tables, async () => {
      await clearDatabase();
      for (const name of LEGACY_TABLES) {
        const rows = file[name];
        if (rows?.length) await db.table(name).bulkAdd(rows);
      }
    });
    return { transactions: file.transactions?.length ?? 0 };
  },

  /** Every client and project name, all businesses, archived included (CSV validation). */
  async csvValidationContext(): Promise<{ clientNames: string[]; projectNames: string[] }> {
    const existingClients = await db.clients.toArray();
    const existingProjects = await db.projects.toArray();
    return {
      clientNames: existingClients.map((c) => c.name),
      projectNames: existingProjects.map((p) => p.name),
    };
  },

  importCsvRows,

  /** Raw client, project and transaction rows (the CSVs offered before "Delete all data"). */
  async exportCoreTables(): Promise<{ clients: Client[]; projects: Project[]; transactions: Transaction[] }> {
    const clients = await db.clients.toArray();
    const projects = await db.projects.toArray();
    const transactions = await db.transactions.toArray();
    return { clients, projects, transactions };
  },

  wipeAllData: deleteAllData,

  integrityCheck: runIntegrityCheck,

  findOrphanedRecords,

  /**
   * Switch on the optional areas the loaded data belongs to (MUT-12). Logged,
   * never thrown, so it cannot turn a successful import into an error.
   */
  async reconcileFeaturesAfterLoad(source: 'restore' | 'import' | 'demo'): Promise<void> {
    await reconcileFeaturesAfterDataLoad(source, db);
  },
};
