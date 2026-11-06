import { type Buyer, PHONE_NUMBER, REGISTRATION_NUMBER } from './buyer.js';
import { ALLOCATION, COMPANY, DATE_LABEL, hasKeyword, type KeywordSet, NOT_TOTAL, NOT_VENDOR, PHONE, REGISTRATION, STREET, TOTAL } from './keywords.js';
import { countMatches } from './normalize.js';
import type { Row } from './types.js';

/**
 * MUT-441: the vendor's details on a receipt: registration no., phone, email, name. Pure. MUT-514: never from a
 * bill-to block's rows, and never a number that is the buyer's (`Buyer`), wherever on the receipt it is printed.
 */

export interface Reading<T> {
  value: T;
  rule: number;
  conf: number;
}

const ISRAELI_REGISTRATION_DIGITS = 9;

/**
 * An Israeli company (ח.פ) or dealer (ע.מ, עוסק מורשה) number: nine digits whose last is the Israeli ID check digit
 * (alternate digits doubled, a two-digit product summed, the total a multiple of 10). All zeros is not a number.
 */
export function isValidIsraeliRegistration(digits: string): boolean {
  if (!/^\d{9}$/.test(digits) || /^0+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < ISRAELI_REGISTRATION_DIGITS; i += 1) {
    const product = Number(digits[i]) * (i % 2 === 0 ? 1 : 2);
    sum += product > 9 ? product - 9 : product;
  }
  return sum % 10 === 0;
}

const RULE_REGISTRATION = 0.9;

/** A registration number after its label (on the label's row or the next), whose check digit holds. A failing one is no answer. */
export function readRegistration(rows: readonly Row[], buyer: Buyer): Reading<string> | null {
  for (let i = 0; i < rows.length; i += 1) {
    if (!hasKeyword(rows[i]!.folded, REGISTRATION) || buyer.rows.has(rows[i]!)) continue;
    for (const row of [rows[i]!, rows[i + 1]].filter((r): r is Row => r !== undefined && !buyer.rows.has(r))) {
      for (const match of row.text.matchAll(REGISTRATION_NUMBER)) {
        // An eight-digit dealer number is a nine-digit ID printed without its leading zero.
        const digits = match[0].replace(/\D/g, '').padStart(ISRAELI_REGISTRATION_DIGITS, '0');
        if (!isValidIsraeliRegistration(digits)) continue;
        // MUT-514: the buyer's number where the vendor's is expected: whatever follows is a guess.
        return buyer.has(digits) ? null : { value: digits, rule: RULE_REGISTRATION, conf: row.conf };
      }
    }
  }
  return null;
}

const ALLOCATION_DIGITS = /(?<!\d)\d{9}(?!\d)/g;
const RULE_ALLOCATION = 0.9;

/** Where each label of `set` ends in a folded row. */
function labelEnds(folded: string, set: KeywordSet): number[] {
  return set.flatMap((pattern) => [...folded.matchAll(new RegExp(pattern.source, 'gu'))].map((m) => m.index + m[0].length));
}

/**
 * The nine digits a row gives an allocation label (on the label's row, or the row under it): one the allocation label
 * precedes more closely than a registration label does; on a row with no registration label, any (a right-to-left row
 * may print the number's box first). Null when the row has none.
 */
function allocationDigitsIn(row: Row): string | null {
  const allocationEnds = labelEnds(row.folded, ALLOCATION);
  const registrationEnds = labelEnds(row.folded, REGISTRATION);
  for (const match of row.folded.matchAll(ALLOCATION_DIGITS)) {
    const before = (ends: number[]) => Math.max(-1, ...ends.filter((end) => end <= match.index));
    const allocationAt = before(allocationEnds);
    if (allocationAt >= 0 && allocationAt > before(registrationEnds)) return match[0];
    if (registrationEnds.length === 0) return match[0];
  }
  return null;
}

/**
 * MUT-557 (D2): an Israeli tax invoice's allocation number: nine digits on its label's row or the row under it (when
 * that one is not a registration row). Never a bare nine-digit number, never a bill-to row (MUT-514).
 */
export function readAllocationNumber(rows: readonly Row[], buyer: Buyer): Reading<string> | null {
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    if (!hasKeyword(row.folded, ALLOCATION) || buyer.rows.has(row)) continue;
    const own = allocationDigitsIn(row);
    if (own) return { value: own, rule: RULE_ALLOCATION, conf: row.conf };
    const next = rows[i + 1];
    if (!next || buyer.rows.has(next) || hasKeyword(next.folded, REGISTRATION) || hasKeyword(next.folded, ALLOCATION)) continue;
    const under = allocationDigitsIn(next);
    if (under) return { value: under, rule: RULE_ALLOCATION, conf: next.conf };
  }
  return null;
}

