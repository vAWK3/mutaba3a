/**
 * MUT-569 (ADR-270): the uniform file's field formats (spec 1.31 §2.3–2.4) and its character set. Pure.
 *
 * The file is ISO-8859-8 in logical order (A000 1029 = 1), one byte per character, so a field's width in characters is
 * its width in bytes. Every text value goes through `toFileText` first: ASCII and Hebrew letters stay; Hebrew points
 * and direction marks go; typographic punctuation becomes ASCII; Arabic is written in Hebrew letters (D2, the set has
 * no Arabic), with Arabic-Indic digits as ASCII digits; anything else becomes `?`.
 */

const HEBREW_ALEF = 0x05d0;
const HEBREW_TAV = 0x05ea;
const ISO_HEBREW_BASE = 0xe0;

/** Arabic letter → Hebrew letters, as Israeli systems write Arab names (a geresh marks ج خ ذ ض ظ غ ث). */
const ARABIC_TO_HEBREW: Readonly<Record<string, string>> = {
  'ء': 'א', 'آ': 'א', 'أ': 'א', 'ؤ': 'ו', 'إ': 'א', 'ئ': 'י', 'ا': 'א', 'ب': 'ב', 'ة': 'ה', 'ت': 'ת', 'ث': "ת'",
  'ج': "ג'", 'ح': 'ח', 'خ': "ח'", 'د': 'ד', 'ذ': "ד'", 'ر': 'ר', 'ز': 'ז', 'س': 'ס', 'ش': 'ש', 'ص': 'צ', 'ض': "צ'",
  'ط': 'ט', 'ظ': "ט'", 'ع': 'ע', 'غ': "ע'", 'ف': 'פ', 'ق': 'ק', 'ك': 'כ', 'ل': 'ל', 'م': 'מ', 'ن': 'נ', 'ه': 'ה',
  'و': 'ו', 'ى': 'י', 'ي': 'י', 'ٱ': 'א', 'پ': 'פ', 'چ': "צ'", 'ڤ': 'ו', 'گ': 'ג', 'ک': 'כ', 'ی': 'י', 'ـ': '',
};

const FINAL_FORMS: Readonly<Record<string, string>> = { 'כ': 'ך', 'מ': 'ם', 'נ': 'ן', 'פ': 'ף', 'צ': 'ץ' };

const PUNCTUATION: Readonly<Record<string, string>> = {
  '׳': "'", '״': '"', '־': '-', '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-',
  '−': '-', '‘': "'", '’': "'", '‚': "'", '“': '"', '”': '"', '„': '"', ' ': ' ',
  ' ': ' ', ' ': ' ', ' ': ' ', '…': '...', '،': ',', '؛': ';', '؟': '?', '٪': '%',
  '٫': '.', '٬': ',', '₪': 'ש"ח',
};

const isArabicLetter = (ch: string) => ARABIC_TO_HEBREW[ch] !== undefined;
const isDropped = (cp: number) =>
  (cp >= 0x0591 && cp <= 0x05c7 && cp !== 0x05be) || // Hebrew points and cantillation
  (cp >= 0x064b && cp <= 0x065f) || cp === 0x0670 || // Arabic harakat, superscript alef
  (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) || cp === 0xfeff;

function arabicIndicDigit(cp: number): string | null {
  if (cp >= 0x0660 && cp <= 0x0669) return String(cp - 0x0660);
  if (cp >= 0x06f0 && cp <= 0x06f9) return String(cp - 0x06f0);
  return null;
}

/** One character of non-Arabic text in the file's set, or `?`. */
function plainChar(ch: string): string {
  const cp = ch.codePointAt(0)!;
  if (cp < 0x20 || cp === 0x7f) return ' ';
  if (cp < 0x7f) return ch;
  if (cp >= HEBREW_ALEF && cp <= HEBREW_TAV) return ch;
  const mapped = PUNCTUATION[ch];
  if (mapped !== undefined) return mapped;
  const digit = arabicIndicDigit(cp);
  if (digit !== null) return digit;
  const stripped = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  return /^[\x20-\x7e]+$/.test(stripped) ? stripped : '?';
}

