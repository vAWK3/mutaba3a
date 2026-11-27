import type { ExpenseReceiptRecord, LedgerStore, Organization, VendorRecord } from '../repositories/ports.js';
import { vendorDefaults } from '../serializers.js';

/**
 * MUT-303 (D6): the defaults of the saved vendor a To-review receipt points to: its read registration no. first, else
 * a name that is exactly one of a vendor's names. Worked out when the receipt is read and never written into
 * `suggested`: a currency stored there would re-read a total the reader stored without one (R1). Null for a filed
 * receipt, when nothing was read, or when nothing matches; `vat` is null off firm profiles (R10).
 * MUT-775: `categoryId` is the vendor's last category, only for a match by registration no. (D2) and only while that
 * category is live on this profile (D3); else null.
 */
export async function receiptVendorDefaults(store: LedgerStore, organization: Organization, receipt: ExpenseReceiptRecord) {
  if (receipt.expenseId) return null;
  const match = await matchedVendor(store, organization.id, receipt);
  if (!match) return null;
  const { vendor, byRegistration } = match;
  const { lastCurrency, lastVat } = vendorDefaults(vendor, organization.firmEnabledAt !== null);
  const categoryId = byRegistration ? await liveCategoryId(store, organization.id, vendor.lastCategoryId) : null;
  return { vendorId: vendor.id, currency: lastCurrency, vat: lastVat, categoryId };
}

interface VendorMatch {
  vendor: VendorRecord;
  byRegistration: boolean;
}

async function matchedVendor(store: LedgerStore, organizationId: string, receipt: ExpenseReceiptRecord): Promise<VendorMatch | null> {
  const registration = receipt.suggested?.registrationNo?.value;
  const byRegistration = registration ? await store.vendors.findByRegistration(organizationId, registration) : null;
  if (byRegistration) return { vendor: byRegistration, byRegistration: true };
  const name = receipt.suggested?.vendorName?.value;
  const byName = name ? await store.vendors.findByName(organizationId, name) : null;
  return byName ? { vendor: byName, byRegistration: false } : null;
}

/** MUT-775 (D3): the category, when it is on this profile and not archived. */
async function liveCategoryId(store: LedgerStore, organizationId: string, categoryId: string | null): Promise<string | null> {
  if (!categoryId) return null;
  const category = await store.expenseCategories.getById(organizationId, categoryId);
  return category && category.archivedAt === null ? category.id : null;
}
