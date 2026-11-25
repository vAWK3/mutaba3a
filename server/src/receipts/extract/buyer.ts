import { amountsIn } from './amounts.js';
import { foldForMatch } from './normalize.js';
import { CUSTOMER, CUSTOMER_NUMBER, DATE_LABEL, EMAIL_LABEL, hasKeyword, NOT_CUSTOMER, PHONE, TABLE_COLUMN, TOTAL } from './keywords.js';
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
/** An email address. Here, not in fields.ts, so that buyer.ts and fields.ts don't import each other (MUT-630). */
export const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const EMAILS = new RegExp(EMAIL.source, 'g');

/** Rows under a bill-to label that still belong to it. */
const CUSTOMER_BLOCK_ROWS = 5;
/** MUT-630: contact rows (an email, a phone) that still belong to the block past its cap: a bill prints them last. */
const CUSTOMER_CONTACT_ROWS = 2;
/** Two column headings on one row: the item table starts, the block has ended. */
const TABLE_HEADER_COLUMNS = 2;
const ISRAELI_ID_DIGITS = 9;
/** An amount printed with two or three decimals (JOD) ends the block: the items or totals have started. */
const MONEY_SCALE = 3;

function isCustomerLabel(row: Row): boolean {
  const folded = NOT_CUSTOMER.reduce((text, pattern) => text.replace(new RegExp(pattern.source, 'gu'), ' '), row.folded);
  return hasKeyword(folded, CUSTOMER);
}

/**
 * MUT-630/631: where the receipt's body starts: a money row (an amount with decimals; a customer-number row never is
 * one) or an item table's header (two column headings). A bill-to block ends there, no vendor name is read from there
 * on, and no phone from the item body is the vendor's.
 */
export function startsBody(row: Row): boolean {
  return (!hasKeyword(row.folded, CUSTOMER_NUMBER) && amountsIn(row.text, MONEY_SCALE).some((a) => a.decimal)) || isTableHeader(row);
}

/** Two column headings on one row: an item table's header. */
export function isTableHeader(row: Row): boolean {
  return TABLE_COLUMN.filter((pattern) => pattern.test(row.folded)).length >= TABLE_HEADER_COLUMNS;
}

function endsBlock(row: Row): boolean {
  return startsBody(row) || hasKeyword(row.folded, TOTAL) || hasKeyword(row.folded, DATE_LABEL);
}

/** MUT-630: a row that is only an email or a phone number, with at most its label (`דוא"ל:`, `טל:`). */
function isContactRow(row: Row): boolean {
  if (!EMAIL.test(row.text) && !PHONE_NUMBER.test(row.text)) return false;
  const rest = [...PHONE, ...EMAIL_LABEL].reduce((text, pattern) => text.replace(new RegExp(pattern.source, 'gu'), ' '), foldForMatch(row.text.replace(EMAILS, ' ').replace(PHONE_NUMBERS, ' ')));
  return !/[\p{L}\p{N}]/u.test(rest);
}

interface Blocks {
  /** The label rows and the rows under them, up to the cap. */
  rows: Set<Row>;
  /** MUT-630: the contact rows right after a block that reached its cap. They exclude on this receipt, never learned. */
  contact: Set<Row>;
}

function blocksOf(rows: readonly Row[]): Blocks {
  const blocks: Blocks = { rows: new Set(), contact: new Set() };
  rows.forEach((row, i) => {
    if (!isCustomerLabel(row)) return;
    blocks.rows.add(row);
    const under = rows.slice(i + 1, i + 1 + CUSTOMER_BLOCK_ROWS);
    const ended = under.findIndex(endsBlock);
    for (const next of ended < 0 ? under : under.slice(0, ended)) blocks.rows.add(next);
    if (ended >= 0 || under.length < CUSTOMER_BLOCK_ROWS) return;
    for (const next of rows.slice(i + 1 + CUSTOMER_BLOCK_ROWS, i + 1 + CUSTOMER_BLOCK_ROWS + CUSTOMER_CONTACT_ROWS)) {
      if (!isContactRow(next)) break;
      blocks.contact.add(next);
    }
  });
  for (const row of blocks.rows) blocks.contact.delete(row);
  return blocks;
}

