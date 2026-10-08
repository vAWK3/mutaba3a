import { compareIsoDates, type IsoDate } from '../dates.js';
import { itemStatus, type ItemStatus } from '../agreements/status.js';

/**
 * Allocation math (M4 brief §2.1). Pure: validates an explicit allocation set
 * against the receivables it names, suggests one from a strategy, and computes
 * the balances that would result. `bigint` minor units throughout; nothing is
 * ever converted between currencies (ADR-004).
 */

export const ALLOCATION_STRATEGIES = ['OLDEST_FIRST', 'SETTLE_MATTERS'] as const;
export type AllocationStrategy = (typeof ALLOCATION_STRATEGIES)[number];

/** The slice of a receivable allocations care about. */
export interface AllocatableReceivable {
  id: string;
  customerId: string;
  projectId: string;
  currency: string;
  dueDate: IsoDate;
  postingDate: IsoDate;
  grossMinor: bigint;
  paidMinor: bigint;
  creditedMinor: bigint;
  status: 'OPEN' | 'SETTLED';
}

export interface AllocationRequest {
  receivableId: string;
  amountMinor: bigint;
}

export type AllocationErrorReason =
  | 'AMOUNT_INVALID'
  | 'ALLOCATION_DUPLICATE'
  | 'RECEIVABLE_NOT_FOUND'
  | 'RECEIVABLE_NOT_OPEN'
  | 'RECEIVABLE_CUSTOMER_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'ALLOCATION_EXCEEDS_OUTSTANDING'
  | 'ALLOCATION_EXCEEDS_PAYMENT';

export interface AllocationError {
  reason: AllocationErrorReason;
  receivableId?: string;
  outstandingMinor?: bigint;
  excessMinor?: bigint;
}

export interface ValidatedAllocations {
  allocations: AllocationRequest[];
  allocatedMinor: bigint;
  unallocatedMinor: bigint;
}

/** What is still owed on a receivable: gross − paid − credited. */
export function outstandingOf(r: Pick<AllocatableReceivable, 'grossMinor' | 'paidMinor' | 'creditedMinor'>): bigint {
  return r.grossMinor - r.paidMinor - r.creditedMinor;
}

/** Receivables a payment of this customer and currency may be allocated to, oldest due first. */
export function eligibleFor(receivables: readonly AllocatableReceivable[], customerId: string, currency: string): AllocatableReceivable[] {
  return receivables.filter((r) => r.customerId === customerId && r.currency === currency && r.status === 'OPEN' && outstandingOf(r) > 0n).sort(oldestFirst);
}

