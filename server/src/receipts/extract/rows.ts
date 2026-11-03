import { amountsIn, moneyIn } from './amounts.js';
import { withoutCurrencyMarks } from './currency.js';
import { countMatches, foldForMatch, LATIN_LETTER, normalizeText, RTL_LETTER } from './normalize.js';
import type { KeywordSet } from './keywords.js';
import { CARD_SLIP, hasKeyword, SUBTOTAL, TOTAL, UNIT, VAT } from './keywords.js';
import type { OcrLine, Row, RowPart } from './types.js';

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
  const parts = ordered.flatMap((s): RowPart[] => {
    const partText = normalizeText(s.text);
    return partText ? [{ text: partText, folded: foldForMatch(partText), conf: s.conf }] : [];
  });
  return { text, folded: foldForMatch(text), conf: Math.min(...draft.segments.map((s) => s.conf)), parts };
}

/** MUT-540 (E1, E3): the labels whose amount matters to the money read: a total, a card slip, a subtotal or the VAT. */
const MONEY_LABEL: KeywordSet = [...TOTAL, ...CARD_SLIP, ...SUBTOTAL, ...VAT];

/**
 * MUT-540 (E1, D11): a thermal printer's decimal point that OCR read as a comma (`184,36`). Two digits after a comma
 * are never a thousands group. Only on money-label and amount-only rows: a litres or price-per-litre row
 * (`35,12 ליטרים`, `סה"כ ליטרים 35,12`, `המחיר לליטר 7,31`) keeps its comma, so it never becomes an amount the total's
 * arithmetic would use.
 */
const COMMA_DECIMAL = /(?<![\d,.])(\d{1,6}),(\d{2})(?![\d,])/g;

/** MUT-540 (E3): a label and the amount printed under it are one line when the gap is at most this many row heights. */
const LABEL_GAP_ROWS = 1.5;
/** MUT-540 (review): an amount OCR garbled with letter O's (`3OO.OO`): still an amount, so the label has its own. */
const GARBLED_AMOUNT = /[0-9O]+[.,][0-9O]{2}(?![0-9O])/;

/** A money label's row: a total, card-slip, subtotal or VAT label, never one naming a quantity's unit (litres). */
function isMoneyLabel(row: Row): boolean {
  return hasKeyword(row.folded, MONEY_LABEL) && !hasKeyword(row.folded, UNIT);
}

/** MUT-540 (review): the label row prints an amount of its own: any decimal, whole or garbled one, or a whole number of
 * two digits or more. A single digit beside a thermal label is a speck. */
function hasOwnAmount(row: Row): boolean {
  return GARBLED_AMOUNT.test(row.text) || amountsIn(row.text, null).some((a) => a.decimal || a.minor >= 1000n);
}

interface PlacedRow {
  row: Row;
  top: number;
  bottom: number;
}

/** MUT-540 (E3): whether the row holds nothing but numbers, separators and currency marks (`184,36`, `63.25 ש"ח`). */
function isAmountOnly(row: Row): boolean {
  return /\d/.test(row.text) && !/[^\d.,:*\s-]/u.test(withoutCurrencyMarks(row.folded));
}

function withCommaDecimals(row: Row): Row {
  const fix = (text: string) => text.replace(COMMA_DECIMAL, '$1.$2');
  return { ...row, text: fix(row.text), folded: fix(row.folded), parts: row.parts.map((p) => ({ ...p, text: fix(p.text), folded: fix(p.folded) })) };
}

/**
 * MUT-540 (E3, D12): a money label printed alone, with its amount on the line under it (a card slip's `סכום עסקה :`
 * over `184.36`), becomes one row, label then amount. Only when the label row has no decimal amount of its own (a bare
 * digit beside a thermal label is a speck) and the next row holds exactly one decimal amount and nothing else: a VAT
 * table's header over its row of numbers stays two rows.
 */
function joinLabelAbove(placed: readonly PlacedRow[]): Row[] {
  const out: Row[] = [];
  // MUT-540 (review): an amount-only row that joined no label, just above this one: the amounts ride higher than their
  // labels (a tilted or curled photo), so the row under this label is the next label's amount, not this one's.
  let orphanAbove: PlacedRow | null = null;
  for (let i = 0; i < placed.length; i += 1) {
    const current = placed[i]!;
    const { row, top, bottom } = current;
    const next = placed[i + 1];
    const ridingHigh = orphanAbove !== null && top - orphanAbove.bottom <= LABEL_GAP_ROWS * (bottom - top);
    const joins =
      next !== undefined &&
      isMoneyLabel(row) &&
      !hasOwnAmount(row) &&
      !ridingHigh &&
      isAmountOnly(next.row) &&
      moneyIn(next.row.text, null, false).length === 1 &&
      next.top - bottom <= LABEL_GAP_ROWS * (bottom - top);
    if (!joins) {
      out.push(row);
      orphanAbove = isAmountOnly(row) ? current : null;
      continue;
    }
    orphanAbove = null;
    const text = `${row.text} ${next.row.text}`;
    out.push({ text, folded: foldForMatch(text), conf: Math.min(row.conf, next.row.conf), parts: [...row.parts, ...next.row.parts] });
    i += 1;
  }
  return out;
}

/**
 * MUT-441: OCR boxes into rows in reading order. Boxes that overlap vertically are one row (a label box and its
 * amount box sit apart on the same printed line), its boxes in logical order for its script; rows top to bottom.
 * MUT-540: a comma decimal on a money-label or amount-only row is read as a point (E1), and a money label printed
 * alone joins the amount on the line under it (E3).
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
  const placed = drafts
    .sort((a, b) => a.top - b.top)
    .flatMap((d): PlacedRow[] => {
      const row = toRow(d);
      if (!row) return [];
      return [{ row: isMoneyLabel(row) || isAmountOnly(row) ? withCommaDecimals(row) : row, top: d.top, bottom: d.bottom }];
    });
  return joinLabelAbove(placed);
}

/** A PDF's text layer: one row per line, in its own order, at full confidence (it is the document's text, not a reading). */
export function pdfRows(text: string): Row[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const normalized = normalizeText(line);
    if (!normalized) return [];
    const folded = foldForMatch(normalized);
    return [{ text: normalized, folded, conf: 1, parts: [{ text: normalized, folded, conf: 1 }] }];
  });
}

/**
 * MUT-504: how sure the reader was of what `matches` finds on the row: its most confident box that matches; the row's
 * own (least) confidence when no single box holds it (a value OCR split across two boxes).
 */
export function confOf(row: Row, matches: (part: RowPart) => boolean): number {
  const found = row.parts.filter(matches);
  return found.length ? Math.max(...found.map((p) => p.conf)) : row.conf;
}

/** The confidence of the box holding a keyword of `set` (a label), else the row's. */
export function labelConf(row: Row, set: KeywordSet): number {
  return confOf(row, (p) => hasKeyword(p.folded, set));
}
