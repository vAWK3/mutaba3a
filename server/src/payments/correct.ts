import { assertIsoDate, assertNotAbsurdDate, assertNotTooOld, parseAmount, validationError } from '../agreements/compose.js';
import { compareIsoDates, type IsoDate } from '../dates.js';
import { ApiError } from '../errors.js';
import type { Currency } from '../money.js';
import { previewToken } from '../preview-token.js';
import type { LedgerStore, PaymentMethod, PaymentRecord, ReceivableRecord } from '../repositories/ports.js';
import { eligibleFor, releaseAllocations, resultingBalances, suggestAllocations, validateAllocations, type AllocationRequest, type AllocationStrategy, type ResultingBalances, type ValidatedAllocations } from './allocate.js';
import { allocationFailure } from './allocation-error.js';
import { paymentCorrectTokenParts } from './preview-token.js';
import { carriedReceiptNumber } from './receipt-number.js';

/**
 * MUT-443 (ADR-225): correcting a recorded payment in one call. This composes what both routes need (the preview and
 * the correct): the original's reversal, the replacement's allocations validated against the receivables as they would
 * read once the original is reversed, the balances from the ledger now to the ledger after, and the token.
 */

/** The wire body, after the route normalized the receipt number (`undefined` = left out). */
export interface CorrectionBody {
  amount: string;
  receivedOn: string;
  method: PaymentMethod;
  reference?: string | null | undefined;
  notes?: string | null | undefined;
  receiptNumber?: string | null | undefined;
  allocations?: ReadonlyArray<{ receivableId: string; amount: string }> | undefined;
  strategy?: AllocationStrategy | undefined;
}

type Allocatable = ReceivableRecord & { projectId: string };

export interface ComposedCorrection {
  customerId: string;
  currency: Currency;
  amountMinor: bigint;
  receivedOn: IsoDate;
  reference: string | null;
  notes: string | null;
  receipt: { value: string | null; carried: boolean };
  /** What the original's reversal gives back, per allocation row. */
  released: AllocationRequest[];
  /** The receivables the replacement may pay, as they would read once the original is reversed, oldest due first. */
  eligible: Allocatable[];
  /** Eligible now ∪ what the original paid, as they are now (R2): the balances' scope. */
  scope: Allocatable[];
  value: ValidatedAllocations;
  balances: ResultingBalances;
  tokenParts: unknown[];
  token: string;
}

/** D4, D2 (R3): only a POSTED payment the key recorded can be corrected. */
export async function assertCorrectable(store: LedgerStore, organizationId: string, payment: PaymentRecord): Promise<void> {
  if (payment.origin !== 'INTEGRATION' || payment.customerId === null) throw validationError('PAYMENT_NOT_CORRECTABLE', 'Only a payment recorded through the API key can be corrected here', { paymentId: payment.id });
  if (payment.status !== 'POSTED') throw await paymentNotPosted(store, organizationId, payment);
}

/** 409 PAYMENT_NOT_POSTED, with where the money went, so a caller that lost the response can recover under any key (R3). */
export async function paymentNotPosted(store: LedgerStore, organizationId: string, payment: PaymentRecord): Promise<ApiError> {
  const replacedBy = await store.payments.findReplacedBy(organizationId, payment.id);
  return new ApiError('CONFLICT', 'This payment is already reversed; read it again before correcting', { reason: 'PAYMENT_NOT_POSTED', reversedAt: payment.reversedAt?.toISOString() ?? null, replacedByPaymentId: replacedBy?.id ?? null });
}

