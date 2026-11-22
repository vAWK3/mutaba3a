import type { IsoDate } from '../dates.js';
import { invoicingOn } from '../issuing/invoicing-on.js';
import { formatMoney, type Currency } from '../money.js';
import type { LedgerStore, Organization, PaymentRecord } from '../repositories/ports.js';
import { splitIncome, type IncomeSplitRow } from './invoice-class.js';

/**
 * MUT-660 (ADR-270): the books split of a profile's money received in [from, to] (POSTED payments by receivedOn, as
 * Reports' `received`), or null where invoicing is off, so every other profile's output stays exactly as it was.
 */
export async function invoiceSplitOf(
  store: LedgerStore,
  organization: Organization,
  payments: ReadonlyArray<Pick<PaymentRecord, 'id' | 'currency' | 'amountMinor' | 'customerId' | 'origin' | 'notForInvoice' | 'status' | 'receivedOn'>>,
  range: { from: IsoDate | null; to: IsoDate },
): Promise<IncomeSplitRow[] | null> {
  if (!(await invoicingOn(store, organization))) return null;
  const counted = payments.filter((p) => p.status === 'POSTED' && (range.from === null || p.receivedOn >= range.from) && p.receivedOn <= range.to);
  const ctx = await store.issuing.incomeContext(organization.id, counted.map((p) => p.id));
  return splitIncome(
    counted.map((p) => {
      const links = ctx.payments.get(p.id);
      return { currency: p.currency, amountMinor: p.amountMinor, customerId: p.customerId, origin: p.origin, notForInvoice: p.notForInvoice, documented: links?.documented ?? false, externalInvoice: links?.externalInvoice ?? false, allocations: links?.allocations ?? [] };
    }),
    ctx,
  );
}

/** The wire shape: canonical decimal strings per currency. */
export function serializeInvoiceSplit(rows: readonly IncomeSplitRow[]) {
  const fmt = (minor: bigint, currency: string) => formatMoney({ minor, currency: currency as Currency });
  return rows.map((r) => ({ currency: r.currency as Currency, invoiceIncome: fmt(r.invoiceMinor, r.currency), notForInvoice: fmt(r.notForInvoiceMinor, r.currency), all: fmt(r.allMinor, r.currency) }));
}
