import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString, type PDFDict } from 'pdf-lib';
import { buildSignedData, OID, sha256, type SigningKey } from './cms.js';
import { SigningSetupError } from './retry.js';
import type { Timestamper } from './timestamp.js';

/**
 * MUT-641 (ADR-265): a PDF signature (ISO 32000-1 §12.8, PAdES baseline B-T): an invisible signature field on the
 * first page whose /Contents holds a detached CAdES signature over every byte of the file except /Contents itself.
 * The signature panel in a reader names the signer from the certificate and shows /Reason, /Name and the time.
 */

/** Room for the CMS: a 4096-bit signature, a chain of four certificates and a time-stamp token with its own chain. */
export const SIGNATURE_BYTES = 24 * 1024;
const BYTE_RANGE_PLACEHOLDER = '**********';
const BYTE_RANGE_PATTERN = /\/ByteRange\s*\[\s*0\s+\/\*{10}\s+\/\*{10}\s+\/\*{10}\s*\]/g;

export interface SignatureDetails {
  /** The panel's reason, e.g. that the software signed on behalf of the business. */
  reason: string;
  /** Who the signature is for (the business), shown beside the certificate's own name. */
  name: string;
  location?: string;
  signedAt: Date;
}

/** The file with an empty signature dictionary: /ByteRange and /Contents hold placeholders of fixed length. */
async function withPlaceholder(pdf: Uint8Array, details: SignatureDetails): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const context = doc.context;
  const byteRange = PDFArray.withContext(context);
  byteRange.push(PDFNumber.of(0));
  for (let i = 0; i < 3; i += 1) byteRange.push(PDFName.of(BYTE_RANGE_PLACEHOLDER));
  const signature = context.register(
    context.obj({
      Type: 'Sig',
      Filter: 'Adobe.PPKLite',
      SubFilter: 'ETSI.CAdES.detached',
      ByteRange: byteRange,
      Contents: PDFHexString.of('0'.repeat(SIGNATURE_BYTES * 2)),
      Reason: PDFHexString.fromText(details.reason),
      Name: PDFHexString.fromText(details.name),
      ...(details.location ? { Location: PDFHexString.fromText(details.location) } : {}),
      M: PDFString.fromDate(details.signedAt),
    }),
  );
  const page = doc.getPage(0);
  const widget = context.register(
    context.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', Rect: [0, 0, 0, 0], V: signature, T: PDFHexString.fromText('MTB3A'), F: 132, P: page.ref }),
  );
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray) ?? context.obj([]);
  annots.push(widget);
  page.node.set(PDFName.of('Annots'), annots);
  const form: PDFDict = context.obj({ SigFlags: 3, Fields: [widget] });
  doc.catalog.set(PDFName.of('AcroForm'), form);
  // No object streams: the signature dictionary stays plain text, where its placeholders can be found and filled.
  return doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}

function only<T>(matches: T[], what: string): T {
  if (matches.length !== 1) throw new Error(`Expected one ${what} placeholder, found ${matches.length}`);
  return matches[0]!;
}

/** Signs a PDF. Throws (and returns nothing) when the key or the time-stamp authority fails: never an unsigned file. */
export async function signPdf(pdf: Uint8Array, details: SignatureDetails, key: SigningKey, timestamper: Timestamper): Promise<Uint8Array> {
  const prepared = await withPlaceholder(pdf, details);
  const text = Buffer.from(prepared).toString('latin1');
  const range = only([...text.matchAll(BYTE_RANGE_PATTERN)], '/ByteRange');
  const contentsHex = `<${'0'.repeat(SIGNATURE_BYTES * 2)}>`;
  const contentsStart = text.indexOf(contentsHex);
  if (contentsStart < 0 || text.indexOf(contentsHex, contentsStart + 1) >= 0) throw new Error('Expected one /Contents placeholder');
  const contentsEnd = contentsStart + contentsHex.length;

  const ranges = [0, contentsStart, contentsEnd, prepared.length - contentsEnd];
  const filled = `/ByteRange [${ranges.join(' ')}]`;
  if (filled.length > range[0].length) throw new Error('The /ByteRange does not fit its placeholder');
  const out = Buffer.from(prepared);
  out.write(filled.padEnd(range[0].length, ' '), range.index, 'latin1');

  const signedBytes = Buffer.concat([out.subarray(0, contentsStart), out.subarray(contentsEnd)]);
  const cms = await buildSignedData({ key, contentType: OID.data, contentDigest: sha256(signedBytes), timestamp: (digest) => timestamper.timestamp(digest), at: details.signedAt });
  if (cms.length > SIGNATURE_BYTES) throw new SigningSetupError(`The signature (${cms.length} bytes) does not fit its ${SIGNATURE_BYTES}-byte placeholder`, 'SIGNATURE_TOO_LARGE');
  out.write(Buffer.from(cms).toString('hex').toUpperCase().padEnd(SIGNATURE_BYTES * 2, '0'), contentsStart + 1, 'latin1');
  return new Uint8Array(out);
}
