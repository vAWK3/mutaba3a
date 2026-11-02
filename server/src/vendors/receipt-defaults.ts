import type { ExpenseReceiptRecord, LedgerStore, Organization, VendorRecord } from '../repositories/ports.js';
import { vendorDefaults } from '../serializers.js';

/**
 * MUT-303 (D6): the defaults of the saved vendor a To-review receipt points to: its read registration no. first, else
 * a name that is exactly one of a vendor's names. Worked out when the receipt is read and never written into
 * `suggested`: a currency stored there would re-read a total the reader stored without one (R1). Null for a filed
 * receipt, when nothing was read, or when nothing matches; `vat` is null off firm profiles (R10).
 */
export async function receiptVendorDefaults(store: LedgerStore, organization: Organization, receipt: ExpenseReceiptRecord) {
  if (receipt.expenseId) return null;
  const vendor = await matchedVendor(store, organization.id, receipt);
  if (!vendor) return null;
  const { lastCurrency, lastVat } = vendorDefaults(vendor, organization.firmEnabledAt !== null);
  return { vendorId: vendor.id, currency: lastCurrency, vat: lastVat };
}

async function matchedVendor(store: LedgerStore, organizationId: string, receipt: ExpenseReceiptRecord): Promise<VendorRecord | null> {
  const registration = receipt.suggested?.registrationNo?.value;
  const byRegistration = registration ? await store.vendors.findByRegistration(organizationId, registration) : null;
  if (byRegistration) return byRegistration;
  const name = receipt.suggested?.vendorName?.value;
  if (!name) return null;
  const [best] = await store.vendors.search(organizationId, name, 1);
  return best?.exact ? best.vendor : null;
}