/** A run of Arabic letters in Hebrew letters; its last letter takes its final form (it ends the word). */
function transliterateRun(run: string[]): string {
  const hebrew = run.map((ch) => ARABIC_TO_HEBREW[ch]!).join('');
  const lastLetter = hebrew.endsWith("'") ? hebrew.length - 2 : hebrew.length - 1;
  const final = FINAL_FORMS[hebrew[lastLetter] ?? ''];
  return final ? hebrew.slice(0, lastLetter) + final + hebrew.slice(lastLetter + 1) : hebrew;
}

/** Any text as the file can hold it (see the file comment). */
export function toFileText(text: string): string {
  let out = '';
  let run: string[] = [];
  const flush = () => {
    if (run.length) out += transliterateRun(run);
    run = [];
  };
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (isDropped(cp)) continue;
    if (isArabicLetter(ch)) {
      run.push(ch);
      continue;
    }
    flush();
    out += plainChar(ch);
  }
  flush();
  return out;
}

/**
 * A value too wide for its field: a document whose amount the file can't hold (over 10^12 shekels). The export turns it
 * into a 422 naming the document rather than writing a wrong file.
 */
export class FieldOverflowError extends RangeError {}

/**
 * A finished line as ISO-8859-8 bytes. Throws on a character `toFileText` would have replaced (a missed field).
 * Plain `Uint8Array`, no Node `Buffer`: these routes also run in the signed-out portal (MUT-286 platform shims).
 */
export function encodeLine(line: string): Uint8Array {
  const bytes = new Uint8Array(line.length);
  for (let i = 0; i < line.length; i += 1) {
    const cp = line.charCodeAt(i);
    if (cp >= 0x20 && cp < 0x7f) bytes[i] = cp;
    else if (cp >= HEBREW_ALEF && cp <= HEBREW_TAV) bytes[i] = ISO_HEBREW_BASE + (cp - HEBREW_ALEF);
    else throw new RangeError(`uniform file: character U+${cp.toString(16).padStart(4, '0')} is outside ISO-8859-8`);
  }
  return bytes;
}

/** Alphanumeric (X): left-aligned, space-padded, cut to the width (spec §2.3 ה). */
export function alpha(value: string | null | undefined, width: number): string {
  const text = toFileText((value ?? '').trim());
  return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);
}

/** Numeric (9): digits only, right-aligned, zero-padded. A value that doesn't fit is a bug, never cut. */
export function numeric(value: string | number | bigint | null | undefined, width: number): string {
  const digits = value === null || value === undefined ? '' : String(value);
  if (!/^\d*$/.test(digits)) throw new RangeError(`uniform file: "${digits}" is not a number`);
  if (digits.length > width) throw new FieldOverflowError(`uniform file: ${digits} is wider than ${width}`);
  return digits.padStart(width, '0');
}

function signed(value: bigint, width: number): string {
  const digits = (value < 0n ? -value : value).toString();
  if (digits.length > width - 1) throw new FieldOverflowError(`uniform file: ${value} is wider than ${width}`);
  return (value < 0n ? '-' : '+') + digits.padStart(width - 1, '0');
}

/** A signed amount in agorot, two implied decimals (X9(n)v99): `+00000000123456` is 1,234.56. */
export function amount(minor: bigint, width: number): string {
  return signed(minor, width);
}

/** A signed quantity, four implied decimals (X9(12)v9999), from thousandths. */
export function quantity(milli: bigint, width: number): string {
  return signed(milli * 10n, width);
}

/** `YYYY-MM-DD` → `YYYYMMDD`. */
export function isoDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError(`uniform file: "${date}" is not a date`);
  return date.replace(/-/g, '');
}
