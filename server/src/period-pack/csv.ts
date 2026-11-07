/**
 * MUT-314 (D17, D23): the one CSV a period download writes, the receipts zip's `index.csv`. UTF-8 with a BOM (so Excel
 * reads Arabic and Hebrew), RFC 4180 quoting, CRLF line ends, and the OWASP formula guard on text cells. Amounts are
 * passed `raw`: a negative amount must stay a number.
 */
export type CsvCell = string | { text: string } | { raw: string };

const BOM = '﻿';
const FORMULA_START = /^[=+\-@\t\r]/;

/** A text cell a spreadsheet would run as a formula gets a leading apostrophe. */
export function guardFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

function field(cell: CsvCell): string {
  const value = typeof cell === 'string' ? guardFormula(cell) : 'text' in cell ? guardFormula(cell.text) : cell.raw;
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function csvDocument(rows: ReadonlyArray<ReadonlyArray<CsvCell>>): string {
  return BOM + rows.map((row) => row.map(field).join(',') + '\r\n').join('');
}
