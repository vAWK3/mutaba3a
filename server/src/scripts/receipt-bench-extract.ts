import { readFileSync } from 'node:fs';
import { extractReceipt } from '../receipts/extract/extract.js';
import type { OcrLine } from '../receipts/extract/types.js';

/**
 * MUT-441 benchmark (server/ocr/bench/run.py): runs the API's real extractor over the sidecar's responses.
 *
 *   tsx src/scripts/receipt-bench-extract.ts <reads.json>
 *
 * Input: [{ id, result: { engine, lines, pdfText? } }]. Output (stdout): [{ id, suggestion }], the same
 * ReceiptSuggestion the read job would merge. Local benchmark only; nothing here is logged or sent anywhere.
 */
interface BenchRead {
  id: string;
  result: { engine: string; lines?: OcrLine[]; pdfText?: string | null };
}

const path = process.argv[2];
if (!path) {
  process.stderr.write('usage: receipt-bench-extract.ts <reads.json>\n');
  process.exit(2);
}
const reads = JSON.parse(readFileSync(path, 'utf8')) as BenchRead[];
const out = reads.map(({ id, result }) => ({
  id,
  suggestion: extractReceipt({ lines: result.lines ?? [], pdfText: result.pdfText ?? null }, { readerVersion: `bench-${result.engine}` }),
}));
process.stdout.write(JSON.stringify(out));
