import type { OcrLine } from '../types.js';

/**
 * MUT-441: hand-built OCR output for the extractor tests. The MUT-253 fixture manifest has truth fields but no OCR
 * lines, so these stand in: what a reader returns for a receipt, line by line, top to bottom.
 */

const ROW_HEIGHT = 30;
const PAGE_WIDTH = 400;

/** One segment on a row: its text, where it sits across the page (0 = left edge), and how sure the reader was. */
export interface Segment {
  text: string;
  x?: number;
  conf?: number;
  script?: OcrLine['script'];
}

/** A receipt: each entry is one row, top to bottom; a string is one full-width segment, an array is several boxes on one row. */
export function receipt(rows: ReadonlyArray<string | Segment | readonly Segment[]>, defaults: { conf?: number } = {}): OcrLine[] {
  const lines: OcrLine[] = [];
  rows.forEach((row, index) => {
    const segments: readonly Segment[] = typeof row === 'string' ? [{ text: row }] : Array.isArray(row) ? row : [row as Segment];
    const y0 = 20 + index * ROW_HEIGHT;
    for (const s of segments) {
      const x0 = s.x ?? 10;
      const width = Math.min(PAGE_WIDTH - x0, 12 * s.text.length);
      lines.push({ text: s.text, conf: s.conf ?? defaults.conf ?? 0.95, box: [x0, y0, x0 + width, y0 + ROW_HEIGHT - 6], ...(s.script ? { script: s.script } : {}) });
    }
  });
  return lines;
}

/** Valid Israeli registration numbers (the ID check digit holds) and one that fails it. */
export const REG_VALID_COMPANY = '520022732';
export const REG_VALID_DEALER = '123456782';
export const REG_BAD_CHECK_DIGIT = '123456789';
