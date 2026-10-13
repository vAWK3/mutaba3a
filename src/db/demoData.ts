// ============================================================================
// Demo data storage (MUT-47)
// ============================================================================
//
// The storage half of the `?demo=1` seed and the landing page's visitor
// sample (MUT-78). The row generators and the session logic stay in
// src/demo; what reads or writes the database lives here and is reached
// through `getRepositories().base.demoData`. Every sample row's id starts with
// `demo_`, which is how removal and the "own data" checks tell them apart.

import type { Table } from 'dexie';
import { db } from './database';
import { enforceSingleDefaultProfile } from './profileDefault';
import { reconcileFeaturesAfterDataLoad } from '../lib/features/features';
import { DEMO_ID_PREFIX, DEMO_PREFIXES } from '../demo/constants';
import type { FeatureKey, Transaction } from '../types';
import type { DemoSeedRows } from './interfaces';

interface DatedRow {
  id: string;
  createdAt?: string;
}

/** Tables where a visitor can add rows while looking around. */
function sessionTables(): Table<DatedRow, string>[] {
  return [
    db.businessProfiles,
    db.clients,
    db.projects,
    db.transactions,
    db.paymentRecords,
    db.expenses,
    db.retainerAgreements,
  ] as unknown as Table<DatedRow, string>[];
}

/**
 * Tables whose non-sample rows mean the person has data of their own.
 * `documents` stays after MUT-145: invoices issued before document generation
 * was retired are still the person's data (ADR-029, ADR-042).
 */
function ownDataTables(): Table<DatedRow, string>[] {
  return [db.clients, db.projects, db.transactions, db.expenses, db.documents] as unknown as Table<
    DatedRow,
    string
  >[];
}

const isSampleRow = (row: DatedRow) => row.id.startsWith(DEMO_ID_PREFIX);

function addedSince(startedAt: string) {
  return (row: DatedRow) => !isSampleRow(row) && !!row.createdAt && row.createdAt >= startedAt;
}

export const demoDataRepo = {
  /** Whether any sample client, entry or (older seeds) document exists. */
  async hasDemoData(): Promise<boolean> {
    // Check a few tables for demo prefixed IDs
    const [client, transaction, document] = await Promise.all([
      db.clients.where('id').startsWith(DEMO_ID_PREFIX).first(),
      db.transactions.where('id').startsWith(DEMO_ID_PREFIX).first(),
      db.documents.where('id').startsWith(DEMO_ID_PREFIX).first(),
    ]);

    return !!(client || transaction || document);
  },

  /** Remove every `demo_` row from the twelve seeded tables; nothing else. */
  async removeDemoData(): Promise<void> {
    await db.transaction(
      'rw',
      [
        db.clients,
        db.projects,
        db.categories,
        db.transactions,
        db.businessProfiles,
        // Retained (MUT-145): older demo seeds wrote demo_ documents; clear them too.
        db.documents,
        db.documentSequences,
        db.retainerAgreements,
        db.projectedIncome,
        db.expenses,
        db.expenseCategories,
        db.recurringRules,
      ],
      async () => {
        // Delete in reverse dependency order
        await db.projectedIncome.where('id').startsWith(DEMO_ID_PREFIX).delete();
        await db.retainerAgreements.where('id').startsWith(DEMO_ID_PREFIX).delete();
        await db.documents.where('id').startsWith(DEMO_ID_PREFIX).delete();
        await db.documentSequences.where('id').startsWith(DEMO_ID_PREFIX).delete();
        await db.transactions.where('id').startsWith(DEMO_ID_PREFIX).delete();
        await db.expenses.where('id').startsWith(DEMO_ID_PREFIX).delete();
        await db.recurringRules.where('id').startsWith(DEMO_ID_PREFIX).delete();
        await db.expenseCategories.where('id').startsWith(DEMO_ID_PREFIX).delete();
        await db.categories.where('id').startsWith(DEMO_ID_PREFIX).delete();
        await db.projects.where('id').startsWith(DEMO_ID_PREFIX).delete();
        await db.clients.where('id').startsWith(DEMO_ID_PREFIX).delete();
        await db.businessProfiles.where('id').startsWith(DEMO_ID_PREFIX).delete();
      }
    );

    console.log('Demo data removed successfully');
  },

  /** Whether the person already has a live default business of their own. */
  async hasUserDefaultProfile(): Promise<boolean> {
    return !!(await db.businessProfiles
      .filter((p) => !!p.isDefault && !p.archivedAt && !p.id.startsWith(DEMO_ID_PREFIX))
      .first());
  },

  /**
   * Write the generated sample in one transaction, then switch on the
   * optional areas it uses. Returns the areas that were switched on.
   */
  async seed(rows: DemoSeedRows): Promise<FeatureKey[]> {
    await db.transaction(
      'rw',
      [
        db.clients,
        db.projects,
        db.categories,
        db.transactions,
        db.businessProfiles,
        db.retainerAgreements,
        db.projectedIncome,
        db.expenses,
        db.expenseCategories,
        db.recurringRules,
      ],
      async () => {
        // Insert in dependency order
        await db.businessProfiles.bulkPut(rows.businessProfiles);
        // The caller's hasUserDefaultProfile() read ran outside this
        // transaction; settle the default here so a profile created in that
        // window (e.g. the welcome modal) keeps it (MUT-88, ADR-072).
        await enforceSingleDefaultProfile(db.businessProfiles);
        await db.clients.bulkPut(rows.clients);
        await db.projects.bulkPut(rows.projects);
        await db.categories.bulkPut(rows.categories);
        await db.expenseCategories.bulkPut(rows.expenseCategories);
        await db.retainerAgreements.bulkPut(rows.retainers);
        await db.projectedIncome.bulkPut(rows.projectedIncome);
        await db.transactions.bulkPut(rows.transactions);
        await db.recurringRules.bulkPut(rows.recurringRules);
        await db.expenses.bulkPut(rows.expenses);
      }
    );

    return reconcileFeaturesAfterDataLoad('demo', db);
  },

  /**
   * Any client, project, entry, expense or document that isn't part of the
   * sample. An empty business profile (e.g. from "Skip for now") doesn't count.
   */
  async hasOwnData(): Promise<boolean> {
    for (const table of ownDataTables()) {
      if (await table.filter((row) => !isSampleRow(row)).first()) return true;
    }
    return false;
  },

  /** Sample income still unpaid (picks the sample business to open on). */
  async listUnpaidSampleIncome(): Promise<Transaction[]> {
    return db.transactions
      .where('id')
      .startsWith(DEMO_PREFIXES.transaction)
      .filter((tx) => tx.kind === 'income' && tx.status === 'unpaid' && !tx.deletedAt)
      .toArray();
  },

  /** Rows the visitor added since `startedAt` (not sample rows, not older rows). */
  async countSessionAdditions(startedAt: string): Promise<number> {
    const added = addedSince(startedAt);
    const counts = await Promise.all(sessionTables().map((table) => table.filter(added).count()));
    return counts.reduce((sum, n) => sum + n, 0);
  },

  /** Delete the rows the visitor added since `startedAt`, in one transaction. */
  async removeSessionAdditions(startedAt: string): Promise<void> {
    const added = addedSince(startedAt);
    await db.transaction('rw', sessionTables(), async () => {
      for (const table of sessionTables()) {
        await table.filter(added).delete();
      }
    });
  },
};
