/**
 * Repository Provider
 *
 * The single place the app resolves its data access from. Every query hook and
 * service calls `getRepositories()` instead of importing a repository
 * singleton, so a different implementation (a hosted HTTP source, a SQLite
 * source under Tauri) can be swapped in without touching call sites.
 *
 * Two families, deliberately kept separate:
 *
 *   base    the Dexie repositories (repository.ts, expenseRepository.ts,
 *           retainerRepository.ts). Plain reads and writes.
 *   synced  the decorators in sync/core/synced-repository.ts that wrap a base
 *           repository and additionally capture an operation in the sync
 *           op-log. Only some call sites use these — see the caveat below.
 *
 * WHY BOTH ARE EXPOSED: today's call graph is uneven. `useQueries` and
 * `useIncomeQueries` write transactions through `base` for create / update /
 * archive / unarchive / softDelete, and through `synced` only for markPaid and
 * recordPartialPayment. That asymmetry means most transaction mutations never
 * enter the op-log and therefore never sync between devices. It is pre-existing
 * and intentionally preserved here; see TODOS.md item 1. Modelling both
 * families makes each call site state which one it uses instead of hiding it.
 *
 * CAVEAT — the synced family does not follow `setRepositories`:
 * gstack-shortcut(dec-5f2c2123): the decorators in synced-repository.ts bind
 * the Dexie singletons at module load (`clientRepo.list.bind(clientRepo)`), so
 * swapping `base` here does NOT redirect any `synced.*` call. Upgrade when
 * MUT-43 injects a hosted data source — resolve the decorators lazily through
 * `getRepositories().base` then, with a test asserting ops are captured against
 * a swapped base.
 *
 * @see .claude/TECH_DEBT.md TD-013
 */

import type { IRepositoryProvider, ISyncedRepositories } from './interfaces';

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
  documentSequenceRepo,
  documentRepo,
  paymentRecordRepo,
} from './repository';
import {
  expenseRepo,
  expenseCategoryRepo,
  receiptRepo,
  vendorRepo,
  monthCloseRepo,
  recurringRuleRepo,
  recurringOccurrenceRepo,
} from './expenseRepository';
import { retainerRepo, projectedIncomeRepo } from './retainerRepository';

import {
  syncedClientRepo,
  syncedProjectRepo,
  syncedTransactionRepo,
  syncedCategoryRepo,
  syncedFxRateRepo,
  syncedBusinessProfileRepo,
  syncedDocumentRepo,
  syncedPaymentRecordRepo,
} from '../sync/core/synced-repository';

/**
 * Everything the app can reach. `satisfies` on each half is the conformance
 * check: delete or rename a method on any repository below and `npm run
 * typecheck` fails here.
 */
export interface Repositories {
  base: IRepositoryProvider;
  synced: ISyncedRepositories;
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
  documentSequences: documentSequenceRepo,
  documents: documentRepo,
  paymentRecords: paymentRecordRepo,
  expenses: expenseRepo,
  expenseCategories: expenseCategoryRepo,
  receipts: receiptRepo,
  vendors: vendorRepo,
  monthCloseStatuses: monthCloseRepo,
  recurringRules: recurringRuleRepo,
  recurringOccurrences: recurringOccurrenceRepo,
  retainerAgreements: retainerRepo,
  projectedIncome: projectedIncomeRepo,
} satisfies IRepositoryProvider;

const dexieSynced = {
  clients: syncedClientRepo,
  projects: syncedProjectRepo,
  transactions: syncedTransactionRepo,
  categories: syncedCategoryRepo,
  fxRates: syncedFxRateRepo,
  businessProfiles: syncedBusinessProfileRepo,
  documents: syncedDocumentRepo,
  paymentRecords: syncedPaymentRecordRepo,
} satisfies ISyncedRepositories;

/**
 * The default registry. Frozen and module-scoped on purpose: Dexie migrations
 * run inside `db.open()` before React mounts, so resolution must not depend on
 * a mounted component tree.
 */
const dexieRepositories: Repositories = Object.freeze({
  base: dexieBase,
  synced: dexieSynced,
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
