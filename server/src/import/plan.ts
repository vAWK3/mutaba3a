import { isSupportedCurrency } from '../money.js';
import type { EntityStatus } from '../repositories/ports.js';

/**
 * The one place that decides what an import batch means (brief §2.3).
 * Pure: takes the rows and a snapshot of the organization's current links,
 * returns a per-row plan. `POST /v1/import/preview` returns the plan;
 * `POST /v1/import/commit` executes it. Both call this, so preview and commit
 * can never disagree about a row.
 */
export const IMPORT_MAX_ROWS = 500;

export interface CustomerRow {
  entityType: 'CUSTOMER';
  externalId: string;
  name: string;
  email?: string | undefined;
  phone?: string | undefined;
}

export interface ProjectRow {
  entityType: 'PROJECT';
  externalId: string;
  name: string;
  currency: string;
  customerExternalId: string;
}

export type ImportRow = CustomerRow | ProjectRow;

export interface KnownCustomer {
  id: string;
  name: string;
  status: EntityStatus;
}

export interface KnownProject {
  id: string;
  name: string;
  customerId: string;
  currency: string;
  status: EntityStatus;
}

/** Current links for the provider, keyed by external id. */
export interface ImportState {
  customersByExternalId: Map<string, KnownCustomer>;
  projectsByExternalId: Map<string, KnownProject>;
}

export type PlanAction = 'create' | 'link' | 'conflict';
export type ConflictReason = 'UNKNOWN_CUSTOMER' | 'CUSTOMER_MISMATCH' | 'CURRENCY_DIFFERS' | 'VALIDATION';
export type ValidationDetail = 'EMPTY_NAME' | 'NAME_TOO_LONG' | 'UNSUPPORTED_CURRENCY' | 'DUPLICATE_IN_BATCH';
export type PlanWarning = 'NAME_DIFFERS' | 'ARCHIVED';

/** Which customer a project row resolves to: one that exists, or one this batch creates. */
export type ResolvedCustomer = { kind: 'existing'; id: string } | { kind: 'batch'; externalId: string };

export interface PlanRow {
  index: number;
  entityType: ImportRow['entityType'];
  externalId: string;
  action: PlanAction;
  existingId?: string;
  reason?: ConflictReason;
  detail?: ValidationDetail;
  warnings: PlanWarning[];
  /** Project rows only. */
  customer?: ResolvedCustomer;
}

export const MAX_NAME_LENGTH = 200;

export function planImport(rows: readonly ImportRow[], state: ImportState): PlanRow[] {
  if (rows.length > IMPORT_MAX_ROWS) throw new Error(`import batches are limited to ${IMPORT_MAX_ROWS} rows`);

  const seen = new Set<string>();
  const batchCustomers = new Map<string, PlanRow>();
  const plan: PlanRow[] = [];

  // Customers first so project rows can resolve against them, in input order.
  rows.forEach((row, index) => {
    if (row.entityType !== 'CUSTOMER') return;
    const planned = planCustomer(row, index, state, seen);
    // First occurrence wins; a duplicate is already a VALIDATION conflict.
    if (!batchCustomers.has(row.externalId)) batchCustomers.set(row.externalId, planned);
    plan.push(planned);
  });
  rows.forEach((row, index) => {
    if (row.entityType !== 'PROJECT') return;
    plan.push(planProject(row, index, state, seen, batchCustomers));
  });

  return plan.sort((a, b) => a.index - b.index);
}

function planCustomer(row: CustomerRow, index: number, state: ImportState, seen: Set<string>): PlanRow {
  const base: PlanRow = { index, entityType: 'CUSTOMER', externalId: row.externalId, action: 'create', warnings: [] };
  const invalid = validateCommon(row, seen);
  if (invalid) return { ...base, action: 'conflict', reason: 'VALIDATION', detail: invalid };

  const known = state.customersByExternalId.get(row.externalId);
  if (!known) return base;
  return { ...base, action: 'link', existingId: known.id, warnings: linkWarnings(row.name, known.name, known.status) };
}

function planProject(row: ProjectRow, index: number, state: ImportState, seen: Set<string>, batchCustomers: Map<string, PlanRow>): PlanRow {
  const base: PlanRow = { index, entityType: 'PROJECT', externalId: row.externalId, action: 'create', warnings: [] };
  const invalid = validateCommon(row, seen) ?? (isSupportedCurrency(row.currency) ? null : 'UNSUPPORTED_CURRENCY');
  if (invalid) return { ...base, action: 'conflict', reason: 'VALIDATION', detail: invalid };

  const customer = resolveCustomer(row.customerExternalId, state, batchCustomers);
  if (!customer) return { ...base, action: 'conflict', reason: 'UNKNOWN_CUSTOMER' };

  const known = state.projectsByExternalId.get(row.externalId);
  if (!known) return { ...base, customer };

  const sameCustomer = customer.kind === 'existing' && customer.id === known.customerId;
  if (!sameCustomer) return { ...base, action: 'conflict', reason: 'CUSTOMER_MISMATCH', existingId: known.id, customer };
  if (known.currency !== row.currency) return { ...base, action: 'conflict', reason: 'CURRENCY_DIFFERS', existingId: known.id, customer };
  return { ...base, action: 'link', existingId: known.id, customer, warnings: linkWarnings(row.name, known.name, known.status) };
}

function resolveCustomer(externalId: string, state: ImportState, batchCustomers: Map<string, PlanRow>): ResolvedCustomer | null {
  const inBatch = batchCustomers.get(externalId);
  if (inBatch) {
    if (inBatch.action === 'create') return { kind: 'batch', externalId };
    if (inBatch.action === 'link' && inBatch.existingId) return { kind: 'existing', id: inBatch.existingId };
    return null; // the customer row itself is a conflict
  }
  const known = state.customersByExternalId.get(externalId);
  return known ? { kind: 'existing', id: known.id } : null;
}

function validateCommon(row: ImportRow, seen: Set<string>): ValidationDetail | null {
  const dedupeKey = `${row.entityType}:${row.externalId}`;
  if (seen.has(dedupeKey)) return 'DUPLICATE_IN_BATCH';
  seen.add(dedupeKey);
  const name = row.name.trim();
  if (name.length === 0) return 'EMPTY_NAME';
  if (name.length > MAX_NAME_LENGTH) return 'NAME_TOO_LONG';
  return null;
}

function linkWarnings(rowName: string, knownName: string, status: EntityStatus): PlanWarning[] {
  const warnings: PlanWarning[] = [];
  if (rowName.trim() !== knownName) warnings.push('NAME_DIFFERS');
  if (status === 'ARCHIVED') warnings.push('ARCHIVED');
  return warnings;
}
