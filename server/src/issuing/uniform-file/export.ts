import type { IssuedDocumentRecord } from '../../repositories/ports.js';
import { roundHalfUpDiv } from '../../vat.js';
import { DOC_TYPE_CODES, ISSUED_DOC_TYPES, type DealerType, type IssuedDocType } from '../types.js';
import { encodeLine, FieldOverflowError, isoDate } from './format.js';
import { renderRecord, type FieldValue, type RecordCode } from './layout.js';

/**
 * MUT-569 (ADR-270): issued documents → the uniform file (מבנה אחיד 1.31): INI.TXT and BKMVDATA.TXT. Pure: the route
 * reads the documents and passes the clock and the primary id in.
 *
 * - BKMVDATA: A100, then per document its C100, its D110 lines (305, 320, 330) and its D120 payment (320, 400; D4),
 *   then Z900. Record numbers run from 1; Z900 counts every record, itself included.
 * - INI: A000, then one summary line per document record type present (spec §2.5 table: B100/B110/C100/D110/D120/M100;
 *   A100 and Z900 are counted in A000 1002, not summarised).
 * - No B100/B110/M100: MTB3A keeps no journal, so A000 1013 is 0, "not relevant" (D1).
 * - Amounts are agorot; a C100's or a credit note's amounts are positive (the type carries the meaning), a discount is
 *   negative (spec §2.4 יב). D110 1265 is the unit price before VAT and 1266 its discount, so every line adds up.
 * - Times are Israel time; text goes through `toFileText` (format.ts).
 */

const CONSTANT = '&OF1.31&';
const MULTI_YEAR_SOFTWARE = 2;
const NO_BOOKKEEPING = 0;
const LANGUAGE_HEBREW = 0;
const CHARSET_ISO_8859_8 = 1;
const COMPRESSION = 'ZIP';
const LEADING_CURRENCY = 'ILS';
const NO_BRANCHES = 0;
const WALK_IN_NAME = 'לקוח מזדמן';
const WALK_IN_KEY = '0';
const UNIT = 'יחידה';
const CUSTOMER_KEY_WIDTH = 15;
const BP = 10_000n;
const MILLI = 1_000n;
const TRANSACTION_SERVICE = 1;
const TRANSACTION_SALE = 2;
/** D120 1306: 1 cash, 2 cheque, 3 credit card, 4 bank transfer. */
const PAYMENT_CODES = { CASH: 1, BANK: 4 } as const;

export type UniformFileDocument = Pick<
  IssuedDocumentRecord,
  | 'id' | 'docType' | 'number' | 'documentDate' | 'issuedAt' | 'subtotalMinor' | 'discountMinor' | 'netMinor'
  | 'vatRateBasisPoints' | 'vatMinor' | 'grossMinor' | 'customerId' | 'customer' | 'originalId' | 'paymentDetails' | 'lines'
>;

export interface UniformFileSoftware {
  /** A000 1006: the registration certificate's number (8 digits; zeros until MUT-567). */
  registrationNumber: string;
  name: string;
  version: string;
  /** A000 1009/1010: the registering software house (Narabnd Studio Ltd, MUT-700; from config). */
  houseVatId: string;
  houseName: string;
}

/** What config supplies (the rest is the product's own name and the issuing core's version). */
export type UniformFileHouse = Pick<UniformFileSoftware, 'registrationNumber' | 'houseVatId' | 'houseName'>;
/** Placeholders only: config (Terraform software_house_*, uniform_file_registration_number) supplies the real values. */
export const UNIFORM_FILE_HOUSE_PLACEHOLDER: UniformFileHouse = { registrationNumber: '00000000', houseVatId: '000000000', houseName: 'MTB3A' };

export interface UniformFileInput {
  issuer: { vatId: string; legalName: string; address: string | null; city: string | null; dealerType: DealerType };
  /** The documents dated in the range, with their lines. */
  documents: readonly UniformFileDocument[];
  /** A credit note's tax invoice (it may be dated before the range): id → type and number. */
  originals: ReadonlyMap<string, { docType: IssuedDocType; number: number }>;
  range: { from: string; to: string };
  producedAt: Date;
  /** A000 1004 / A100 1103 / Z900 1153: 15 random digits, one per export (spec appendix 5, note 2). */
  primaryId: string;
  software: UniformFileSoftware;
}

