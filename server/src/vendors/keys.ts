/**
 * MUT-254: how a typed vendor is compared. Saving matches only on these keys, exactly (decision V1): the
 * registration number first, then the normalised name or one of its aliases. Near-misses only ever show as typeahead
 * suggestions (`scoreVendorName`). Pure functions, shared by the Prisma and memory stores.
 */

import { categoryNameKey } from '../expenses/names.js';

/**
 * The profile's automatic "Other" category (the presets' last entry, in English or Arabic): the phone files an
 * expense there when nothing was picked, so it never becomes a vendor's default (MUT-254 A3).
 */
const AUTOMATIC_OTHER_NAME_KEYS = new Set(['other', 'أخرى']);
export function isAutomaticOtherCategory(name: string): boolean {
  return AUTOMATIC_OTHER_NAME_KEYS.has(categoryNameKey(name));
}

const TASHKEEL_AND_TATWEEL = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g;
// ASCII punctuation the local web normaliser strips, plus Arabic punctuation and guillemets.
const PUNCTUATION = /[.,;:!?'"()[\]{}@#$%^*+=<>\\|`~،؛؟«»״׳]/g;
// Matched after punctuation is gone, so dotted forms (ش.م.م, בע"מ) arrive without their dots.
const LEGAL_SUFFIXES = new Set(['llc', 'inc', 'ltd', 'co', 'corp', 'corporation', 'company', 'llp', 'plc', 'gmbh', 'ag', 'sa', 'sarl', 'בעמ', 'שמם', 'شمم', 'ذمم', 'شمع']);

/** The comparison key for a vendor name; '' means "no vendor". */
export function vendorNameKey(raw: string): string {
  let s = raw.normalize('NFKC').toLowerCase().replace(TASHKEEL_AND_TATWEEL, '');
  s = s.replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
  s = s.replace(PUNCTUATION, '').replace(/[-_&]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const words = s.split(' ');
  // An English leading "the", then one trailing legal suffix — each only while something is left.
  if (words.length > 1 && words[0] === 'the') words.shift();
  if (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1]!)) words.pop();
  return words.join(' ');
}

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EXTENDED_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';

/** Digits only (Arabic-Indic folded); fewer than 5 digits is no registration number. */
export function registrationKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = '';
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') digits += ch;
    else if (ARABIC_INDIC.includes(ch)) digits += String(ARABIC_INDIC.indexOf(ch));
    else if (EXTENDED_ARABIC_INDIC.includes(ch)) digits += String(EXTENDED_ARABIC_INDIC.indexOf(ch));
  }
  return digits.length >= 5 ? digits : null;
}

function levenshtein(a: string, b: string): number {
  const s = [...a];
  const t = [...b];
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= t.length; j += 1) cur[j] = Math.min(cur[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + (s[i - 1] === t[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[t.length]!;
}

export const FUZZY_SUGGESTION_FLOOR = 0.6;

/**
 * Typeahead score of a stored name key for a typed query key: a prefix 1, contains 0.8, otherwise similarity
 * (1 − edit distance / longer length) when at least FUZZY_SUGGESTION_FLOOR, kept below 0.8; else 0.
 */
export function scoreVendorName(queryKey: string, nameKey: string): number {
  if (!queryKey || !nameKey) return 0;
  if (nameKey.startsWith(queryKey)) return 1;
  if (nameKey.includes(queryKey)) return 0.8;
  const similarity = 1 - levenshtein(queryKey, nameKey) / Math.max([...queryKey].length, [...nameKey].length);
  return similarity >= FUZZY_SUGGESTION_FLOOR ? Math.min(similarity, 0.79) : 0;
}
