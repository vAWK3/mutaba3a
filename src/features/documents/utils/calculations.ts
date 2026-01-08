/**
 * Document totals calculation utilities
 */

export interface LineItem {
  quantity: number;
  rateMinor: number;
  discountMinor: number;
  taxExempt: boolean;
}

export interface DocumentTotals {
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/**
 * Calculate the total for a single line item (before tax)
 */
export function calculateItemTotal(item: { quantity: number; rateMinor: number; discountMinor: number }): number {
  return item.quantity * item.rateMinor - item.discountMinor;
}

/**
 * Calculate all document totals from line items
 * @param items - Array of line items
 * @param taxRate - Tax rate as decimal (e.g., 0.18 for 18%)
 * @param vatEnabled - Whether VAT should be applied
 */
export function calculateDocumentTotals(
  items: LineItem[],
  taxRate: number,
  vatEnabled: boolean
): DocumentTotals {
  let subtotalMinor = 0;
  let discountMinor = 0;
  let taxableMinor = 0;

  for (const item of items) {
    const lineTotal = item.quantity * item.rateMinor;
    const lineDiscount = item.discountMinor;

    subtotalMinor += lineTotal;
    discountMinor += lineDiscount;

    if (!item.taxExempt) {
      taxableMinor += lineTotal - lineDiscount;
    }
  }

  // Only calculate tax if VAT is enabled
  const taxMinor = vatEnabled ? Math.round(taxableMinor * taxRate) : 0;
  const totalMinor = subtotalMinor - discountMinor + taxMinor;

  return {
    subtotalMinor,
    discountMinor,
    taxMinor,
    totalMinor,
  };
}

/**
 * Format a minor amount (cents/agorot) to display string
 */
export function formatMinorAmount(minor: number, currency: 'USD' | 'ILS'): string {
  return (minor / 100).toLocaleString('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  });
}
