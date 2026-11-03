import { readFileSync } from 'node:fs';
import { learnedBuyerIds, type ReadIdentifiers } from '../receipts/extract/buyer.js';
import { readReceipt } from '../receipts/extract/extract.js';
import type { OcrLine } from '../receipts/extract/types.js';

/**
 * MUT-441 benchmark (server/ocr/bench/run.py): runs the API's real extractor over the sidecar's responses.
 *
 *   tsx src/scripts/receipt-bench-extract.ts <reads.json> [--buyer-memory] [--no-lone-slip]
 *
 * Input: [{ id, result: { engine, lines, pdfText? }, receivedOn? }]. Output (stdout): [{ id, suggestion }], the same
 * ReceiptSuggestion the read job would merge. MUT-514: `receivedOn` is passed as the upload day, and with
 * `--buyer-memory` the reads are one organization's in scan order: each is given the buyer numbers learned from the
 * reads before it (R4, never from later ones), as the read job learns from earlier receipts. Local benchmark only;
 * nothing here is logged or sent anywhere.
 */
interface BenchRead {
  id: string;
  result: { engine: string; lines?: OcrLine[]; pdfText?: string | null };
  receivedOn?: string;
}

const path = process.argv[2];
if (!path) {
  process.stderr.write('usage: receipt-bench-extract.ts <reads.json> [--buyer-memory]\n');
  process.exit(2);
}
const buyerMemory = process.argv.includes('--buyer-memory');
/** MUT-540 (D8): without the lone card-slip rule, so the benchmark can measure it alone. */
const loneCardSlip = !process.argv.includes('--no-lone-slip');
const reads = JSON.parse(readFileSync(path, 'utf8')) as BenchRead[];
const earlier: ReadIdentifiers[] = [];
const out = reads.map(({ id, result, receivedOn }) => {
  const reading = readReceipt({ lines: result.lines ?? [], pdfText: result.pdfText ?? null }, { readerVersion: `bench-${result.engine}`, receivedOn, buyerIds: buyerMemory ? learnedBuyerIds(earlier) : [], loneCardSlip });
  earlier.push({ buyer: reading.buyerIdentifiers, vendor: reading.vendorIdentifiers });
  return { id, suggestion: reading.suggestion };
});
process.stdout.write(JSON.stringify(out));
