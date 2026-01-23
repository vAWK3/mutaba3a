/**
 * Demo Seed Data Orchestrator
 *
 * Main entry point for seeding demo data. Coordinates all entity generators
 * and handles database transactions.
 */

import { db } from '../../db/database';
import type { DemoDataStats } from '../types';
import { DEMO_ID_PREFIX } from '../constants';

// Import generators
import { createDemoProfile, getDemoProfileId } from './profile';
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

/**
 * Seed the database with demo data
 * Idempotent - removes existing demo data first
 */
export async function seedDemoData(): Promise<DemoDataStats> {
  // First, remove any existing demo data for idempotency
  await removeDemoData();

  // Generate all demo data
  const profile = createDemoProfile();
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
      await db.businessProfiles.put(profile);
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

  console.log('Demo data seeded successfully');

  return {
    businessProfiles: 1,
    clients: clients.length,
    projects: projects.length,
    transactions: transactions.length,
    documents: documents.length,
    retainers: retainers.length,
    projectedIncome: projectedIncome.length,
    expenses: expenses.length,
    expenseCategories: expenseCategories.length,
    recurringRules: recurringRules.length,
  };
}

// Re-export utilities
export { getDemoProfileId };
