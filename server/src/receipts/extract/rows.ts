import { countMatches, foldForMatch, LATIN_LETTER, normalizeText, RTL_LETTER } from './normalize.js';
import type { OcrLine, Row } from './types.js';

/** Two boxes share a row when their vertical overlap is at least this share of the shorter one. */
const SAME_ROW_OVERLAP = 0.5;

interface RowDraft {
  top: number;
  bottom: number;
  segments: OcrLine[];
}

function overlapShare(a: { top: number; bottom: number }, b: { top: number; bottom: number }): number {
  const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  const shorter = Math.min(a.bottom - a.top, b.bottom - b.top);
  return shorter > 0 ? overlap / shorter : 0;
}

function isRightToLeft(segments: readonly OcrLine[]): boolean {
  let rtl = 0;
  let ltr = 0;
  for (const s of segments) {
    rtl += countMatches(s.text, RTL_LETTER) + (s.script === 'arab' || s.script === 'hebr' ? 1 : 0);
    ltr += countMatches(s.text, LATIN_LETTER) + (s.script === 'latn' ? 1 : 0);
  }
  return rtl > ltr;
}

function toRow(draft: RowDraft): Row | null {
  const rtl = isRightToLeft(draft.segments);
  // Logical order: a right-to-left row reads from its rightmost box; a left-to-right one from its leftmost.
  const ordered = [...draft.segments].sort((a, b) => (rtl ? b.box[2] - a.box[2] : a.box[0] - b.box[0]));
  const text = normalizeText(ordered.map((s) => s.text).join(' '));
  if (!text) return null;
  return { text, folded: foldForMatch(text), conf: Math.min(...draft.segments.map((s) => s.conf)) };
}

/**
 * MUT-441: OCR boxes into rows in reading order. Boxes that overlap vertically are one row (a label box and its
 * amount box sit apart on the same printed line), its boxes in logical order for its script; rows top to bottom.
 */
export function orderedRows(lines: readonly OcrLine[]): Row[] {
  const drafts: RowDraft[] = [];
  const byMiddle = [...lines].filter((l) => l.text.trim()).sort((a, b) => a.box[1] + a.box[3] - (b.box[1] + b.box[3]));
  for (const line of byMiddle) {
    const span = { top: line.box[1], bottom: line.box[3] };
    const row = drafts.find((d) => overlapShare(d, span) >= SAME_ROW_OVERLAP);
    if (row) {
      row.segments.push(line);
      row.top = Math.min(row.top, span.top);
      row.bottom = Math.max(row.bottom, span.bottom);
    } else drafts.push({ ...span, segments: [line] });
  }
  return drafts.sort((a, b) => a.top - b.top).flatMap((d) => toRow(d) ?? []);
}

/** A PDF's text layer: one row per line, in its own order, at full confidence (it is the document's text, not a reading). */
export function pdfRows(text: string): Row[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const normalized = normalizeText(line);
    return normalized ? [{ text: normalized, folded: foldForMatch(normalized), conf: 1 }] : [];
  });
}