/**
 * The rows of the receipt's bill-to blocks: a row with a CUSTOMER label, and the rows under it until a money row, an
 * item table's header, a total or date label, or CUSTOMER_BLOCK_ROWS rows, then up to CUSTOMER_CONTACT_ROWS contact
 * rows (MUT-630). A phone label never ends it (the buyer's own phone sits there, OV-8), nor a customer number. A
 * copy's title (`העתק לקוח`, `Customer copy`) or a customer number is no label (R9).
 */
export function customerRows(rows: readonly Row[]): Set<Row> {
  const { rows: block, contact } = blocksOf(rows);
  return new Set([...block, ...contact]);
}

/**
 * A phone or ID number as digits only: an international prefix (+972, 00972, 970) back to the local 0, and an
 * eight-digit ID with the leading zero it was printed without. MUT-630: an email lower-cased and trimmed.
 */
export function normalizeIdentifier(raw: string): string {
  if (raw.includes('@')) return raw.trim().toLowerCase();
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^97[02]\d{8,9}$/.test(digits)) digits = `0${digits.slice(3)}`;
  return digits.length === ISRAELI_ID_DIGITS - 1 ? digits.padStart(ISRAELI_ID_DIGITS, '0') : digits;
}

/** Every email, phone and ID number on the row; the digits inside an email are none of the others (MUT-630). */
function identifiersOn(row: Row): string[] {
  const emails = [...row.text.matchAll(EMAILS)].map((m) => m[0]);
  const rest = row.text.replace(EMAILS, ' ');
  const phones = [...rest.matchAll(PHONE_NUMBERS)].map((m) => m[0]).filter((m) => !m.startsWith('*'));
  const ids = [...rest.matchAll(REGISTRATION_NUMBER)].map((m) => m[0]);
  return [...emails, ...phones, ...ids].map(normalizeIdentifier);
}

export interface Buyer {
  /** The rows of the receipt's bill-to blocks: no vendor field is read from them. */
  rows: ReadonlySet<Row>;
  /**
   * Every number and email known to be the buyer's, normalised: this receipt's blocks (with their contact rows) and the
   * organization's learned ones.
   */
  identifiers: ReadonlySet<string>;
  /** This receipt's own block numbers and emails, for the reader to keep (never in the API or a log). Not the contact rows past the cap. */
  ownIdentifiers: string[];
  /** Whether `raw` (as printed) is one of the buyer's numbers or emails. */
  has(raw: string): boolean;
}

/** The buyer of this receipt: its blocks, and `learned`, the organization's numbers from earlier receipts. */
export function buyerOf(rows: readonly Row[], learned: readonly string[] = []): Buyer {
  const { rows: block, contact } = blocksOf(rows);
  const own = [...new Set([...block].flatMap(identifiersOn))];
  const identifiers = new Set([...own, ...[...contact].flatMap(identifiersOn), ...learned.map(normalizeIdentifier)]);
  return { rows: new Set([...block, ...contact]), identifiers, ownIdentifiers: own, has: (raw) => identifiers.has(normalizeIdentifier(raw)) };
}

/** What one earlier read kept: the numbers (and MUT-630, emails) in its bill-to blocks, and the numbers it read as the vendor's. */
export interface ReadIdentifiers {
  buyer: readonly string[];
  vendor: readonly string[];
}

/**
 * R9: the organization's buyer numbers, from its earlier reads: every number one of their bill-to blocks held, less
 * any number one of them read as the vendor's (a misfired block must not hide a vendor's number on all its receipts).
 * MUT-630: emails are learned the same way and never unlearned: a read never reports an email as the vendor's.
 */
export function learnedBuyerIds(reads: readonly ReadIdentifiers[]): string[] {
  const vendor = new Set(reads.flatMap((r) => r.vendor.map(normalizeIdentifier)));
  return [...new Set(reads.flatMap((r) => r.buyer.map(normalizeIdentifier)))].filter((id) => !vendor.has(id));
}
