import { db } from '../db/database';
import { expenseRepo, expenseCategoryRepo } from '../db/expenseRepository';
import type { BusinessProfile, Currency } from '../types';

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
  row: Record<string, string>,
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

  const now = new Date().toISOString();
  const profile: BusinessProfile = {
    id: crypto.randomUUID(),
    name: DEFAULT_PROFILE_NAME[language] ?? DEFAULT_PROFILE_NAME.en,
    email: '',
    businessType: 'none',
    defaultCurrency: 'USD',
    defaultLanguage: language,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };
  await db.businessProfiles.add(profile);
  return profile.id;
}
