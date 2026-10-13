// ============================================================================
// CSV import (Settings → Import), part of the Dexie `dataset` implementation
// ============================================================================
//
// Moved from ImportDataPage and utils/csvImport in MUT-47 so the page reaches
// storage only through getRepositories(). The writes are unchanged: clients
// and projects are matched by name across every business (TODOS #12),
// conversion rows carry no profileId, and income/expense amounts still assume
// base-100 (TD-112).

import { db } from './database';
import { businessProfileRepo, paymentRecordRepo } from './repository';
import { expenseRepo, expenseCategoryRepo } from './expenseRepository';
import { parseAmountToMinor } from '../lib/utils';
import type { Currency } from '../types';

export type CsvImportRow = Record<string, string>;

export interface CsvImportOptions {
  /** The business every created row is filed under; null creates a default one. */
  selectedProfileId: string | null;
  /** Names the auto-created default business. */
  language: 'en' | 'ar';
}

export interface ImportRowRefs {
  profileId: string;
  clientNameToId: Map<string, string>;
  projectNameToId: Map<string, string>;
}

/**
 * Resolves a CSV expense row's category against the profile-scoped
 * db.expenseCategories table (not the legacy global db.categories table),
 * creating it if it doesn't exist yet for this profile.
 */
async function resolveExpenseCategoryId(
  categoryName: string | undefined,
  profileId: string
): Promise<string | undefined> {
  const name = categoryName?.trim();
  if (!name) return undefined;

  const existing = (await expenseCategoryRepo.list(profileId)).find((c) => c.name === name);
  if (existing) return existing.id;

  const created = await expenseCategoryRepo.create({ profileId, name });
  return created.id;
}

/**
 * Imports one CSV expense row into db.expenses via expenseRepo, replacing the
 * old behavior of writing a kind:'expense' row into db.transactions (MUT-138).
 * Returns whether a row was created (false for a row missing a required field).
 */
export async function importExpenseRow(
  row: CsvImportRow,
  refs: ImportRowRefs
): Promise<boolean> {
  if (!row.amount || !row.currency || !row.date) return false;

  const clientId = row.client ? refs.clientNameToId.get(row.client) : undefined;
  const projectId = row.project ? refs.projectNameToId.get(row.project) : undefined;
  const amountMinor = Math.round(parseFloat(row.amount) * 100);
  const categoryId = await resolveExpenseCategoryId(row.category, refs.profileId);

  await expenseRepo.create({
    profileId: refs.profileId,
    title: row.name || 'Expense',
    clientId,
    projectId,
    categoryId,
    amountMinor,
    currency: row.currency as Currency,
    occurredAt: row.date,
    notes: row.notes || undefined,
  });
  return true;
}

/**
 * Default-profile shape mirrors WelcomeModal's "Skip" action (the app's one
 * existing precedent for synthesizing a profile when none exists) so an
 * import never invents an unrelated business identity.
 */
const DEFAULT_PROFILE_NAME: Record<'en' | 'ar', string> = {
  en: 'Default Profile',
  ar: 'ملف تعريف افتراضي',
};

/**
 * Resolves the profileId that every entity created by one CSV import run
 * should share. Returns the already-selected profile when one exists; only
 * auto-creates a default profile in the (UI-gated, effectively unreachable
 * post-onboarding) zero-profile case, since expenses require a profileId.
 */
export async function resolveImportProfileId(
  selectedProfileId: string | null,
  language: 'en' | 'ar'
): Promise<string> {
  if (selectedProfileId) return selectedProfileId;

  const profile = await businessProfileRepo.create({
    name: DEFAULT_PROFILE_NAME[language] ?? DEFAULT_PROFILE_NAME.en,
    defaultCurrency: 'USD',
    isDefault: true,
  });
  return profile.id;
}

/**
 * Imports the selected CSV rows: clients, then projects, income, expenses and
 * conversions, so later rows can reference earlier ones by name. Returns the
 * number of money rows created (income + expense + conversion).
 */
