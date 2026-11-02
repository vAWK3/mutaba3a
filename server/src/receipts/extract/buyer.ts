import { amountsIn } from './amounts.js';
import { CUSTOMER, DATE_LABEL, hasKeyword, NOT_CUSTOMER, TABLE_COLUMN, TOTAL } from './keywords.js';
import type { Row } from './types.js';

/**
 * MUT-514 (D6, D10): the buyer on a receipt. An invoice made out to a customer prints the customer's phone and ID
 * under a bill-to label; those numbers are never the vendor's. The organization's own numbers are learned from such
 * blocks on its earlier receipts (the reader passes them in), never from how often a number appears. Pure.
 */

/** A phone number as receipts print it: international, local with its area code, or a `*1234` short number. */
export const PHONE_NUMBER = /(?:\+|00)\d{3}[\s-]?\d{1,2}[\s-]?\d{3}[\s-]?\d{4}(?!\d)|(?<!\d)0\d{1,2}[\s-]?\d{3}[\s-]?\d{4}(?!\d)|(?<![\d*])\*\d{4}(?!\d)/;
/** An Israeli registration or ID number: eight or nine digits, with spaces or dashes between them. */
export const REGISTRATION_NUMBER = /(?<!\d)\d(?:[\s-]?\d){7,8}(?!\d)/g;
const PHONE_NUMBERS = new RegExp(PHONE_NUMBER.source, 'g');

/** Rows under a bill-to label that still belong to it. */
const CUSTOMER_BLOCK_ROWS = 5;
/** Two column headings on one row: the item table starts, the block has ended. */
const TABLE_HEADER_COLUMNS = 2;
const ISRAELI_ID_DIGITS = 9;
/** An amount printed with two or three decimals (JOD) ends the block: the items or totals have started. */
const MONEY_SCALE = 3;

function isCustomerLabel(row: Row): boolean {
  const folded = NOT_CUSTOMER.reduce((text, pattern) => text.replace(new RegExp(pattern.source, 'gu'), ' '), row.folded);
  return hasKeyword(folded, CUSTOMER);
}

function endsBlock(row: Row): boolean {
  if (amountsIn(row.text, MONEY_SCALE).some((a) => a.decimal)) return true;
  if (TABLE_COLUMN.filter((pattern) => pattern.test(row.folded)).length >= TABLE_HEADER_COLUMNS) return true;
  return hasKeyword(row.folded, TOTAL) || hasKeyword(row.folded, DATE_LABEL);
}

/**
 * The rows of the receipt's bill-to blocks: a row with a CUSTOMER label, and the rows under it until a money row, an
 * item table's header, a total or date label, or CUSTOMER_BLOCK_ROWS rows. A phone label never ends it (the buyer's
 * own phone sits there, OV-8). A copy's title (`העתק לקוח`, `Customer copy`) or a customer number is no label (R9).
 */
export function customerRows(rows: readonly Row[]): Set<Row> {
  const block = new Set<Row>();
  rows.forEach((row, i) => {
    if (!isCustomerLabel(row)) return;
    block.add(row);
    for (const next of rows.slice(i + 1, i + 1 + CUSTOMER_BLOCK_ROWS)) {
      if (endsBlock(next)) break;
      block.add(next);
    }
  });
  return block;
}

/**
 * A phone or ID number as digits only: an international prefix (+972, 00972, 970) back to the local 0, and an
 * eight-digit ID with the leading zero it was printed without.
 */
export function normalizeIdentifier(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^97[02]\d{8,9}$/.test(digits)) digits = `0${digits.slice(3)}`;
  return digits.length === ISRAELI_ID_DIGITS - 1 ? digits.padStart(ISRAELI_ID_DIGITS, '0') : digits;
}

function identifiersOn(row: Row): string[] {
  const phones = [...row.text.matchAll(PHONE_NUMBERS)].map((m) => m[0]).filter((m) => !m.startsWith('*'));
  const ids = [...row.text.matchAll(REGISTRATION_NUMBER)].map((m) => m[0]);
  return [...phones, ...ids].map(normalizeIdentifier);
}

export interface Buyer {
  /** The rows of the receipt's bill-to blocks: no vendor field is read from them. */
  rows: ReadonlySet<Row>;
  /** Every number known to be the buyer's: this receipt's blocks and the organization's learned ones, normalised. */
  identifiers: ReadonlySet<string>;
  /** This receipt's own block numbers, for the reader to keep (never in the API or a log). */
  ownIdentifiers: string[];
  /** Whether `raw` (as printed) is one of the buyer's numbers. */
  has(raw: string): boolean;
}

/** The buyer of this receipt: its blocks, and `learned`, the organization's numbers from earlier receipts. */
export function buyerOf(rows: readonly Row[], learned: readonly string[] = []): Buyer {
  const block = customerRows(rows);
  const own = [...new Set([...block].flatMap(identifiersOn))];
  const identifiers = new Set([...own, ...learned.map(normalizeIdentifier)]);
  return { rows: block, identifiers, ownIdentifiers: own, has: (raw) => identifiers.has(normalizeIdentifier(raw)) };
}

/** What one earlier read kept: the numbers in its bill-to blocks, and the ones it read as the vendor's. */
export interface ReadIdentifiers {
  buyer: readonly string[];
  vendor: readonly string[];
}

/**
 * R9: the organization's buyer numbers, from its earlier reads: every number one of their bill-to blocks held, less
 * any number one of them read as the vendor's (a misfired block must not hide a vendor's number on all its receipts).
 */
export function learnedBuyerIds(reads: readonly ReadIdentifiers[]): string[] {
  const vendor = new Set(reads.flatMap((r) => r.vendor.map(normalizeIdentifier)));
  return [...new Set(reads.flatMap((r) => r.buyer.map(normalizeIdentifier)))].filter((id) => !vendor.has(id));
}
