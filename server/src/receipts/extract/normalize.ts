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

/** MUT-504: Tesseract reads the ע of מע"מ (VAT) as צ on Israeli bills. No Hebrew word is spelled מצ"מ. */
const VAT_MISREAD = /(^|[^\p{L}])מצ"מ(?![\p{L}])/gu;

/**
 * MUT-514: a thermal font's final י and א read as a geresh before VAT (`לפנ' מע"מ`, `לל' מע"מ`, the amount often glued
 * on): "before VAT" and "without VAT". Only before מע"מ, where no other word is spelled so.
 */
const BEFORE_VAT_MISREAD = /(^|[^\p{L}])(לפנ|לל)'(?=\s*מע"מ)/gu;

/**
 * MUT-540 (E2): the same thermal yod read as a geresh inside a word (`סכום ע'סקה` for `סכום עיסקה`). A geresh between
 * two Hebrew letters is a yod, except after the letters Hebrew writes a geresh after to spell another sound: ג ז צ ת in
 * loanwords (ג'ינס, צ'יפס) and ח ד ט ר in Arabic names (ח'ליל, ד'אוד). A geresh ending a word (מס', רח') stays.
 */
const YOD_MISREAD = /(?<![א-ת])([א-ת]*[אבהויכךלמםנןסעפףץקש])'(?=[א-ת])/gu;

/**
 * MUT-540 (review): abbreviations a geresh ends (מס' עוסק, טל' נייד, רח' הרצל, יח'); OCR often drops the space after
 * it, and folding its geresh to a yod would glue it to the next word (`מסיעוסק`), losing that word's label.
 */
const GERESH_ABBREVIATIONS = new Set(['מס', 'מספ', 'טל', 'רח', 'יח', 'מח', 'פל', 'שכ', 'גב', 'ת"ז']);

/**
 * For keyword matching only: lower case, Arabic diacritics out, alef variants (آ أ إ) to ا, the lam-meem order a
 * PDF text layer can produce (`املشتغل` for `المشتغل`, MUT-253 spike) put back at a word start, VAT's common
 * misread `מצ"מ` put back as `מע"מ` (MUT-504), `לפנ'`/`לל'` before it as `לפני`/`ללא` (MUT-514), and a geresh inside
 * a word as the yod it is (MUT-540).
 */
export function foldForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[آأإ]/g, 'ا')
    .replace(/(^|[^\p{L}])امل/gu, '$1الم')
    .replace(VAT_MISREAD, '$1מע"מ')
    .replace(BEFORE_VAT_MISREAD, (_m, start: string, word: string) => `${start}${word === 'לפנ' ? 'לפני' : 'ללא'}`)
    .replace(YOD_MISREAD, (whole, word: string) => (GERESH_ABBREVIATIONS.has(word) ? whole : `${word}י`));
}

/** Letters of right-to-left scripts (Hebrew, Arabic). */
export const RTL_LETTER = /[֐-׿؀-ۿ]/g;
export const LATIN_LETTER = /[A-Za-z]/g;

export function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

const RTL_WORD = /[֐-׿؀-ۿ]/;
const LATIN_WORD = /[A-Za-z]/;
const UPPER_LATIN = /[A-Z]/;
/** MUT-631: a Latin run this short between two right-to-left words is OCR junk (`MAN`, `Aya`), not a brand. */
const EMBEDDED_LATIN_MAX_LETTERS = 3;

/**
 * MUT-631: whether OCR mixed Latin junk into a right-to-left line: a run of Latin words between two Hebrew or Arabic
 * words that is lowercase or at most three letters (`נפט בעמ MAN אלדור`, `בן dina קומפנ' בע"מ`). A Latin brand at
 * either end (`Partner פרטנר`) or a capitalised word inside (`שופרסל Deal רמת גן`) is a name. Non-global regexes: no
 * `lastIndex` carries between calls.
 */
export function hasEmbeddedLatin(text: string): boolean {
  const kinds = text.split(/\s+/).map((word) => {
    const rtl = RTL_WORD.test(word);
    const latin = LATIN_WORD.test(word);
    return { word, kind: rtl && !latin ? 'rtl' : latin && !rtl ? 'latin' : 'other' };
  }).filter((w) => w.kind !== 'other');
  for (let i = 1; i < kinds.length - 1; i += 1) {
    if (kinds[i]!.kind !== 'latin' || kinds[i - 1]!.kind !== 'rtl') continue;
    let end = i;
    while (end < kinds.length && kinds[end]!.kind === 'latin') end += 1;
    if (end >= kinds.length) return false;
    const run = kinds.slice(i, end).map((w) => w.word).join('');
    const letters = run.replace(/[^A-Za-z]/g, '');
    if (!UPPER_LATIN.test(run) || letters.length <= EMBEDDED_LATIN_MAX_LETTERS) return true;
    i = end;
  }
  return false;
}