/** A document the file can't hold (an amount over its field's 12 digits of shekels): named, so the route can say which. */
export class DocumentTooLargeError extends Error {
  constructor(readonly docType: IssuedDocType, readonly number: number) {
    super(`uniform file: ${docType} ${number} has an amount too large for the file`);
  }
}

export interface UniformFileTypeTotal {
  docType: IssuedDocType;
  count: number;
  grossMinor: bigint;
}

export interface UniformFile {
  /** `OPENFRMT/<first 8 VAT digits>.<YY>/<MMDDhhmm>` (spec §2.2). */
  folder: string;
  ini: Uint8Array;
  bkmv: Uint8Array;
  /** Every BKMVDATA record, A100 and Z900 included. */
  totalRecords: number;
  /** Records per type, BKMVDATA's order (the production summary, appendix 4). */
  recordCounts: { code: RecordCode; count: number }[];
  /** The documents report (§2.6 b): every type MTB3A issues, by code, zero where none. */
  byType: UniformFileTypeTotal[];
}

interface IsraelTime {
  date: string;
  time: string;
  yy: string;
  mmddhhmm: string;
}

const ISRAEL_CLOCK = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jerusalem',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function israelTime(at: Date): IsraelTime {
  const parts = Object.fromEntries(ISRAEL_CLOCK.formatToParts(at).map((p) => [p.type, p.value]));
  const { year = '', month = '', day = '', hour = '', minute = '' } = parts;
  return { date: `${year}${month}${day}`, time: `${hour}${minute}`, yy: year.slice(-2), mmddhhmm: `${month}${day}${hour}${minute}` };
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);
const nineDigits = (value: unknown): string | null => (typeof value === 'string' && /^\d{9}$/.test(value) ? value : null);

function customerKey(doc: UniformFileDocument): string {
  return doc.customerId ? doc.customerId.replace(/-/g, '').slice(0, CUSTOMER_KEY_WIDTH) : WALK_IN_KEY;
}

const ceilDiv = (n: bigint, d: bigint) => (n + d - 1n) / d;

/** The line's unit price before VAT, and the discount that makes quantity × price − discount its net, to the agora. */
function lineFigures(line: UniformFileDocument['lines'][number]): { unitMinor: bigint; discountMinor: bigint } {
  // Rounded up: quantity × price then never falls below the net, and the spare agora lands in the discount (1266).
  const unitMinor = line.pricesIncludeVat ? ceilDiv(line.unitPriceMinor * BP, BP + BigInt(line.vatRateBasisPoints)) : line.unitPriceMinor;
  const before = roundHalfUpDiv(line.quantityMilli * unitMinor, MILLI);
  return { unitMinor, discountMinor: before > line.netMinor ? before - line.netMinor : 0n };
}

class Writer {
  readonly lines: string[] = [];
  readonly counts = new Map<RecordCode, number>();

  add(code: RecordCode, values: Record<number, FieldValue>, numberField: number): void {
    this.lines.push(renderRecord(code, { ...values, [numberField]: this.lines.length + 1 }));
    this.counts.set(code, (this.counts.get(code) ?? 0) + 1);
  }
}

function writeDocument(out: Writer, doc: UniformFileDocument, input: UniformFileInput): void {
  const vat = input.issuer.vatId;
  const type = DOC_TYPE_CODES[doc.docType];
  const number = String(doc.number);
  const issued = israelTime(doc.issuedAt);
  const date = isoDate(doc.documentDate);
  const payment = doc.paymentDetails;
  out.add(
    'C100',
    {
      1200: 'C100', 1202: vat, 1203: type, 1204: number, 1205: issued.date, 1206: issued.time,
      1207: text(doc.customer.name) ?? WALK_IN_NAME, 1208: text(doc.customer.address), 1215: nineDigits(doc.customer.taxId),
      1216: payment ? isoDate(payment.receivedOn) : null,
      1219: doc.subtotalMinor, 1220: -doc.discountMinor, 1221: doc.netMinor, 1222: doc.vatMinor, 1223: doc.grossMinor, 1224: 0n,
      1225: customerKey(doc), 1230: date,
    },
    1201,
  );
  if (doc.docType !== 'RECEIPT') {
    const base = doc.docType === 'CREDIT_NOTE' && doc.originalId ? input.originals.get(doc.originalId) : undefined;
    for (const line of doc.lines) {
      const { unitMinor, discountMinor } = lineFigures(line);
      out.add(
        'D110',
        {
          1250: 'D110', 1252: vat, 1253: type, 1254: number, 1255: line.index,
          1256: base ? DOC_TYPE_CODES[base.docType] : null, 1257: base ? String(base.number) : null,
          1258: line.kind === 'GOODS' ? TRANSACTION_SALE : TRANSACTION_SERVICE, 1260: line.description, 1263: UNIT,
          1264: line.quantityMilli, 1265: unitMinor, 1266: -discountMinor, 1267: line.netMinor, 1268: line.vatRateBasisPoints,
          1272: date,
        },
        1251,
      );
    }
  }
  if (payment) {
    out.add(
      'D120',
      { 1300: 'D120', 1302: vat, 1303: type, 1304: number, 1305: 1, 1306: PAYMENT_CODES[payment.method], 1311: isoDate(payment.receivedOn), 1312: doc.grossMinor, 1322: date },
      1301,
    );
  }
}

