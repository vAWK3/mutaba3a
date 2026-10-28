import { COMPANY, DATE_LABEL, hasKeyword, NOT_TOTAL, NOT_VENDOR, PHONE, REGISTRATION, TOTAL } from './keywords.js';
import { countMatches } from './normalize.js';
import type { Row } from './types.js';

/** MUT-441: the vendor's details on a receipt: registration no., phone, email, name. Pure. */

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

const REGISTRATION_NUMBER = /(?<!\d)\d(?:[\s-]?\d){7,8}(?!\d)/g;
const RULE_REGISTRATION = 0.9;

/** A registration number after its label (on the label's row or the next), whose check digit holds. A failing one is no answer. */
export function readRegistration(rows: readonly Row[]): Reading<string> | null {
  for (let i = 0; i < rows.length; i += 1) {
    if (!hasKeyword(rows[i]!.folded, REGISTRATION)) continue;
    for (const row of [rows[i]!, rows[i + 1]].filter((r): r is Row => r !== undefined)) {
      for (const match of row.text.matchAll(REGISTRATION_NUMBER)) {
        // An eight-digit dealer number is a nine-digit ID printed without its leading zero.
        const digits = match[0].replace(/\D/g, '').padStart(ISRAELI_REGISTRATION_DIGITS, '0');
        if (isValidIsraeliRegistration(digits)) return { value: digits, rule: RULE_REGISTRATION, conf: row.conf };
      }
    }
  }
  return null;
}

const PHONE_NUMBER = /(?:\+|00)\d{3}[\s-]?\d{1,2}[\s-]?\d{3}[\s-]?\d{4}(?!\d)|(?<!\d)0\d{1,2}[\s-]?\d{3}[\s-]?\d{4}(?!\d)|(?<![\d*])\*\d{4}(?!\d)/;
const RULE_PHONE_LABELLED = 0.85;
const RULE_PHONE_BARE = 0.65;

/** A phone number: one after a phone label first; else the first that looks like one, less sure. Never on a registration row. */
export function readPhone(rows: readonly Row[]): Reading<string> | null {
  let bare: Reading<string> | null = null;
  for (const row of rows) {
    if (hasKeyword(row.folded, REGISTRATION)) continue;
    const match = PHONE_NUMBER.exec(row.text);
    if (!match) continue;
    const value = match[0].trim().slice(0, 40);
    if (hasKeyword(row.folded, PHONE)) return { value, rule: RULE_PHONE_LABELLED, conf: row.conf };
    if (!bare && !match[0].startsWith('*')) bare = { value, rule: RULE_PHONE_BARE, conf: row.conf };
  }
  return bare;
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

function looksLikeName(row: Row): boolean {
  const compact = row.text.replace(/\s/g, '');
  const letters = countMatches(compact, /\p{L}/gu);
  const digits = countMatches(compact, /\d/g);
  if (letters < 2 || digits / compact.length > VENDOR_MAX_DIGIT_SHARE) return false;
  if (EMAIL.test(row.text) || PHONE_NUMBER.test(row.text)) return false;
  return ![NOT_VENDOR, REGISTRATION, PHONE, DATE_LABEL, TOTAL, NOT_TOTAL].some((set) => hasKeyword(row.folded, set));
}

/** The first of the top rows that reads as a name (not a title, a number, a date or a contact line); surer with a company form. */
export function readVendor(rows: readonly Row[]): Reading<string> | null {
  for (const row of rows.slice(0, VENDOR_ROWS)) {
    if (!looksLikeName(row)) continue;
    const value = row.text.replace(/^[\s*=\-_#.:|]+|[\s*=\-_#:|]+$/g, '').slice(0, VENDOR_MAX_LENGTH).trim();
    if (!value) continue;
    const company = hasKeyword(row.folded, COMPANY);
    return { value, rule: company ? RULE_VENDOR_COMPANY : RULE_VENDOR, conf: row.conf };
  }
  return null;
}