export async function importCsvRows(
  rows: CsvImportRow[],
  options: CsvImportOptions
): Promise<{ transactions: number }> {
  let transactions = 0;

  // One profile for every entity this CSV import creates: the page's profile
  // selector already requires a choice when any profile exists, so this only
  // auto-creates a default profile in the zero-profile case.
  const profileId = await resolveImportProfileId(options.selectedProfileId, options.language);

  const clientNameToId = new Map<string, string>();
  const projectNameToId = new Map<string, string>();

  const clientRows = rows.filter(r => r.type === 'client');
  const projectRows = rows.filter(r => r.type === 'project');
  const incomeRows = rows.filter(r => r.type === 'income');
  const expenseRows = rows.filter(r => r.type === 'expense');
  const conversionRows = rows.filter(r => r.type === 'conversion');

  for (const row of clientRows) {
    if (!row.name) continue;

    const existing = await db.clients.where('name').equals(row.name).first();

    if (existing) {
      clientNameToId.set(row.name, existing.id);
    } else {
      const clientId = crypto.randomUUID();
      await db.clients.add({
        id: clientId,
        name: row.name,
        email: row.email || undefined,
        phone: row.phone || undefined,
        notes: row.notes || undefined,
        profileId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      clientNameToId.set(row.name, clientId);
    }
  }

  for (const row of projectRows) {
    if (!row.name) continue;

    const clientId = row.client ? clientNameToId.get(row.client) : undefined;

    const existing = await db.projects.where('name').equals(row.name).first();

    if (existing) {
      projectNameToId.set(row.name, existing.id);
    } else {
      const projectId = crypto.randomUUID();
      await db.projects.add({
        id: projectId,
        name: row.name,
        clientId,
        field: row.field || undefined,
        notes: row.notes || undefined,
        profileId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      projectNameToId.set(row.name, projectId);
    }
  }

  for (const row of incomeRows) {
    if (!row.amount || !row.currency || !row.date) continue;

    const clientId = row.client ? clientNameToId.get(row.client) : undefined;
    const projectId = row.project ? projectNameToId.get(row.project) : undefined;

    const amountMinor = Math.round(parseFloat(row.amount) * 100);
    const status = row.status === 'paid' ? 'paid' : 'unpaid';
    const paidAt = row.paidAt || row.date;
    const id = crypto.randomUUID();

    await db.transactions.add({
      id,
      kind: 'income',
      status,
      title: row.name || 'Income',
      clientId,
      projectId,
      amountMinor,
      currency: row.currency as 'USD' | 'ILS' | 'EUR',
      occurredAt: row.date,
      dueDate: row.dueDate || undefined,
      paidAt: status === 'paid' ? paidAt : undefined,
      notes: row.notes || undefined,
      profileId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    // MUT-60 (TD-029, found in eng review): this loop bypasses transactionRepo
    // entirely, so a paid row needs its own PaymentRecord -- otherwise it has
    // the same record-less "paid" gap a fast-added Received entry used to.
    if (status === 'paid') {
      await paymentRecordRepo.create({ transactionId: id, amountMinor, paidAt });
    }
    transactions++;
  }

  // Import expenses into db.expenses (MUT-138 — previously written as
  // kind:'expense' transactions, invisible on /expenses since MUT-14)
  for (const row of expenseRows) {
    const created = await importExpenseRow(row, { profileId, clientNameToId, projectNameToId });
    if (created) transactions++;
  }

  // MUT-141: conversions always use currency-aware parsing (parseAmountToMinor)
  // for both legs -- unlike the income/expense loops above, which predate
  // MUT-140's per-currency-exponent work and still assume base-100 (TD-112).
  for (const row of conversionRows) {
    if (!row.amount || !row.currency || !row.toAmount || !row.toCurrency || !row.date) continue;
    if (row.currency === row.toCurrency) continue;

    const currency = row.currency as Currency;
    const toCurrency = row.toCurrency as Currency;

    await db.transactions.add({
      id: crypto.randomUUID(),
      kind: 'conversion',
      status: 'paid',
      amountMinor: parseAmountToMinor(row.amount, currency),
      currency,
      toAmountMinor: parseAmountToMinor(row.toAmount, toCurrency),
      toCurrency,
      occurredAt: row.date,
      notes: row.notes || undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    transactions++;
  }

  return { transactions };
}
