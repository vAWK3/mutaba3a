import { printPdf } from '../../pdf/print.js';
import type { IssuedDocumentRecord } from '../../repositories/ports.js';
import { buildViewModel, INKS, type PdfRenderOptions } from './model.js';
import { layoutDocument, styleOf } from './styles.js';

/**
 * MUT-640: an issued document as a PDF. The style and ink are the document's own (snapshotted at issue), never the
 * profile's current setting, so every later copy prints exactly like the original.
 */
/** MUT-646: a logo the engine can draw. A broken file takes the decoder seconds to give up on, so it's tried once, at upload. */
export async function logoPrints(bytes: Uint8Array): Promise<boolean> {
  const png = bytes[0] === 0x89;
  try {
    await printPdf({ content: [{ image: `data:image/${png ? 'png' : 'jpeg'};base64,${Buffer.from(bytes).toString('base64')}`, fit: [16, 16] }] });
    return true;
  } catch {
    return false;
  }
}

export function renderIssuedDocumentPdf(doc: IssuedDocumentRecord, options: PdfRenderOptions): Promise<Buffer> {
  const ink = doc.ink === 'BLUE' ? INKS.BLUE : INKS.BLACK;
  return printPdf(layoutDocument(buildViewModel(doc, ink, options), styleOf(doc.style)));
}
