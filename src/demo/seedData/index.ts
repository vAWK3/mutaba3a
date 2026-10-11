/**
 * Demo Seed Data Orchestrator
 *
 * Main entry point for seeding demo data. Coordinates all entity generators
 * and handles database transactions.
 */

import { db } from '../../db/database';
import { reconcileFeaturesAfterDataLoad } from '../../lib/features/features';
import { settingsRepo } from '../../db/repository';
import type { FeatureKey } from '../../types';
import type { DemoDataStats } from '../types';
import { DEMO_ID_PREFIX } from '../constants';

// Import generators
import { createDemoProfiles, getDemoProfileIds } from './profile';
import { createDemoClients } from './clients';
import { createDemoProjects } from './projects';
import { createDemoCategories, createDemoExpenseCategories } from './categories';
import { createDemoRetainers } from './retainers';
import { createDemoProjectedIncome } from './projectedIncome';
import { createDemoTransactions } from './transactions';
import { createDemoDocuments, createDemoDocumentSequences } from './documents';
import { createDemoExpenses, createDemoRecurringRules } from './expenses';

/**
 * Check if any demo data exists in the database
 */
export async function hasDemoData(): Promise<boolean> {
  // Check a few tables for demo prefixed IDs
  const [client, transaction, document] = await Promise.all([
    db.clients.where('id').startsWith(DEMO_ID_PREFIX).first(),
    db.transactions.where('id').startsWith(DEMO_ID_PREFIX).first(),
    db.documents.where('id').startsWith(DEMO_ID_PREFIX).first(),
  ]);

  return !!(client || transaction || document);
}

/**
 * Remove all demo data from the database
 * Only removes records with IDs starting with 'demo_'
 */
export async function removeDemoData(): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.clients,
      db.projects,
      db.categories,
      db.transactions,
      db.businessProfiles,
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
}

export interface SeedDemoOptions {
  /**
   * Show the "Switched on for your existing data" notice for the areas the
   * sample switches on. True for the internal demo; false for a visitor, for
   * whom it isn't their data (MUT-78).
   */
  announceFeatures?: boolean;
}

/** Drop `keys` from the pending auto-enable notice, keeping any others. */
async function withdrawFeatureNotice(keys: FeatureKey[]): Promise<void> {
  const settings = await settingsRepo.get();
  const remaining = (settings.featureNotice ?? []).filter((key) => !keys.includes(key));
  await settingsRepo.update({ featureNotice: remaining.length > 0 ? remaining : undefined });
}

/**
 * Seed the database with demo data
 * Idempotent - removes existing demo data first
 */
export async function seedDemoData({ announceFeatures = true }: SeedDemoOptions = {}): Promise<DemoDataStats> {
  // First, remove any existing demo data for idempotency
  await removeDemoData();

  // Never add a second default next to one the person already has.
  const existingDefault = !!(await db.businessProfiles
    .filter((p) => !!p.isDefault && !p.archivedAt && !p.id.startsWith(DEMO_ID_PREFIX))
    .first());

  // Generate all demo data (order matters for dependencies)
  const profiles = createDemoProfiles({ existingDefault });
  const clients = createDemoClients();
  const projects = createDemoProjects();
  const categories = createDemoCategories();
  const expenseCategories = createDemoExpenseCategories();
  const retainers = createDemoRetainers();
  const projectedIncome = createDemoProjectedIncome();
  const transactions = createDemoTransactions();
  const documents = createDemoDocuments();
  const documentSequences = createDemoDocumentSequences();
  const recurringRules = createDemoRecurringRules();
  const expenses = createDemoExpenses();

  // Insert all data in a transaction
  await db.transaction(
    'rw',
    [
      db.clients,
      db.projects,
      db.categories,
      db.transactions,
      db.businessProfiles,
      db.documents,
      db.documentSequences,
      db.retainerAgreements,
      db.projectedIncome,
      db.expenses,
      db.expenseCategories,
      db.recurringRules,
    ],
    async () => {
      // Insert in dependency order
      await db.businessProfiles.bulkPut(profiles);
      await db.clients.bulkPut(clients);
      await db.projects.bulkPut(projects);
      await db.categories.bulkPut(categories);
      await db.expenseCategories.bulkPut(expenseCategories);
      await db.retainerAgreements.bulkPut(retainers);
      await db.projectedIncome.bulkPut(projectedIncome);
      await db.transactions.bulkPut(transactions);
      await db.documents.bulkPut(documents);
      await db.documentSequences.bulkPut(documentSequences);
      await db.recurringRules.bulkPut(recurringRules);
      await db.expenses.bulkPut(expenses);
    }
  );

  // The demo exercises invoices, retainers, expenses and projects: switch
  // those areas on so a fresh install does not show a mostly empty app (MUT-12).
  const featuresEnabled = await reconcileFeaturesAfterDataLoad('demo', db);
  if (!announceFeatures && featuresEnabled.length > 0) {
    await withdrawFeatureNotice(featuresEnabled);
  }

  console.log(`Demo data seeded successfully: ${profiles.length} profiles, ${clients.length} clients, ${projects.length} projects, ${transactions.length} transactions`);

  return {
    businessProfiles: profiles.length,
    clients: clients.length,
    projects: projects.length,
    transactions: transactions.length,
    documents: documents.length,
    retainers: retainers.length,
    projectedIncome: projectedIncome.length,
    expenses: expenses.length,
    expenseCategories: expenseCategories.length,
    recurringRules: recurringRules.length,
    featuresEnabled,
  };
}

// Re-export utilities
export { getDemoProfileIds };