export async function composeCorrection(store: LedgerStore, organizationId: string, payment: PaymentRecord, body: CorrectionBody, today: IsoDate): Promise<ComposedCorrection> {
  const customerId = payment.customerId!;
  const currency = payment.currency as Currency;
  const receivedOn = correctionDate(body.receivedOn, payment.receivedOn, today);
  const customer = await store.customers.getById(organizationId, customerId);
  if (customer?.status === 'ARCHIVED') throw validationError('CUSTOMER_ARCHIVED', 'The customer is archived', { field: 'customerId' });
  const amountMinor = parseAmount(body.amount, currency);
  if (amountMinor <= 0n) throw validationError('AMOUNT_INVALID', 'amount must be positive', { field: 'amount' });

  const released = (await store.payments.listAllocations(organizationId, payment.id)).map((a) => ({ receivableId: a.receivableId, amountMinor: a.amountMinor }));
  const now = allocatable(await store.receivables.listEligible(organizationId, customerId, currency));
  const scope = [...now, ...(await loadMissing(store, organizationId, now, released.map((a) => a.receivableId)))];
  const explicit = body.allocations?.map((a, i) => ({ receivableId: a.receivableId, amountMinor: parseAmount(a.amount, currency, `allocations[${i}].amount`) }));
  const named = [...scope, ...(explicit ? await loadMissing(store, organizationId, scope, explicit.map((a) => a.receivableId)) : [])];
  const pool = releaseAllocations(named, released);
  const eligible = eligibleFor(pool, customerId, currency) as Allocatable[];
  const requested = explicit ?? (body.strategy ? suggestAllocations(body.strategy, amountMinor, eligible) : []);
  const result = validateAllocations({ customerId, currency, amountMinor, allocations: requested, receivables: pool });
  if (!result.ok) throw allocationFailure(result.error, currency);

  const reference = carried(body.reference, payment.reference);
  const notes = carried(body.notes, payment.notes);
  const receipt = carriedReceiptNumber({ given: body.receiptNumber, replaced: payment });
  const unchanged = amountMinor === payment.amountMinor && receivedOn === payment.receivedOn && body.method === payment.method && reference === payment.reference && notes === payment.notes && receipt.value === payment.receiptNumber && sameSums(result.value.allocations, released);
  if (unchanged) throw validationError('NOTHING_TO_CORRECT', 'This correction changes nothing on the payment', { paymentId: payment.id });

  const tokenBody = { amount: amountMinor, receivedOn, method: body.method, reference, notes, receiptNumber: receipt.value, allocations: sorted(result.value.allocations) };
  const tokenParts = paymentCorrectTokenParts(organizationId, payment, tokenBody, named);
  return { customerId, currency, amountMinor, receivedOn, reference, notes, receipt, released, eligible, scope, value: result.value, balances: resultingBalances(result.value.allocations, scope, today, released), tokenParts, token: previewToken(tokenParts) };
}

/**
 * The MUT-227 rules, with ADR-225's correction exemption (D3, R11): the corrected payment may keep the original's date
 * or move it later even below the ten-year floor, since it replaces the original's own record rather than adding a
 * back-dated one. Earlier than the original and below the floor is refused.
 */
function correctionDate(value: string, originalOn: IsoDate, today: IsoDate): IsoDate {
  const date = assertIsoDate(value, 'receivedOn');
  assertNotAbsurdDate(date, today, 'receivedOn');
  if (compareIsoDates(date, originalOn) < 0) assertNotTooOld(date, today, 'receivedOn');
  return date;
}

/** R10: left out keeps the original's value; null clears it; a value replaces it (the receipt-number rule). */
function carried(given: string | null | undefined, original: string | null): string | null {
  return given === undefined ? original : given;
}

/** Allocation ever only concerns a receivable with a project (the allocation preview's rule). */
function allocatable(records: readonly ReceivableRecord[]): Allocatable[] {
  return records.filter((r): r is Allocatable => r.projectId !== null);
}

/** The named receivables not already in `have`, read by id (as they are now). */
async function loadMissing(store: LedgerStore, organizationId: string, have: readonly ReceivableRecord[], ids: readonly string[]): Promise<Allocatable[]> {
  const missing = [...new Set(ids)].filter((id) => !have.some((r) => r.id === id));
  return missing.length > 0 ? allocatable(await store.receivables.getByIds(organizationId, missing)) : [];
}

function sorted(allocations: readonly AllocationRequest[]): Array<[string, bigint]> {
  return [...allocations].sort((a, b) => (a.receivableId < b.receivableId ? -1 : a.receivableId > b.receivableId ? 1 : 0)).map((a) => [a.receivableId, a.amountMinor]);
}

/** The same amount on each receivable, however the rows are split. */
function sameSums(a: readonly AllocationRequest[], b: readonly AllocationRequest[]): boolean {
  const sums = (rows: readonly AllocationRequest[]) => {
    const m = new Map<string, bigint>();
    for (const r of rows) m.set(r.receivableId, (m.get(r.receivableId) ?? 0n) + r.amountMinor);
    return m;
  };
  const x = sums(a);
  const y = sums(b);
  return x.size === y.size && [...x].every(([id, amount]) => y.get(id) === amount);
}
