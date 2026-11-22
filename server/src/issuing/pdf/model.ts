import type { IssuedDocumentRecord } from '../../repositories/ports.js';
import { roundHalfUpDiv } from '../../vat.js';
import { DOCUMENT_LANGUAGES, type DocumentLanguage } from '../labels.js';
import { DOC_TYPE_TITLES, PDF_LABELS, type PdfLabels } from './labels.js';

/**
 * MUT-640: what a document prints, as plain view data, the same for every style. A style decides where things go and
 * how big; never what they say. Everything comes from the issued record (its snapshots), never from the profile now.
 */

export type CopyMark = 'ORIGINAL' | 'COPY' | 'DRAFT';

export interface PdfRenderOptions {
  mark: CopyMark;
  /** The tax invoice a credit note credits or a receipt pays, by number. */
  originalNumber: number | null;
  /** The business's logo (PNG or JPEG), when it has one. */
  logo: Uint8Array | null;
}

export interface LabelValue {
  label: string;
  value: string;
}

export interface PdfLine {
  index: string;
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  exempt: boolean;
}

export interface PdfViewModel {
  language: DocumentLanguage;
  rtl: boolean;
  labels: PdfLabels;
  ink: string;
  title: string;
  /** D-PDF1: the Hebrew legal title on Arabic and English documents. */
  legalTitle: string | null;
  number: string;
  mark: string;
  isDraft: boolean;
  logo: Buffer | null;
  issuer: { name: string; idLine: string | null; address: string | null; contact: string[] };
  customer: { name: string; idLine: string | null; address: string | null } | null;
  /** Date, due date, allocation number, the original it refers to. */
  meta: LabelValue[];
  lines: PdfLine[];
  /** Subtotal, discount, net, VAT: shown above the grand total when they say something. */
  totals: LabelValue[];
  grand: LabelValue;
  pricesIncludeVat: boolean;
  payment: LabelValue[];
  notes: string | null;
  footer: string;
}

/** D-PDF4 + MUT-640 brief: the ink colours; nothing else is printed in colour. */
export const INKS = { BLACK: '#111111', BLUE: '#1B3A8C' } as const;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function formatAmount(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '−' : ''}${whole}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/** D-PDF4: ₪ after the number in Hebrew and Arabic, before it in English. */
export function formatMoney(minor: bigint, language: DocumentLanguage): string {
  if (language !== 'en') return `${formatAmount(minor)} ₪`;
  return minor < 0n ? `−₪${formatAmount(-minor)}` : `₪${formatAmount(minor)}`;
}

