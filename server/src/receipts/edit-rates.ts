import type { ApprovedReceiptFields, ReceiptEditRates, ReceiptSuggestion } from '../repositories/ports.js';

/**
 * MUT-255: the receipt-scanning epic's success measure (MUT-252: at least 70% of approved receipts need no edit to
 * amount or date), from what each approval stored. Pure, so the memory and Prisma stores count the same way. A field
 * the reader didn't suggest is not counted for that field. The amount counts as edited when the approved amount or
 * currency differs from what was suggested (a currency the reader didn't suggest isn't compared).
 */
export function editRatesOf(rows: ReadonlyArray<{ suggested: ReceiptSuggestion | null; approved: ApprovedReceiptFields }>): ReceiptEditRates {
  const rates: ReceiptEditRates = {
    approved: rows.length,
    fields: { date: zero(), amount: zero(), currency: zero(), vendor: zero() },
    amountAndDate: { suggested: 0, unedited: 0 },
  };
  for (const { suggested: s, approved: a } of rows) {
    if (!s) continue;
    const dateEdited = s.date ? s.date.value !== a.occurredOn : null;
    const currencyEdited = s.currency ? s.currency.value !== a.currency : null;
    const amountEdited = s.totalMinor ? s.totalMinor.value !== a.amountMinor || currencyEdited === true : null;
    const vendorEdited = s.vendorName ? s.vendorName.value !== (a.vendor ?? '') : null;
    count(rates.fields.date, dateEdited);
    count(rates.fields.amount, amountEdited);
    count(rates.fields.currency, currencyEdited);
    count(rates.fields.vendor, vendorEdited);
    if (dateEdited !== null && amountEdited !== null) {
      rates.amountAndDate.suggested += 1;
      if (!dateEdited && !amountEdited) rates.amountAndDate.unedited += 1;
    }
  }
  return rates;
}

function zero() {
  return { suggested: 0, edited: 0 };
}

function count(rate: { suggested: number; edited: number }, edited: boolean | null): void {
  if (edited === null) return;
  rate.suggested += 1;
  if (edited) rate.edited += 1;
}
