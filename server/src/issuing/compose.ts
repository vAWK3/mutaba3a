import { validationError } from '../agreements/compose.js';
import { roundHalfUpDiv } from '../vat.js';
import type { DealerType, IssuedDocType, LineKind } from './types.js';
import { ISSUING_CURRENCIES, MAX_DESCRIPTION_LENGTH, MAX_LINES, VAT_BEARING } from './types.js';
import { standardVatRateOn } from './vat-rate.js';

/**
 * MUT-568: what a document will say, computed before anything is written: the issue route and the stateless preview
 * (D7) both call this. Integer arithmetic on agorot; a quantity is in thousandths.
 *
 * V1-a (Basel, 2026-11-22): prices include VAT or not per document, overridable per line, and a line may be VAT-exempt.
 * An inclusive line keeps the amount typed and its VAT is taken out of it (net = gross ÷ (1 + rate), half up), so an
 * all-inclusive invoice totals exactly what was typed. Exclusive lines are taxed together on their net, half up, and
 * that VAT is spread over them. The document discount is entered in the document's terms and spread over the lines by
 * their amounts, each share converted to its line's terms. Lines always add up to the document.
 */

export interface ComposeLineInput {
  description: string;
  kind: LineKind;
  quantityMilli: bigint;
  unitPriceMinor: bigint;
  discountMinor: bigint;
  /** Overrides the document's `pricesIncludeVat` for this line. */
  pricesIncludeVat?: boolean;
  /** No VAT on this line (e.g. a reimbursed fee). */
  vatExempt?: boolean;
}

export interface ComposeInput {
  docType: IssuedDocType;
  currency: string;
  documentDate: string;
  dealerType: DealerType;
  /** In the document's terms (`pricesIncludeVat`). */
  documentDiscountMinor: bigint;
  pricesIncludeVat: boolean;
  /** A credit note credits at its tax invoice's rate (review fix 1), not the rate on its own date. */
  vatRateBasisPoints?: number;
  lines: ComposeLineInput[];
}

export interface ComposedLine extends ComposeLineInput {
  /** 1-based, the order printed. */
  index: number;
  /** Resolved: the document's setting unless the line overrides it; false on an exempt line or a document without VAT. */
  pricesIncludeVat: boolean;
  vatExempt: boolean;
  /** Quantity × price less the line's own discount, before VAT (the allocation API's item Total_Amount). */
  netMinor: bigint;
  vatRateBasisPoints: number;
  vatMinor: bigint;
}

export interface ComposedDocument {
  lines: ComposedLine[];
  /** Σ line nets, before the document discount. */
  subtotalMinor: bigint;
  discountMinor: bigint;
  netMinor: bigint;
  vatRateBasisPoints: number;
  vatMinor: bigint;
  grossMinor: bigint;
  pricesIncludeVat: boolean;
}

const MILLI = 1000n;
const BP = 10_000n;
const QUANTITY_PATTERN = /^\d{1,9}(\.\d{1,3})?$/;

export function parseQuantity(text: string): bigint {
  if (!QUANTITY_PATTERN.test(text)) throw validationError('QUANTITY_INVALID', 'quantity must be a positive number with at most 3 decimals', { field: 'quantity' });
  const [whole = '', fraction = ''] = text.split('.');
  const milli = BigInt(whole) * MILLI + BigInt(fraction.padEnd(3, '0'));
  if (milli <= 0n) throw validationError('QUANTITY_INVALID', 'quantity must be above zero', { field: 'quantity' });
  return milli;
}

