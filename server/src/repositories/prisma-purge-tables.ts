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
  // MUT-643: refunds and their sources are ledger rows, purged with the profile (sources before refunds).
  'refund_sources',
  'refunds',
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
  // MUT-478
  'receivable_counters',
  // MUT-559: accountants' access to the deleted profile (also ON DELETE CASCADE).
  'accountant_grants',
  // MUT-560: share links to the deleted profile (their viewers cascade; also ON DELETE CASCADE).
  'share_links',
  // MUT-594: the firm's Malafat seats (also ON DELETE CASCADE).
  'external_identities',
  // MUT-646: where the invoicing setup stood (the details and logos it points at are kept, below).
  'issuing_setup',
  // MUT-647: invoices issued elsewhere (their files are the profile's attachments, deleted with it).
  'external_invoices',
  // MUT-571: the profile's Tax Authority tokens go with it (nothing issued depends on them).
  'tax_authority_connections',
  // MUT-735 (ADR-281): the deleted profile's usage events (the person's own, on any profile, go by subjectKey too).
  'usage_events',
  // MUT-782 (ADR-341): the profile's chosen VAT period and each announced period's state.
  'vat_period_records',
  'vat_period_settings',
] as const;

/** Tables with an "organizationId" column the profile delete deliberately leaves to the database or keeps. */
export const PURGE_PROFILE_TABLES_EXEMPT: Readonly<Record<string, string>> = {
  billing_subscriptions: 'SET NULL: a subscription is its payer’s; the closing person’s own are deleted with their billing account',
  storage_purges: 'the queue of deleted profiles whose bucket prefix still has to be emptied (R1)',
  // MUT-568 (ADR-260, Basel 2026-11-22): issued documents and the details printed on them outlive the account; no
  // foreign keys hold them, a trigger refuses their deletion, and MUT-644's sweep removes each document 7 years after
  // its own date, the profile's own rows with the last (ADR-277 as amended 2026-11-25).
  issuer_details: 'kept 7 years, until its last document goes: the business details printed on its issued documents (MUT-644)',
  issued_document_counters: 'kept 7 years, until its last document goes: numbering of the retained documents (MUT-644)',
  issued_documents: 'kept 7 years from each document\'s date: legal records, INSERT-only (MUT-644)',
  issued_document_lines: 'kept 7 years from each document\'s date: legal records, INSERT-only (MUT-644)',
  issued_document_copies: 'kept 7 years from each document\'s date: legal records, INSERT-only (MUT-644)',
  issued_document_cancellations: 'kept 7 years from each document\'s date: a payment request\'s cancellation, INSERT-only (MUT-662, MUT-644)',
  issued_cancellation_counters: 'kept 7 years, until its last document goes: numbering of the retained cancellations (MUT-662, MUT-644)',
  issuer_logos: 'kept 7 years, until its last document goes: the logo each retained document prints (MUT-646, MUT-644)',
  issued_document_originals: 'kept 7 years from each document\'s date: each retained document\'s signed original, INSERT-only (MUT-641, MUT-644)',

  // MUT-644 (ADR-277 D5): the sweep's own log; it outlives the rows it records.
  issuing_retention_events: 'the retention log of closed profiles\' issued documents: sweeps and exported archives (MUT-644)',
};

/**
 * MUT-644 (ADR-277 D4, amended 2026-11-25): what the retention sweep deletes one document at a time, 7 years after its
 * own date, each with the column naming the document: the document itself, its lines, copies, kept original and
 * cancellation.
 */
export const RETAINED_ISSUING_DOCUMENT_TABLES = [
  ['issued_document_lines', 'documentId'],
  ['issued_document_copies', 'documentId'],
  ['issued_document_originals', 'documentId'],
  ['issued_document_cancellations', 'documentId'],
  ['issued_documents', 'id'],
] as const;

/** The profile's own retained rows, deleted with its last document (or by an erasure, D7). */
export const RETAINED_ISSUING_PROFILE_TABLES = ['issuer_details', 'issued_document_counters', 'issued_cancellation_counters', 'issuer_logos'] as const;

/** Every retained issuing table: exactly the "kept 7 years" exemptions above (a unit test pins it). */
export const RETAINED_ISSUING_TABLES = [...RETAINED_ISSUING_DOCUMENT_TABLES.map(([table]) => table), ...RETAINED_ISSUING_PROFILE_TABLES] as const;

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
  // MUT-532: the person's pauses, stay offer, cancels and switches (also ON DELETE CASCADE).
  'billing_retention_events.userId': 'delete',
  // MUT-734: the person's plan changes (also ON DELETE CASCADE).
  'billing_plan_changes.userId': 'delete',
  'inbox_entries.userId': 'delete',
  'memberships.userId': 'delete',
  'passkeys.userId': 'delete',
  'sessions.userId': 'delete',
  'signup_reviews.userId': 'delete',
  'terms_acceptances.userId': 'delete',
  'user_feature_grants.userId': 'delete',
  // MUT-434: the person's agent grants (their codes and tokens cascade) and the consent requests they decided.
  'oauth_grants.userId': 'delete',
  'oauth_authorization_requests.userId': 'delete',
  // MUT-594/595: the person's links to Malafat; the firm's next member sync adds them back as pending seats.
  'external_identities.userId': 'delete',
  // MUT-595: the person's Sign in with Malafat attempts (also ON DELETE CASCADE).
  'malafat_sign_ins.userId': 'delete',
  // MUT-618: the person's emailed sign-in codes (also ON DELETE CASCADE).
  'sign_in_codes.userId': 'delete',
  // MUT-710: the person's two-step sign-in, recovery codes and pending challenges (also ON DELETE CASCADE).
  'two_factor.userId': 'delete',
  'two_factor_recovery_codes.userId': 'delete',
  'two_factor_challenges.userId': 'delete',
  'user_idempotency_keys.userId': 'delete',
  'webauthn_challenges.userId': 'delete',
  // MUT-559: the person's grants as an accountant go with them; invites they sent as an owner lose their name.
  'accountant_grants.accountantUserId': 'delete',
  'accountant_grants.invitedByUserId': 'anonymize',
  // MUT-560: links the person created on profiles that survive stay, revocable by the remaining owners.
  'share_links.createdByUserId': 'anonymize',
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
export const PURGE_UNKEYED_USER_COLUMNS = ['receivables.createdByUserId', 'usage_events.actorUserId'] as const;
