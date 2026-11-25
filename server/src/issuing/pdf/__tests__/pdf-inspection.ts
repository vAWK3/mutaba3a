/**
 * MUT-640: ported from Malafat (crm-platform/apps/web/src/test-utils/pdf-inspection.ts, MAL-64), plus the colours a
 * page paints with. Read a generated PDF back the way a reader sees it.
 *
 * Two questions a byte-count assertion cannot answer:
 *
 * 1. Did any glyph render as a box? Every font our generators embed is a
 *    Type0 font with Identity-H encoding, so the content stream names glyphs by
 *    id and glyph 0 is always `.notdef` — the tofu box. A font that lacks a
 *    character draws glyph 0 silently; nothing throws. We count those.
 * 2. Where did the words land? pdfjs gives each drawn run with its position,
 *    so right-to-left order is checked by x, not by trusting the input order.
 */
import type {
  PDFRawStream} from 'pdf-lib';
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  type PDFPage,
} from 'pdf-lib';

export interface NotdefHit {
  page: number;
  font: string;
  count: number;
}

export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
}

export interface PdfInspection {
  pageCount: number;
  notdefGlyphs: NotdefHit[];
  pages: PdfTextItem[][];
  /** Every RGB fill or stroke colour the content streams set, as #rrggbb. */
  colours: string[];
}

const GLYPH_HEX_WIDTH = 4;
const NOTDEF_GLYPH = "0000";
const SAME_LINE_TOLERANCE = 2;

// A font selection, a TJ array, or a Tj string — in stream order.
const TEXT_OPERATORS =
  /\/([^\s/<>[\]()]+)\s+[-\d.]+\s+Tf|\[((?:\s*(?:<[0-9a-fA-F\s]*>|[-\d.]+))*)\s*\]\s*TJ|<([0-9a-fA-F\s]*)>\s*Tj/g;

export async function inspectPdf(bytes: Uint8Array): Promise<PdfInspection> {
  const doc = await PDFDocument.load(bytes);
  const notdefGlyphs = doc.getPages().flatMap((page, index) => findNotdefGlyphs(doc, page, index + 1));
  const pages = await extractPositionedText(bytes);
  const colours = [...new Set(doc.getPages().flatMap((page) => readColours(readContentStreams(doc, page))))];
  return { pageCount: doc.getPageCount(), notdefGlyphs, pages, colours };
}

const COLOUR_OPERATOR = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(?:rg|RG)\b/g;

function readColours(stream: string): string[] {
  const hex = (v: string) => Math.round(Number(v) * 255).toString(16).padStart(2, '0');
  return [...stream.matchAll(COLOUR_OPERATOR)].map((m) => `#${hex(m[1]!)}${hex(m[2]!)}${hex(m[3]!)}`);
}

/**
 * The visible tokens on the line that contains `anchor`, left to right.
 * Spaces are dropped; each token is one drawn run as pdfjs extracts it.
 */
export function lineTokensLeftToRight(items: PdfTextItem[], anchor: string): string[] {
  const anchorItem = items.find((item) => item.str.includes(anchor));
  if (!anchorItem) {
    throw new Error(`"${anchor}" is not on this page. Page text: ${items.map((i) => i.str).join("")}`);
  }
  return items
    .filter((item) => Math.abs(item.y - anchorItem.y) < SAME_LINE_TOLERANCE && item.str.trim())
    .sort((a, b) => a.x - b.x)
    .map((item) => item.str.trim());
}

/** All of a page's text, in drawing order, for containment checks. */
export function pageText(items: PdfTextItem[]): string {
  return items.map((item) => item.str).join("");
}

function findNotdefGlyphs(doc: PDFDocument, page: PDFPage, pageNumber: number): NotdefHit[] {
  const fontTypes = readFontTypes(doc, page);
  const counts = new Map<string, number>();
  let currentFont = "";

  for (const match of readContentStreams(doc, page).matchAll(TEXT_OPERATORS)) {
    const [, fontName, tjArray, tjString] = match;
    if (fontName) {
      currentFont = fontName;
      continue;
    }
    const font = fontTypes.get(currentFont);
    if (!font?.isTwoByte) continue;

    const hexStrings = tjString !== undefined ? [tjString] : [...(tjArray ?? "").matchAll(/<([0-9a-fA-F\s]*)>/g)].map((m) => m[1]);
    const notdefs = hexStrings.reduce((sum, hex) => sum + countNotdefs(hex ?? ""), 0);
    if (notdefs > 0) counts.set(font.baseFont, (counts.get(font.baseFont) ?? 0) + notdefs);
  }

  return [...counts].map(([font, count]) => ({ page: pageNumber, font, count }));
}

function countNotdefs(hex: string): number {
  const glyphs = hex.replace(/\s/g, "");
  let count = 0;
  for (let i = 0; i < glyphs.length; i += GLYPH_HEX_WIDTH) {
    if (glyphs.slice(i, i + GLYPH_HEX_WIDTH) === NOTDEF_GLYPH) count += 1;
  }
  return count;
}

function readFontTypes(doc: PDFDocument, page: PDFPage): Map<string, { baseFont: string; isTwoByte: boolean }> {
  const fonts = new Map<string, { baseFont: string; isTwoByte: boolean }>();
  const fontDict = page.node.Resources()?.lookupMaybe(PDFName.of("Font"), PDFDict);
  for (const [name, ref] of fontDict?.entries() ?? []) {
    const dict = ref instanceof PDFRef ? doc.context.lookup(ref, PDFDict) : (ref as PDFDict);
    fonts.set(name.decodeText(), {
      baseFont: dict.lookup(PDFName.of("BaseFont"))?.toString() ?? "unknown",
      isTwoByte: dict.lookup(PDFName.of("Subtype"))?.toString() === "/Type0",
    });
  }
  return fonts;
}

function readContentStreams(doc: PDFDocument, page: PDFPage): string {
  const contents = page.node.Contents();
  if (!contents) return "";
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
  return streams
    .map((stream) => Buffer.from(decodePDFRawStream(stream as PDFRawStream).decode()).toString("latin1"))
    .join("\n");
}

async function extractPositionedText(bytes: Uint8Array): Promise<PdfTextItem[][]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdfjs detaches the buffer it is given; hand it a copy so callers keep theirs.
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, verbosity: 0 }).promise;
  try {
    const pages: PdfTextItem[][] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const content = await (await pdf.getPage(pageNumber)).getTextContent();
      pages.push(
        content.items
          .filter((item) => "str" in item)
          .map((item) => ({ str: item.str, x: item.transform[4], y: item.transform[5] })),
      );
    }
    return pages;
  } finally {
    await pdf.destroy();
  }
}
