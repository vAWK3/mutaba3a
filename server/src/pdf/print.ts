import PrinterModule from '@digicole/pdfmake-rtl/js/Printer.js';
import { fontDictionary } from './fonts.js';

/**
 * MUT-640: a pdfmake document definition to PDF bytes, through the patched pdfmake-rtl (server/patches, ported from
 * Malafat: every line declares `baseDirection`, tables carry `rtl` explicitly, numbers inside RTL runs keep their order).
 */
// A pdfmake document definition: plain data, typed loosely as the library ships no types.
export type DocDefinition = Record<string, unknown>;

interface PdfKitDocument {
  on(event: 'data', listener: (chunk: Uint8Array) => void): void;
  on(event: 'end', listener: () => void): void;
  on(event: 'error', listener: (error: unknown) => void): void;
  end(): void;
}
interface Printer {
  createPdfKitDocument(definition: DocDefinition): Promise<PdfKitDocument>;
}
type PrinterClass = new (fonts: ReturnType<typeof fontDictionary>) => Printer;

const PdfPrinter: PrinterClass = ((PrinterModule as { default?: PrinterClass }).default ?? PrinterModule) as PrinterClass;
let printer: Printer | null = null;

/**
 * Review fix 12: layout is synchronous CPU work; at most two documents render at once, the rest wait their turn, so a
 * burst of large documents can't stall every other request.
 */
const MAX_CONCURRENT_RENDERS = 2;
let rendering = 0;
const waiting: Array<() => void> = [];

export async function printPdf(definition: DocDefinition): Promise<Buffer> {
  if (rendering >= MAX_CONCURRENT_RENDERS) await new Promise<void>((resolve) => waiting.push(resolve));
  rendering += 1;
  try {
    return await render(definition);
  } finally {
    rendering -= 1;
    waiting.shift()?.();
  }
}

async function render(definition: DocDefinition): Promise<Buffer> {
  printer ??= new PdfPrinter(fontDictionary());
  const doc = await printer.createPdfKitDocument(definition);
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}
