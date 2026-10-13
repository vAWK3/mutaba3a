/**
 * Repository Provider
 *
 * The single place the app resolves its data access from. Every query hook and
 * service calls `getRepositories()` instead of importing a repository
 * singleton, so a different implementation (a hosted HTTP source, a SQLite
 * source under Tauri) can be swapped in without touching call sites.
 *
 * One family, `base`: the Dexie repositories (repository.ts,
 * expenseRepository.ts, retainerRepository.ts, planRepository.ts, dataset.ts). Until MUT-73 a second family,
 * `synced`, wrapped some of them to capture device-sync operations; device sync
 * is retired (ADR-053), so every call site uses `base`. The `{ base }` wrapper
 * is kept so the 160-odd existing call sites and test overrides stay as they are.
 *
 * @see .claude/TECH_DEBT.md TD-013
 */

import type { IRepositoryProvider } from './interfaces';

import {
  clientRepo,
  projectRepo,
  categoryRepo,
  transactionRepo,
  projectSummaryRepo,
  clientSummaryRepo,
  fxRateRepo,
  settingsRepo,
  businessProfileRepo,
  paymentRecordRepo,
} from './repository';
import {
  expenseRepo,
  expenseCategoryRepo,
  receiptRepo,
  vendorRepo,
  recurringRuleRepo,
  recurringOccurrenceRepo,
} from './expenseRepository';
import { retainerRepo, projectedIncomeRepo } from './retainerRepository';
import { planRepo, planAssumptionRepo, planScenarioRepo } from './planRepository';
import { datasetRepo } from './dataset';

/**
 * Everything the app can reach. `satisfies` is the conformance check: delete or
 * rename a method on any repository below and `npm run typecheck` fails here.
 */
export interface Repositories {
  base: IRepositoryProvider;
}

const dexieBase = {
  clients: clientRepo,
  projects: projectRepo,
  categories: categoryRepo,
  transactions: transactionRepo,
  projectSummaries: projectSummaryRepo,
  clientSummaries: clientSummaryRepo,
  fxRates: fxRateRepo,
  settings: settingsRepo,
  businessProfiles: businessProfileRepo,
  paymentRecords: paymentRecordRepo,
  expenses: expenseRepo,
  expenseCategories: expenseCategoryRepo,
  receipts: receiptRepo,
  vendors: vendorRepo,
  recurringRules: recurringRuleRepo,
  recurringOccurrences: recurringOccurrenceRepo,
  retainerAgreements: retainerRepo,
  projectedIncome: projectedIncomeRepo,
  plans: planRepo,
  planAssumptions: planAssumptionRepo,
  planScenarios: planScenarioRepo,
  dataset: datasetRepo,
} satisfies IRepositoryProvider;

/**
 * The default registry. Frozen and module-scoped on purpose: Dexie migrations
 * run inside `db.open()` before React mounts, so resolution must not depend on
 * a mounted component tree.
 */
const dexieRepositories: Repositories = Object.freeze({
  base: dexieBase,
});

let active: Repositories = dexieRepositories;

/**
 * Resolve the active repositories. Returns a stable reference: callers use it
 * in query keys and `useMemo` dependencies, so a fresh object per call would
 * churn renders.
 */
export function getRepositories(): Repositories {
  return active;
}

/**
 * Replace the active repositories. Intended for tests and for future
 * bootstrapping of a non-Dexie source; not a runtime feature switch.
 */
export function setRepositories(next: Repositories): void {
  if (import.meta.env.PROD) {
    throw new Error(
      'setRepositories() is not available in production builds. The data source is fixed at startup.'
    );
  }
  active = next;
}

/** Restore the Dexie default. Call in test teardown. */
export function resetRepositories(): void {
  active = dexieRepositories;
}