/** D-PDF4: DD/MM/YYYY in every language. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function formatQuantity(milli: bigint): string {
  const whole = milli / 1000n;
  const fraction = (milli % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

const percent = (basisPoints: number) => (basisPoints % 100 === 0 ? `${basisPoints / 100}` : (basisPoints / 100).toFixed(2));

export function buildViewModel(doc: IssuedDocumentRecord, ink: string, options: PdfRenderOptions): PdfViewModel {
  const language: DocumentLanguage = (DOCUMENT_LANGUAGES as readonly string[]).includes(doc.language) ? (doc.language as DocumentLanguage) : 'he';
  const l = PDF_LABELS[language];
  const money = (minor: bigint) => formatMoney(minor, language);
  const issuer = doc.issuer;
  const dealer = str(issuer['dealerType']) as keyof PdfLabels['issuerId'] | null;
  const customer = doc.customer;
  const customerName = str(customer['name']);
  const customerTax = str(customer['taxId']);
  const meta: LabelValue[] = [{ label: l.date, value: formatDate(doc.documentDate) }];
  if (doc.allocationNumber) meta.push({ label: l.allocation, value: doc.allocationNumber });
  if (options.originalNumber !== null) meta.push({ label: doc.docType === 'CREDIT_NOTE' ? l.creditFor : l.receiptFor, value: String(options.originalNumber) });
  const totals: LabelValue[] = [];
  const typed = doc.lines.map((line) => roundHalfUpDiv(line.quantityMilli * line.unitPriceMinor, 1000n) - line.discountMinor);
  if (doc.discountMinor > 0n) {
    // Review fix 3: an all-inclusive document shows its subtotal and discount as typed (VAT included), matching its
    // lines; otherwise both are before VAT, like the net below them.
    const allInclusive = doc.pricesIncludeVat && doc.lines.every((line) => line.pricesIncludeVat || line.vatRateBasisPoints === 0);
    const subtotal = allInclusive ? typed.reduce((sum, t) => sum + t, 0n) : doc.subtotalMinor;
    const discount = allInclusive ? subtotal - doc.grossMinor : doc.discountMinor;
    totals.push({ label: l.subtotal, value: money(subtotal) }, { label: l.discount, value: money(-discount) });
  }
  if (doc.vatRateBasisPoints > 0) {
    // Review fix 4: with VAT-exempt lines, the exempt and the taxable amounts are shown apart.
    const exemptNet = doc.lines.filter((line) => line.vatRateBasisPoints === 0).reduce((sum, line) => sum + line.netMinor, 0n);
    if (exemptNet > 0n) totals.push({ label: l.taxable, value: money(doc.netMinor - exemptNet) }, { label: l.exempt, value: money(exemptNet) });
    totals.push({ label: l.net, value: money(doc.netMinor) }, { label: l.vat(percent(doc.vatRateBasisPoints)), value: money(doc.vatMinor) });
  }
  const grandLabel = doc.docType === 'CREDIT_NOTE' ? l.totalCredit : doc.docType === 'RECEIPT' ? l.received : l.total;
  const payment: LabelValue[] = doc.paymentDetails
    ? [
        { label: l.paymentHeading, value: l.method[doc.paymentDetails.method] },
        ...(doc.paymentDetails.reference ? [{ label: l.reference, value: doc.paymentDetails.reference }] : []),
        { label: l.receivedOn, value: formatDate(doc.paymentDetails.receivedOn) },
      ]
    : [];
  return {
    language,
    rtl: language !== 'en',
    labels: l,
    ink,
    title: DOC_TYPE_TITLES[language][doc.docType],
    legalTitle: language === 'he' ? null : DOC_TYPE_TITLES.he[doc.docType],
    number: String(doc.number),
    mark: options.mark === 'ORIGINAL' ? l.original : options.mark === 'COPY' ? l.copy : l.draft,
    isDraft: options.mark === 'DRAFT',
    logo: options.logo ? Buffer.from(options.logo) : null,
    issuer: {
      name: str(issuer['legalName']) ?? '',
      idLine: str(issuer['vatId']) ? `${dealer ? l.issuerId[dealer] : l.customerId} ${str(issuer['vatId'])}` : null,
      address: [str(issuer['address']), str(issuer['city'])].filter(Boolean).join(', ') || null,
      contact: [str(issuer['phone']), str(issuer['email']), str(issuer['website'])].filter((v): v is string => v !== null),
    },
    customer: customerName ? { name: customerName, idLine: customerTax ? `${l.customerId} ${customerTax}` : null, address: str(customer['address']) } : null,
    meta,
    lines: doc.lines.map((line) => ({
      index: String(line.index),
      description: line.description,
      quantity: formatQuantity(line.quantityMilli),
      unitPrice: formatAmount(line.unitPriceMinor),
      // The line as typed: quantity × price less its own discount, in its own terms (VAT included or not).
      amount: formatAmount(typed[line.index - 1] ?? 0n),
      exempt: line.vatRateBasisPoints === 0 && doc.vatRateBasisPoints > 0,
    })),
    totals,
    grand: { label: grandLabel, value: money(doc.grossMinor) },
    pricesIncludeVat: doc.pricesIncludeVat,
    payment,
    notes: doc.notes,
    footer: l.footer,
  };
}
