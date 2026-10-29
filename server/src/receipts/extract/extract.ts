import type { ReceiptSuggestion, SuggestedField, SuggestionSource } from '../../repositories/ports.js';
import { isConfident, round2 } from './confidence.js';
import { exponentOf, inferFromDecimals, readCurrency } from './currency.js';
import { readDate } from './dates.js';
import { readEmail, readPhone, readRegistration, readVendor } from './fields.js';
import { orderedRows, pdfRows } from './rows.js';
import { readMoney } from './total.js';
import type { ExtractInput } from './types.js';

export { isConfident, MIN_FIELD_CONFIDENCE } from './confidence.js';

/**
 * MUT-441: what a receipt says, from its PDF text layer when it has one, else its OCR lines: date, total, currency,
 * VAT and its rate, the vendor's name, registration no., phone and email. Pure: no I/O, and nothing it reads is logged.
 * Money is minor units of the currency read (two decimals assumed when none is). Fields under the threshold are absent.
 */
export function extractReceipt(input: ExtractInput, options: { readerVersion: string }): ReceiptSuggestion {
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
  const money = readMoney(rows, exponentOf(currency));
  const date = readDate(rows);
  const vendor = readVendor(rows);
  const registration = readRegistration(rows);
  const phone = readPhone(rows);
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
  return Object.fromEntries(Object.entries(suggestion).filter(([, v]) => v !== undefined)) as unknown as ReceiptSuggestion;
}