function oldestFirst(a: AllocatableReceivable, b: AllocatableReceivable): number {
  return compareIsoDates(a.dueDate, b.dueDate) || compareIsoDates(a.postingDate, b.postingDate) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export interface ValidateInput {
  customerId: string;
  currency: string;
  /** The amount being allocated: a new payment's amount, or a posted payment's unallocated funds. */
  amountMinor: bigint;
  allocations: readonly AllocationRequest[];
  /** Every receivable the allocations name (loaded by id), plus whatever else the caller has. */
  receivables: readonly AllocatableReceivable[];
}

/** Explicit allocations are checked, never adjusted (brief decision 1). */
export function validateAllocations(input: ValidateInput): { ok: true; value: ValidatedAllocations } | { ok: false; error: AllocationError } {
  if (input.amountMinor <= 0n) return { ok: false, error: { reason: 'AMOUNT_INVALID' } };
  const byId = new Map(input.receivables.map((r) => [r.id, r]));
  const seen = new Set<string>();
  let allocated = 0n;
  for (const a of input.allocations) {
    if (a.amountMinor <= 0n) return { ok: false, error: { reason: 'AMOUNT_INVALID', receivableId: a.receivableId } };
    if (seen.has(a.receivableId)) return { ok: false, error: { reason: 'ALLOCATION_DUPLICATE', receivableId: a.receivableId } };
    seen.add(a.receivableId);
    const r = byId.get(a.receivableId);
    if (!r) return { ok: false, error: { reason: 'RECEIVABLE_NOT_FOUND', receivableId: a.receivableId } };
    if (r.customerId !== input.customerId) return { ok: false, error: { reason: 'RECEIVABLE_CUSTOMER_MISMATCH', receivableId: r.id } };
    if (r.currency !== input.currency) return { ok: false, error: { reason: 'CURRENCY_MISMATCH', receivableId: r.id } };
    const outstanding = outstandingOf(r);
    if (r.status !== 'OPEN' || outstanding <= 0n) return { ok: false, error: { reason: 'RECEIVABLE_NOT_OPEN', receivableId: r.id } };
    if (a.amountMinor > outstanding) return { ok: false, error: { reason: 'ALLOCATION_EXCEEDS_OUTSTANDING', receivableId: r.id, outstandingMinor: outstanding, excessMinor: a.amountMinor - outstanding } };
    allocated += a.amountMinor;
  }
  if (allocated > input.amountMinor) return { ok: false, error: { reason: 'ALLOCATION_EXCEEDS_PAYMENT', excessMinor: allocated - input.amountMinor } };
  return { ok: true, value: { allocations: input.allocations.map((a) => ({ ...a })), allocatedMinor: allocated, unallocatedMinor: input.amountMinor - allocated } };
}

/**
 * A suggestion the client may edit before posting. `eligible` must already be
 * the customer + currency set (see `eligibleFor`).
 */
export function suggestAllocations(strategy: AllocationStrategy, amountMinor: bigint, eligible: readonly AllocatableReceivable[]): AllocationRequest[] {
  const ordered = [...eligible].sort(oldestFirst);
  if (strategy === 'OLDEST_FIRST') return fill(amountMinor, ordered);

  // SETTLE_MATTERS: whole projects that fit, smallest total first (ties: oldest due date), then oldest-first for the rest.
  const byProject = new Map<string, AllocatableReceivable[]>();
  for (const r of ordered) byProject.set(r.projectId, [...(byProject.get(r.projectId) ?? []), r]);
  const projects = [...byProject.values()].sort((a, b) => {
    const diff = total(a) - total(b);
    if (diff !== 0n) return diff < 0n ? -1 : 1;
    return oldestFirst(a[0]!, b[0]!);
  });
  const result: AllocationRequest[] = [];
  const settled = new Set<string>();
  let remaining = amountMinor;
  for (const group of projects) {
    const needed = total(group);
    if (needed <= remaining) {
      for (const r of group) result.push({ receivableId: r.id, amountMinor: outstandingOf(r) });
      remaining -= needed;
      settled.add(group[0]!.projectId);
    }
  }
  const rest = ordered.filter((r) => !settled.has(r.projectId));
  return [...result, ...fill(remaining, rest)];
}

function total(group: readonly AllocatableReceivable[]): bigint {
  return group.reduce((sum, r) => sum + outstandingOf(r), 0n);
}

function fill(amountMinor: bigint, ordered: readonly AllocatableReceivable[]): AllocationRequest[] {
  const result: AllocationRequest[] = [];
  let remaining = amountMinor;
  for (const r of ordered) {
    if (remaining <= 0n) break;
    const take = outstandingOf(r) < remaining ? outstandingOf(r) : remaining;
    if (take <= 0n) continue;
    result.push({ receivableId: r.id, amountMinor: take });
    remaining -= take;
  }
  return result;
}

export interface Balance {
  outstandingMinor: bigint;
  overdueMinor: bigint;
}

export interface ReceivableBalance {
  receivableId: string;
  projectId: string;
  outstandingBefore: bigint;
  outstandingAfter: bigint;
  statusBefore: ItemStatus;
  statusAfter: ItemStatus;
}

export interface ProjectBalance {
  projectId: string;
  before: Balance;
  after: Balance;
}

export interface ResultingBalances {
  receivables: ReceivableBalance[];
  projects: ProjectBalance[];
  customer: { before: Balance; after: Balance };
}

/**
 * The balances a validated set would leave, over the customer's receivables in
 * the payment currency (`scope`), with statuses computed for `today` in the
 * organization timezone. Pure; the route feeds it the eligible set plus the
 * allocated receivables.
 */
export function resultingBalances(allocations: readonly AllocationRequest[], scope: readonly AllocatableReceivable[], today: IsoDate): ResultingBalances {
  const alloc = new Map(allocations.map((a) => [a.receivableId, a.amountMinor]));
  const status = (r: AllocatableReceivable, paidMinor: bigint): ItemStatus => itemStatus({ voided: false, posted: true, dueDate: r.dueDate, grossMinor: r.grossMinor, paidMinor, creditedMinor: r.creditedMinor, today });
  const receivables: ReceivableBalance[] = [];
  const projects = new Map<string, ProjectBalance>();
  const customer = { before: { outstandingMinor: 0n, overdueMinor: 0n }, after: { outstandingMinor: 0n, overdueMinor: 0n } };
  for (const r of [...scope].sort(oldestFirst)) {
    const before = outstandingOf(r);
    const applied = alloc.get(r.id) ?? 0n;
    const after = before - applied;
    const overdue = compareIsoDates(r.dueDate, today) < 0;
    if (applied > 0n) {
      receivables.push({ receivableId: r.id, projectId: r.projectId, outstandingBefore: before, outstandingAfter: after, statusBefore: status(r, r.paidMinor), statusAfter: status(r, r.paidMinor + applied) });
    }
    const p = projects.get(r.projectId) ?? { projectId: r.projectId, before: { outstandingMinor: 0n, overdueMinor: 0n }, after: { outstandingMinor: 0n, overdueMinor: 0n } };
    p.before.outstandingMinor += before;
    p.after.outstandingMinor += after;
    customer.before.outstandingMinor += before;
    customer.after.outstandingMinor += after;
    if (overdue) {
      p.before.overdueMinor += before;
      p.after.overdueMinor += after;
      customer.before.overdueMinor += before;
      customer.after.overdueMinor += after;
    }
    projects.set(r.projectId, p);
  }
  return { receivables, projects: [...projects.values()], customer };
}
