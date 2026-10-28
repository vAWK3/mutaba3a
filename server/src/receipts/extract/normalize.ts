/** MUT-441: text normalisation before any field rule runs. Pure. */

const BIDI_MARKS = /[‎‏‪-‮⁦-⁩؜]/g;
const TATWEEL = /ـ/g;
const ARABIC_DIACRITICS = /[ً-ْٰ]/g;
const ARABIC_INDIC_DIGITS = /[٠-٩]/g;
const PERSIAN_DIGITS = /[۰-۹]/g;

/**
 * The Arabic comma (،) squeezed between digits, with two or three digits after it: PP-OCR's Arabic recogniser prints
 * the Arabic decimal mark (٫) this way (MUT-441 benchmark). A listing comma has a space after it, so it stays.
 */
const ARABIC_COMMA_DECIMAL = /(\d)،(\d{2,3})(?!\d)/g;

/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits to 0-9. */
export function normalizeDigits(text: string): string {
  return text
    .replace(ARABIC_INDIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(PERSIAN_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * Bidi marks and tatweel out; the Arabic decimal (٫) and thousands (٬) marks, Hebrew geresh and gershayim and curly
 * quotes to their ASCII forms; every digit to 0-9; runs of space to one.
 */
export function normalizeText(text: string): string {
  return normalizeDigits(
    text
      .replace(BIDI_MARKS, '')
      .replace(TATWEEL, '')
      .replace(/٫/g, '.')
      .replace(/٬/g, ',')
      .replace(/[״“”]|''/g, '"')
      .replace(/[׳‘’]/g, "'"),
  )
    .replace(ARABIC_COMMA_DECIMAL, '$1.$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * For keyword matching only: lower case, Arabic diacritics out, alef variants (آ أ إ) to ا, and the lam-meem order a
 * PDF text layer can produce (`املشتغل` for `المشتغل`, MUT-253 spike) put back at a word start.
 */
export function foldForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[آأإ]/g, 'ا')
    .replace(/(^|[^\p{L}])امل/gu, '$1الم');
}

/** Letters of right-to-left scripts (Hebrew, Arabic). */
export const RTL_LETTER = /[֐-׿؀-ۿ]/g;
export const LATIN_LETTER = /[A-Za-z]/g;

export function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}