export function composeDocument(input: ComposeInput): ComposedDocument {
  assertWhoMayIssue(input);
  assertLines(input.lines);
  const rate = VAT_BEARING.has(input.docType) ? (input.vatRateBasisPoints ?? standardVatRateOn(input.documentDate)) : 0;
  const documentInclusive = input.pricesIncludeVat && rate > 0;
  const lines = input.lines.map((line) => {
    const vatExempt = rate > 0 && line.vatExempt === true;
    const inclusive = rate > 0 && !vatExempt && (line.pricesIncludeVat ?? input.pricesIncludeVat);
    return { line, vatExempt, inclusive, amount: lineAmount(line) };
  });
  const toNet = (gross: bigint) => roundHalfUpDiv(gross * BP, BP + BigInt(rate));
  const toGross = (net: bigint) => roundHalfUpDiv(net * (BP + BigInt(rate)), BP);
  const subtotalMinor = lines.reduce((sum, l) => sum + (l.inclusive ? toNet(l.amount) : l.amount), 0n);
  // The discount is in the document's terms: weigh and check it against the lines in those terms, then convert each
  // line's share back to the line's own terms. Too much is refused, never capped (review fix 6).
  const sameTerms = (l: { vatExempt: boolean; inclusive: boolean }) => l.vatExempt || l.inclusive === documentInclusive;
  const inDocumentTerms = lines.map((l) => (sameTerms(l) ? l.amount : documentInclusive ? toGross(l.amount) : toNet(l.amount)));
  const discountRefused = () => validationError('DISCOUNT_INVALID', 'the document discount must be between zero and the subtotal', { field: 'discount' });
  if (input.documentDiscountMinor < 0n || input.documentDiscountMinor > inDocumentTerms.reduce((sum, a) => sum + a, 0n)) throw discountRefused();
  const shares = spread(input.documentDiscountMinor, inDocumentTerms);
  const after = lines.map((l, i) => {
    const share = shares[i]!;
    const own = sameTerms(l) ? share : documentInclusive ? toNet(share) : toGross(share);
    if (own > l.amount) throw discountRefused();
    return l.amount - own;
  });
  const nets = lines.map((l, i) => (l.inclusive ? toNet(after[i]!) : after[i]!));
  const exclusiveIdx = lines.flatMap((l, i) => (!l.inclusive && !l.vatExempt && rate > 0 ? [i] : []));
  const exclusiveNet = exclusiveIdx.reduce((sum, i) => sum + nets[i]!, 0n);
  const exclusiveVat = spread(roundHalfUpDiv(exclusiveNet * BigInt(rate), BP), exclusiveIdx.map((i) => nets[i]!));
  const lineVat = lines.map((l, i) => (l.inclusive ? after[i]! - nets[i]! : l.vatExempt || rate === 0 ? 0n : exclusiveVat[exclusiveIdx.indexOf(i)]!));
  const netMinor = nets.reduce((sum, n) => sum + n, 0n);
  if (netMinor <= 0n) throw validationError('TOTAL_NOT_POSITIVE', 'a document must be for more than zero');
  const vatMinor = lineVat.reduce((sum, v) => sum + v, 0n);
  return {
    lines: lines.map((l, i) => ({
      ...l.line,
      index: i + 1,
      pricesIncludeVat: l.inclusive,
      vatExempt: l.vatExempt,
      netMinor: l.inclusive ? toNet(l.amount) : l.amount,
      vatRateBasisPoints: l.vatExempt ? 0 : rate,
      vatMinor: lineVat[i]!,
    })),
    subtotalMinor,
    discountMinor: subtotalMinor - netMinor,
    netMinor,
    vatRateBasisPoints: rate,
    vatMinor,
    grossMinor: netMinor + vatMinor,
    pricesIncludeVat: documentInclusive,
  };
}

function assertWhoMayIssue(input: ComposeInput): void {
  if (!(ISSUING_CURRENCIES as readonly string[]).includes(input.currency)) {
    throw validationError('CURRENCY_NOT_SUPPORTED', 'documents are issued in shekels (ILS) only', { field: 'currency' });
  }
  if (input.dealerType === 'EXEMPT' && input.docType !== 'RECEIPT') {
    throw validationError('EXEMPT_DEALER_TAX_INVOICE', 'an exempt dealer (עוסק פטור) issues receipts, not tax invoices', { field: 'docType' });
  }
}

function assertLines(lines: ComposeLineInput[]): void {
  if (lines.length === 0) throw validationError('LINES_REQUIRED', 'a document needs at least one line', { field: 'lines' });
  if (lines.length > MAX_LINES) throw validationError('TOO_MANY_LINES', `a document holds at most ${MAX_LINES} lines`, { field: 'lines' });
  for (const line of lines) {
    const description = line.description.trim();
    if (!description) throw validationError('DESCRIPTION_REQUIRED', 'every line needs a description', { field: 'description' });
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      throw validationError('DESCRIPTION_TOO_LONG', `a description holds at most ${MAX_DESCRIPTION_LENGTH} characters`, { field: 'description' });
    }
    if (line.quantityMilli <= 0n) throw validationError('QUANTITY_INVALID', 'quantity must be above zero', { field: 'quantity' });
    if (line.unitPriceMinor < 0n) throw validationError('AMOUNT_INVALID', 'a price cannot be negative', { field: 'unitPrice' });
  }
}

/** Quantity × price less the line's own discount, in the line's own terms (VAT included or not). */
function lineAmount(line: ComposeLineInput): bigint {
  const gross = roundHalfUpDiv(line.quantityMilli * line.unitPriceMinor, MILLI);
  if (line.discountMinor < 0n || line.discountMinor > gross) {
    throw validationError('DISCOUNT_INVALID', 'a line discount must be between zero and the line amount', { field: 'discount' });
  }
  return gross - line.discountMinor;
}

/** `total` split in proportion to `weights` by largest remainder: the parts always add up to `total`. */
function spread(total: bigint, weights: bigint[]): bigint[] {
  const sum = weights.reduce((s, w) => s + w, 0n);
  if (sum === 0n) return weights.map(() => 0n);
  const parts = weights.map((w) => (total * w) / sum);
  const order = weights
    .map((w, i) => ({ i, remainder: (total * w) % sum }))
    .sort((a, b) => (a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1));
  let left = total - parts.reduce((s, p) => s + p, 0n);
  for (const { i } of order) {
    if (left === 0n) break;
    parts[i] = parts[i]! + 1n;
    left -= 1n;
  }
  return parts;
}
