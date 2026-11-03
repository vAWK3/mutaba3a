import type { ReceiptSuggestion, SuggestedField, SuggestionSource } from '../../repositories/ports.js';
import { buyerOf, normalizeIdentifier } from './buyer.js';
import { isConfident, round2 } from './confidence.js';
import { exponentOf, inferFromDecimals, readCurrency } from './currency.js';
import { dateWindow, readDate } from './dates.js';
import { readEmail, readPhone, readRegistration, readVendor } from './fields.js';
import { orderedRows, pdfRows } from './rows.js';
import { knownVatRates, readMoney } from './total.js';
import type { ExtractInput } from './types.js';

export { isConfident, MIN_FIELD_CONFIDENCE } from './confidence.js';

export interface ExtractOptions {
  readerVersion: string;
  /** MUT-514 (D1): the upload day (YYYY-MM-DD). A date outside [receivedOn − 2 years, receivedOn + 1 day] is a misread. */
  receivedOn?: string | undefined;
  /** MUT-514 (D6): the organization's own phone and ID numbers, learned from earlier receipts' bill-to blocks. */
  buyerIds?: readonly string[] | undefined;
}

/**
 * MUT-514 (D6, D10): a read, with the numbers the reader keeps for the organization's buyer memory, digits only: the
 * ones in this receipt's bill-to blocks, and the ones it filled as the vendor's. Never in the API or a log.
 */
export interface ReceiptReading {
  suggestion: ReceiptSuggestion;
  buyerIdentifiers: string[];
  vendorIdentifiers: string[];
}

/**
 * MUT-441: what a receipt says, from its PDF text layer when it has one, else its OCR lines: date, total, currency,
 * VAT and its rate, the vendor's name, registration no., phone and email. Pure: no I/O, and nothing it reads is logged.
 * Money is minor units of the currency read (two decimals assumed when none is). Fields under the threshold are absent.
 */
export function extractReceipt(input: ExtractInput, options: ExtractOptions): ReceiptSuggestion {
  return readReceipt(input, options).suggestion;
}

/** `extractReceipt`, with the buyer and vendor numbers the read job keeps (MUT-514). */
export function readReceipt(input: ExtractInput, options: ExtractOptions): ReceiptReading {
  const fromPdf = Boolean(input.pdfText?.trim());
  const rows = fromPdf ? pdfRows(input.pdfText ?? '') : orderedRows(input.lines ?? []);
  const source: SuggestionSource = fromPdf ? 'pdf-text' : 'ocr';
  const field = <T>(value: T, rule: number, conf: number): SuggestedField<T> | undefined => {
    const confidence = round2(rule * conf);
    return isConfident(confidence) ? { value, source, confidence } : undefined;
  };

  // The currency sets the money's scale, and the total's row is where it is most often printed: read the total once
  // without a scale to find that row, then read the money again in the currency's own.
  const totalRow = readMoney(rows, null).total?.row ?? null;
  const currency = readCurrency(rows, totalRow) ?? inferFromDecimals(rows);
  const money = readMoney(rows, exponentOf(currency), knownVatRates(currency?.code ?? null));
  const date = readDate(rows, dateWindow(options.receivedOn));
  const buyer = buyerOf(rows, options.buyerIds);
  const vendor = readVendor(rows, buyer);
  const registration = readRegistration(rows, buyer);
  const phone = readPhone(rows, buyer);
  const email = readEmail(rows);

  const suggestion: ReceiptSuggestion = {
    readerVersion: options.readerVersion,
    date: date ? field(date.iso, date.rule, date.conf) : undefined,
    totalMinor: money.total ? field(money.total.minor.toString(), money.total.rule, money.total.conf) : undefined,
    currency: currency ? field(currency.code, currency.rule, currency.conf) : undefined,
    vatMinor: money.vat ? field(money.vat.minor.toString(), money.vat.rule, money.vat.conf) : undefined,
    vatRateBasisPoints: money.vatRate ? field(money.vatRate.basisPoints, money.vatRate.rule, money.vatRate.conf) : undefined,
    vendorName: vendor ? field(vendor.value, vendor.rule, vendor.conf) : undefined,
    registrationNo: registration ? field(registration.value, registration.rule, registration.conf) : undefined,
    phone: phone ? field(phone.value, phone.rule, phone.conf) : undefined,
    email: email ? field(email.value, email.rule, email.conf) : undefined,
  };
  const filled = Object.fromEntries(Object.entries(suggestion).filter(([, v]) => v !== undefined)) as unknown as ReceiptSuggestion;
  return { suggestion: filled, buyerIdentifiers: buyer.ownIdentifiers, vendorIdentifiers: vendorIdentifiersOf(rows) };
}

/**
 * R9: the numbers this receipt shows as the vendor's outside its own bill-to blocks, read without the learned buyer
 * numbers: a number a misfired block once taught is still seen as a vendor's here, so the memory unlearns it.
 */
function vendorIdentifiersOf(rows: Parameters<typeof buyerOf>[0]): string[] {
  const ownBlocks = buyerOf(rows);
  return [readRegistration(rows, ownBlocks), readPhone(rows, ownBlocks)].flatMap((r) => (r && isConfident(r.rule * r.conf) ? [normalizeIdentifier(r.value)] : []));
}
