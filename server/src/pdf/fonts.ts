import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fontkitModule from '@pdf-lib/fontkit';

/**
 * MUT-640: the PDF fonts, ported from Malafat's engine (crm-platform/packages/pdf, ADR-168 there). No one file draws
 * Latin, Hebrew, Arabic and ₪, so text is split into runs by each font's own cmap: a character goes to the first family
 * of the style's chain that has its glyph, and never draws `.notdef` (the empty box) while any bundled font has it.
 * The Latin and Hebrew fonts are SIL OFL (licences beside them in server/assets/fonts/pdf); Thmanyah is the brand face the
 * portal already ships (src/assets/fonts).
 */
export const PDF_FONT_FAMILIES = {
  FrankRuhl: { normal: 'FrankRuhlLibre-Regular.ttf', bold: 'FrankRuhlLibre-Bold.ttf' },
  PlexLatin: { normal: 'IBMPlexSans-Regular.ttf', bold: 'IBMPlexSans-SemiBold.ttf' },
  PlexHebrew: { normal: 'IBMPlexSansHebrew-Regular.ttf', bold: 'IBMPlexSansHebrew-SemiBold.ttf' },
  Assistant: { normal: 'Assistant-Regular.ttf', bold: 'Assistant-SemiBold.ttf' },
  // Arabic is Thmanyah, Mutaba3a's brand face: of the Arabic fonts tried (Noto Naskh, Noto Sans Arabic, IBM Plex Sans
  // Arabic) it is the one whose shaped text extracts back word for word (the MUT-640 gate; Malafat MAL-1008).
  ThmanyahSerif: { normal: 'thmanyah-serif-display-regular.otf', bold: 'thmanyah-serif-display-bold.otf' },
  ThmanyahSans: { normal: 'thmanyahsans-Regular.otf', bold: 'thmanyahsans-Bold.otf' },
} as const;

export type PdfFontFamily = keyof typeof PDF_FONT_FAMILIES;

/** The last resort of every chain: IBM Plex Sans Hebrew draws Latin, Hebrew and ₪. */
const FALLBACK: PdfFontFamily = 'PlexHebrew';

const FONT_DIR_OVERRIDE = 'PDF_FONT_DIR';
const REQUIRED = [...new Set(Object.values(PDF_FONT_FAMILIES).flatMap((f) => [f.normal, f.bold]))];

/**
 * The folder holding the fonts: PDF_FONT_DIR, else `assets/fonts/pdf` beside the server package (source in dev and
 * tests, `dist` in the image: the Dockerfile copies `assets/` next to it). A folder counts only if every file is there.
 */
export function resolveFontDir(env: Record<string, string | undefined> = process.env): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = env[FONT_DIR_OVERRIDE] ? [env[FONT_DIR_OVERRIDE]!] : [path.resolve(here, '../../assets/fonts/pdf'), path.resolve(here, '../../../assets/fonts/pdf'), '/app/assets/fonts/pdf'];
  const found = candidates.find((dir) => REQUIRED.every((file) => existsSync(path.join(dir, file))));
  if (!found) throw new Error(`PDF fonts not found in: ${candidates.join(', ')}. Set ${FONT_DIR_OVERRIDE}.`);
  return found;
}

let fontDir: string | null = null;
const dir = () => (fontDir ??= resolveFontDir());

/** pdfmake's font dictionary. No italic faces are bundled; italics fall back to upright. */
export function fontDictionary(): Record<string, { normal: string; bold: string; italics: string; bolditalics: string }> {
  return Object.fromEntries(
    Object.entries(PDF_FONT_FAMILIES).map(([family, faces]) => {
      const normal = path.join(dir(), faces.normal);
      const bold = path.join(dir(), faces.bold);
      return [family, { normal, bold, italics: normal, bolditalics: bold }];
    }),
  );
}

const fontkit: typeof fontkitModule = (fontkitModule as unknown as { default?: typeof fontkitModule }).default ?? fontkitModule;
const parsed = new Map<PdfFontFamily, fontkitModule.Font>();

function familyHasGlyph(family: PdfFontFamily, codePoint: number): boolean {
  let font = parsed.get(family);
  if (!font) {
    font = fontkit.create(readFileSync(path.join(dir(), PDF_FONT_FAMILIES[family].normal))) as fontkitModule.Font;
    parsed.set(family, font);
  }
  return font.hasGlyphForCodePoint(codePoint);
}

export interface TextRun {
  text: string;
  font: PdfFontFamily;
}

const JOINING = /^[\p{M}\u200C\u200D]$/u;
const WHITESPACE = /^\s$/u;

/** NFC, control characters out (newlines and tabs become spaces), odd spaces normalised. Order stays logical. */
export function sanitize(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\p{C}/gu, (c) => (c === '\n' || c === '\r' || c === '\t' ? ' ' : ''))
    .replace(/[\u2000-\u200A]/g, ' ');
}

/**
 * Split text into runs each drawn by a family that has every glyph in it, trying `chain` in order and then the
 * fallback. A character stays in the chain's first family whenever it has it; combining marks stay with their letter.
 */
export function fontRuns(text: string, chain: readonly PdfFontFamily[]): TextRun[] {
  const families = [...chain, FALLBACK];
  const runs: TextRun[] = [];
  for (const char of sanitize(text)) {
    const current = runs.at(-1);
    const code = char.codePointAt(0) ?? 0;
    const stays = current && (JOINING.test(char) || (WHITESPACE.test(char) && familyHasGlyph(current.font, code)));
    const font = stays ? current.font : (families.find((f) => familyHasGlyph(f, code)) ?? current?.font ?? families[0]!);
    if (current?.font === font) current.text += char;
    else runs.push({ text: char, font });
  }
  return runs;
}
