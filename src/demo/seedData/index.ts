/**
 * Demo Seed Data Orchestrator
 *
 * Main entry point for seeding demo data. Coordinates all entity generators;
 * the database side lives behind getRepositories().base.demoData (MUT-47).
 */

import { getRepositories } from '../../db';
import type { FeatureKey } from '../../types';
import type { DemoDataStats } from '../types';

// Import generators
import { createDemoProfiles, getDemoProfileIds } from './profile';
import { createDemoClients } from './clients';
import { createDemoProjects } from './projects';
import { createDemoCategories, createDemoExpenseCategories } from './categories';
import { createDemoRetainers } from './retainers';
import { createDemoProjectedIncome } from './projectedIncome';
import { createDemoTransactions } from './transactions';
import { createDemoExpenses, createDemoRecurringRules } from './expenses';

/**
 * Check if any demo data exists in the database
 */
export function hasDemoData(): Promise<boolean> {
  return getRepositories().base.demoData.hasDemoData();
}

/**
 * Remove all demo data from the database
 * Only removes records with IDs starting with 'demo_'
 */
export function removeDemoData(): Promise<void> {
  return getRepositories().base.demoData.removeDemoData();
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
  const { settings: settingsRepo } = getRepositories().base;
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
  const existingDefault = await getRepositories().base.demoData.hasUserDefaultProfile();

  // Generate all demo data (order matters for dependencies)
  const profiles = createDemoProfiles({ existingDefault });
  const clients = createDemoClients();
  const projects = createDemoProjects();
  const categories = createDemoCategories();
  const expenseCategories = createDemoExpenseCategories();
  const retainers = createDemoRetainers();
  const projectedIncome = createDemoProjectedIncome();
  const transactions = createDemoTransactions();
  const recurringRules = createDemoRecurringRules();
  const expenses = createDemoExpenses();

  // Insert all data in a transaction, then switch on the areas the demo
  // exercises (retainers, expenses, projects) so a fresh install does not show
  // a mostly empty app (MUT-12). The existingDefault read above ran outside
  // this transaction; demoData.seed settles the default inside it, so a
  // profile created meanwhile keeps it (MUT-88, ADR-072).
  const featuresEnabled = await getRepositories().base.demoData.seed({
    businessProfiles: profiles,
    clients,
    projects,
    categories,
    expenseCategories,
    retainers,
    projectedIncome,
    transactions,
    recurringRules,
    expenses,
  });
  if (!announceFeatures && featuresEnabled.length > 0) {
    await withdrawFeatureNotice(featuresEnabled);
  }

  console.log(`Demo data seeded successfully: ${profiles.length} profiles, ${clients.length} clients, ${projects.length} projects, ${transactions.length} transactions`);

  return {
    businessProfiles: profiles.length,
    clients: clients.length,
    projects: projects.length,
    transactions: transactions.length,
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
