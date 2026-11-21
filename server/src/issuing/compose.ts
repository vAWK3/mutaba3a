import { validationError } from '../agreements/compose.js';
import { roundHalfUpDiv } from '../vat.js';
import type { DealerType, IssuedDocType, LineKind } from './types.js';
import { ISSUING_CURRENCIES, MAX_DESCRIPTION_LENGTH, MAX_LINES, VAT_BEARING } from './types.js';
import { standardVatRateOn } from './vat-rate.js';

/**
 * MUT-568: what a document will say, computed before anything is written: the issue route and the stateless preview
 * (D7) both call this. Integer arithmetic on agorot; a quantity is in thousandths. VAT is computed once on the
 * document's net (after both discounts) and then spread over the lines, so the lines always add up to the document.
 */

export interface ComposeLineInput {
  description: string;
  kind: LineKind;
  quantityMilli: bigint;
  unitPriceMinor: bigint;
  discountMinor: bigint;
}

export interface ComposeInput {
  docType: IssuedDocType;
  currency: string;
  documentDate: string;
  dealerType: DealerType;
  documentDiscountMinor: bigint;
  lines: ComposeLineInput[];
}

export interface ComposedLine extends ComposeLineInput {
  /** 1-based, the order printed. */
  index: number;
  /** Quantity × price less the line's own discount (the allocation API's item Total_Amount). */
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
}

const MILLI = 1000n;
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
  const nets = input.lines.map(lineNet);
  const subtotalMinor = nets.reduce((sum, n) => sum + n, 0n);
  if (input.documentDiscountMinor < 0n || input.documentDiscountMinor > subtotalMinor) {
    throw validationError('DISCOUNT_INVALID', 'the document discount must be between zero and the subtotal', { field: 'discount' });
  }
  const netMinor = subtotalMinor - input.documentDiscountMinor;
  if (netMinor <= 0n) throw validationError('TOTAL_NOT_POSITIVE', 'a document must be for more than zero');
  const vatRateBasisPoints = VAT_BEARING.has(input.docType) ? standardVatRateOn(input.documentDate) : 0;
  const vatMinor = roundHalfUpDiv(netMinor * BigInt(vatRateBasisPoints), 10_000n);
  const lineVat = spread(vatMinor, nets);
  return {
    lines: input.lines.map((line, i) => ({ ...line, index: i + 1, netMinor: nets[i]!, vatRateBasisPoints, vatMinor: lineVat[i]! })),
    subtotalMinor,
    discountMinor: input.documentDiscountMinor,
    netMinor,
    vatRateBasisPoints,
    vatMinor,
    grossMinor: netMinor + vatMinor,
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

function lineNet(line: ComposeLineInput): bigint {
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