const PHONE_NUMBERS = new RegExp(PHONE_NUMBER.source, 'g');
const RULE_PHONE_LABELLED = 0.85;
const RULE_PHONE_BARE = 0.65;

/**
 * A phone number: one after a phone label first; else the first that looks like one, less sure. Never on a
 * registration row. MUT-514: once a labelled phone was the buyer's (in a bill-to block, or a number known as
 * theirs), no unlabelled one is offered: it could be anyone's.
 */
export function readPhone(rows: readonly Row[], buyer: Buyer): Reading<string> | null {
  let bare: Reading<string> | null = null;
  let buyerLabelled = false;
  for (const row of rows) {
    if (hasKeyword(row.folded, REGISTRATION)) continue;
    const labelled = hasKeyword(row.folded, PHONE);
    const matches = [...row.text.matchAll(PHONE_NUMBERS)];
    const match = buyer.rows.has(row) ? undefined : matches.find((m) => !buyer.has(m[0]));
    if (labelled && matches.length > 0 && !match) buyerLabelled = true;
    if (!match) continue;
    const value = match[0].trim().slice(0, 40);
    if (labelled) return { value, rule: RULE_PHONE_LABELLED, conf: row.conf };
    if (!bare && !match[0].startsWith('*')) bare = { value, rule: RULE_PHONE_BARE, conf: row.conf };
  }
  return buyerLabelled ? null : bare;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const RULE_EMAIL = 0.9;

export function readEmail(rows: readonly Row[]): Reading<string> | null {
  for (const row of rows) {
    const match = EMAIL.exec(row.text);
    if (match && match[0].length <= 254) return { value: match[0].toLowerCase(), rule: RULE_EMAIL, conf: row.conf };
  }
  return null;
}

/** The vendor is one of the first rows: the shop's name heads the receipt. */
const VENDOR_ROWS = 4;
const VENDOR_MAX_LENGTH = 60;
const VENDOR_MAX_DIGIT_SHARE = 0.25;
const RULE_VENDOR = 0.7;
const RULE_VENDOR_COMPANY = 0.85;
/** MUT-514 (O1): a street and house number between words (`הגפן 22 רמת גן`): an address line, not a name. */
const ADDRESS = /^[\p{L}"'.\s-]+\s\d{1,4}[\s,-]+[\p{L}"'.\s-]*\p{L}[\p{L}"'.\s-]*$/u;

/** A street word anywhere; the words-number-words shape only below the first row, where a shop's name (`Super 7 Market`) heads it. */
function looksLikeAddress(row: Row, first: boolean): boolean {
  return hasKeyword(row.folded, STREET) || (!first && ADDRESS.test(row.text) && !hasKeyword(row.folded, COMPANY));
}

function looksLikeName(row: Row): boolean {
  const compact = row.text.replace(/\s/g, '');
  const letters = countMatches(compact, /\p{L}/gu);
  const digits = countMatches(compact, /\d/g);
  if (letters < 2 || digits / compact.length > VENDOR_MAX_DIGIT_SHARE) return false;
  if (EMAIL.test(row.text) || PHONE_NUMBER.test(row.text)) return false;
  return ![NOT_VENDOR, REGISTRATION, PHONE, DATE_LABEL, TOTAL, NOT_TOTAL].some((set) => hasKeyword(row.folded, set));
}

/**
 * The first of the top rows that reads as a name (not a title, a number, a date or a contact line); surer with a
 * company form. Never a bill-to row (MUT-514).
 */
export function readVendor(rows: readonly Row[], buyer: Buyer): Reading<string> | null {
  for (const [i, row] of rows.slice(0, VENDOR_ROWS).entries()) {
    // MUT-504: a top row longer than a name is two columns OCR joined; the rows under it are its address, not a name.
    if (row.text.length > VENDOR_MAX_LENGTH) return null;
    // MUT-514 (OV-8): a bill-to block or an address before any name: the name was not read, and a row under it would
    // be a guess (the customer's name, a project's).
    if (buyer.rows.has(row) || looksLikeAddress(row, i === 0)) return null;
    if (!looksLikeName(row)) continue;
    const value = row.text.replace(/^[\s*=\-_#.:|]+|[\s*=\-_#:|]+$/g, '').trim();
    if (!value) continue;
    const company = hasKeyword(row.folded, COMPANY);
    return { value, rule: company ? RULE_VENDOR_COMPANY : RULE_VENDOR, conf: row.conf };
  }
  return null;
}
