/**
 * MUT-333 (ADR-188): every table the hard delete of a closed account knows, by name. A test:db reads the catalog
 * (`prisma-account-purge-catalog.test.ts`) and fails when a table with an "organizationId" column, or any foreign key
 * to users, is missing here: a new table can't be left behind by a purge nobody updated.
 */

/** Profile tables, children before parents: everything in a deleted profile goes, in this order (then the profile). */
export const PURGE_PROFILE_TABLES = [
  'agreement_supplements',
  'retainer_charges',
  'retainer_versions',
  'installments',
  'expense_group_overrides',
  'expense_receipts',
  'agreements',
  'payment_allocations',
  'payments',
  'expenses',
  'projects',
  'receivable_credits',
  'vendor_names',
  'api_keys',
  'integrations',
  'audit_events',
  'idempotency_keys',
  'external_references',
  'customers',
  'vat_rates',
  'receivables',
  'attachments',
  'vendors',
  'expense_categories',
  'memberships',
  'fee_proposals',
  'conversions',
  'expense_groups',
  'entitlement_grants',
  'payment_counters',
] as const;

/** Tables with an "organizationId" column the profile delete deliberately leaves to the database or keeps. */
export const PURGE_PROFILE_TABLES_EXEMPT: Readonly<Record<string, string>> = {
  billing_subscriptions: 'SET NULL: a subscription is its payer’s; the closing person’s own are deleted with their billing account',
  storage_purges: 'the queue of deleted profiles whose bucket prefix still has to be emptied (R1)',
};

/**
 * What the purge does with every column that points at users (`table.column`):
 *   delete    — the person's own row goes;
 *   anonymize — on profiles that survive, the column is set to null (D7);
 *   owner     — the profile they created: transferred (D6) or deleted with its rows.
 */
export const PURGE_USER_COLUMNS: Readonly<Record<string, 'delete' | 'anonymize' | 'owner'>> = {
  'account_setup_tokens.userId': 'delete',
  'billing_accounts.userId': 'delete',
  'entitlement_grants.userId': 'delete',
  'inbox_entries.userId': 'delete',
  'memberships.userId': 'delete',
  'sessions.userId': 'delete',
  'signup_reviews.userId': 'delete',
  'terms_acceptances.userId': 'delete',
  'user_idempotency_keys.userId': 'delete',
  'conversions.createdByUserId': 'anonymize',
  'expense_groups.createdByUserId': 'anonymize',
  'expense_receipts.approvedByUserId': 'anonymize',
  'expense_receipts.uploadedByUserId': 'anonymize',
  'expenses.createdByUserId': 'anonymize',
  'organizations.firmRequestedByUserId': 'anonymize',
  'payments.createdByUserId': 'anonymize',
  'organizations.ownerUserId': 'owner',
  'organizations.personalOwnerUserId': 'owner',
};

/** Columns that name a person with no foreign key (R14): anonymized the same way. */
export const PURGE_UNKEYED_USER_COLUMNS = ['receivables.createdByUserId'] as const;