const byCodeThenNumber = (a: UniformFileDocument, b: UniformFileDocument) =>
  DOC_TYPE_CODES[a.docType] - DOC_TYPE_CODES[b.docType] || a.number - b.number;

/** Every record ends in CR LF, the last one too (spec §2.4 ט). Byte arrays only (no Node Buffer: see encodeLine). */
function crlf(records: string[]): Uint8Array {
  const lines = records.map(encodeLine);
  const out = new Uint8Array(lines.reduce((n, l) => n + l.length + 2, 0));
  let at = 0;
  for (const line of lines) {
    out.set(line, at);
    out[at + line.length] = 0x0d;
    out[at + line.length + 1] = 0x0a;
    at += line.length + 2;
  }
  return out;
}

export function buildUniformFile(input: UniformFileInput): UniformFile {
  const { issuer, software, primaryId } = input;
  const produced = israelTime(input.producedAt);
  const folder = `OPENFRMT/${issuer.vatId.slice(0, 8)}.${produced.yy}/${produced.mmddhhmm}`;
  const documents = [...input.documents].sort(byCodeThenNumber);

  const out = new Writer();
  out.add('A100', { 1100: 'A100', 1102: issuer.vatId, 1103: primaryId, 1104: CONSTANT }, 1101);
  for (const doc of documents) {
    try {
      writeDocument(out, doc, input);
    } catch (err) {
      if (err instanceof FieldOverflowError) throw new DocumentTooLargeError(doc.docType, doc.number);
      throw err;
    }
  }
  const totalRecords = out.lines.length + 1;
  out.add('Z900', { 1150: 'Z900', 1152: issuer.vatId, 1153: primaryId, 1154: CONSTANT, 1155: totalRecords }, 1151);

  const a000 = renderRecord('A000', {
    1000: 'A000', 1002: totalRecords, 1003: issuer.vatId, 1004: primaryId, 1005: CONSTANT,
    1006: software.registrationNumber, 1007: software.name, 1008: software.version, 1009: software.houseVatId, 1010: software.houseName,
    1011: MULTI_YEAR_SOFTWARE, 1012: folder.replace(/\//g, '\\'), 1013: NO_BOOKKEEPING, 1014: 0,
    1015: issuer.dealerType === 'COMPANY' ? issuer.vatId : null,
    1018: issuer.legalName, 1019: issuer.address, 1021: issuer.city,
    1024: isoDate(input.range.from), 1025: isoDate(input.range.to), 1026: produced.date, 1027: produced.time,
    1028: LANGUAGE_HEBREW, 1029: CHARSET_ISO_8859_8, 1030: COMPRESSION, 1032: LEADING_CURRENCY, 1034: NO_BRANCHES,
  });
  const summaryCodes: RecordCode[] = ['C100', 'D110', 'D120'];
  const summary = summaryCodes.filter((c) => out.counts.has(c)).map((c) => renderRecord('INI_SUMMARY', { 1050: c, 1051: out.counts.get(c) }));

  const byType = ISSUED_DOC_TYPES.map((docType) => {
    const ofType = documents.filter((d) => d.docType === docType);
    return { docType, count: ofType.length, grossMinor: ofType.reduce((s, d) => s + d.grossMinor, 0n) };
  })
    // §2.6 b: every type the software issues, with zero where none.
    .sort((a, b) => DOC_TYPE_CODES[a.docType] - DOC_TYPE_CODES[b.docType]);

  return {
    folder,
    ini: crlf([a000, ...summary]),
    bkmv: crlf(out.lines),
    totalRecords,
    recordCounts: [...out.counts].map(([code, count]) => ({ code, count })),
    byType,
  };
}
