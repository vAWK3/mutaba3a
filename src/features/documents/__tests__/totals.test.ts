import { describe, it, expect } from 'vitest';
import {
  calculateItemTotal,
  calculateDocumentTotals,
  formatMinorAmount,
  type LineItem,
} from '../utils/calculations';

describe('Document Totals Calculation', () => {
  describe('calculateItemTotal', () => {
    it('calculates simple line item total', () => {
      const item = { quantity: 2, rateMinor: 10000, discountMinor: 0 };
      expect(calculateItemTotal(item)).toBe(20000); // 2 * 10000
    });

    it('applies discount to line item total', () => {
      const item = { quantity: 2, rateMinor: 10000, discountMinor: 500 };
      expect(calculateItemTotal(item)).toBe(19500); // 2 * 10000 - 500
    });

    it('handles zero quantity', () => {
      const item = { quantity: 0, rateMinor: 10000, discountMinor: 0 };
      expect(calculateItemTotal(item)).toBe(0);
    });

    it('handles zero rate', () => {
      const item = { quantity: 5, rateMinor: 0, discountMinor: 0 };
      expect(calculateItemTotal(item)).toBe(0);
    });

    it('handles fractional quantities', () => {
      const item = { quantity: 1.5, rateMinor: 10000, discountMinor: 0 };
      expect(calculateItemTotal(item)).toBe(15000); // 1.5 * 10000
    });
  });

  describe('calculateDocumentTotals', () => {
    it('calculates subtotal from line items', () => {
      const items: LineItem[] = [
        { quantity: 2, rateMinor: 10000, discountMinor: 0, taxExempt: false },
        { quantity: 1, rateMinor: 5000, discountMinor: 500, taxExempt: false },
      ];
      const result = calculateDocumentTotals(items, 0.18, true);
      // Subtotal: 2*10000 + 1*5000 = 25000
      expect(result.subtotalMinor).toBe(25000);
    });

    it('calculates VAT at 18%', () => {
      const items: LineItem[] = [
        { quantity: 1, rateMinor: 10000, discountMinor: 0, taxExempt: false },
      ];
      const result = calculateDocumentTotals(items, 0.18, true);
      // Tax: 10000 * 0.18 = 1800
      expect(result.taxMinor).toBe(1800);
    });

    it('calculates VAT at 17%', () => {
      const items: LineItem[] = [
        { quantity: 1, rateMinor: 10000, discountMinor: 0, taxExempt: false },
      ];
      const result = calculateDocumentTotals(items, 0.17, true);
      // Tax: 10000 * 0.17 = 1700
      expect(result.taxMinor).toBe(1700);
    });

    it('skips VAT when vatEnabled is false', () => {
      const items: LineItem[] = [
        { quantity: 1, rateMinor: 10000, discountMinor: 0, taxExempt: false },
      ];
      const result = calculateDocumentTotals(items, 0.18, false);
      expect(result.taxMinor).toBe(0);
      expect(result.totalMinor).toBe(10000);
    });

    it('excludes tax-exempt items from VAT', () => {
      const items: LineItem[] = [
        { quantity: 1, rateMinor: 10000, discountMinor: 0, taxExempt: false },
        { quantity: 1, rateMinor: 5000, discountMinor: 0, taxExempt: true },
      ];
      const result = calculateDocumentTotals(items, 0.18, true);
      // Tax only on 10000: 10000 * 0.18 = 1800
      expect(result.taxMinor).toBe(1800);
      // Total: 15000 + 1800 = 16800
      expect(result.totalMinor).toBe(16800);
    });

    it('applies discounts before VAT calculation', () => {
      const items: LineItem[] = [
        { quantity: 1, rateMinor: 10000, discountMinor: 1000, taxExempt: false },
      ];
      const result = calculateDocumentTotals(items, 0.18, true);
      // Subtotal: 10000
      expect(result.subtotalMinor).toBe(10000);
      // Discount: 1000
      expect(result.discountMinor).toBe(1000);
      // Taxable: 10000 - 1000 = 9000
      // Tax: 9000 * 0.18 = 1620
      expect(result.taxMinor).toBe(1620);
      // Total: 10000 - 1000 + 1620 = 10620
      expect(result.totalMinor).toBe(10620);
    });

    it('handles empty items array', () => {
      const items: LineItem[] = [];
      const result = calculateDocumentTotals(items, 0.18, true);
      expect(result.subtotalMinor).toBe(0);
      expect(result.discountMinor).toBe(0);
      expect(result.taxMinor).toBe(0);
      expect(result.totalMinor).toBe(0);
    });

    it('handles all tax-exempt items', () => {
      const items: LineItem[] = [
        { quantity: 1, rateMinor: 10000, discountMinor: 0, taxExempt: true },
        { quantity: 2, rateMinor: 5000, discountMinor: 0, taxExempt: true },
      ];
      const result = calculateDocumentTotals(items, 0.18, true);
      expect(result.taxMinor).toBe(0);
      expect(result.totalMinor).toBe(20000);
    });

    it('rounds tax to nearest integer', () => {
      const items: LineItem[] = [
        { quantity: 1, rateMinor: 3333, discountMinor: 0, taxExempt: false },
      ];
      const result = calculateDocumentTotals(items, 0.18, true);
      // Tax: 3333 * 0.18 = 599.94 -> rounds to 600
      expect(result.taxMinor).toBe(600);
    });

    it('handles mixed taxable and exempt items with discounts', () => {
      const items: LineItem[] = [
        { quantity: 2, rateMinor: 10000, discountMinor: 500, taxExempt: false },
        { quantity: 1, rateMinor: 5000, discountMinor: 100, taxExempt: true },
      ];
      const result = calculateDocumentTotals(items, 0.18, true);
      // Subtotal: 20000 + 5000 = 25000
      expect(result.subtotalMinor).toBe(25000);
      // Discount: 500 + 100 = 600
      expect(result.discountMinor).toBe(600);
      // Taxable: (20000 - 500) = 19500
      // Tax: 19500 * 0.18 = 3510
      expect(result.taxMinor).toBe(3510);
      // Total: 25000 - 600 + 3510 = 27910
      expect(result.totalMinor).toBe(27910);
    });
  });

  describe('formatMinorAmount', () => {
    it('formats USD amounts', () => {
      expect(formatMinorAmount(10000, 'USD')).toBe('$100.00');
    });

    it('formats ILS amounts', () => {
      expect(formatMinorAmount(10000, 'ILS')).toBe('₪100.00');
    });

    it('formats amounts with cents', () => {
      expect(formatMinorAmount(12345, 'USD')).toBe('$123.45');
    });

    it('formats zero', () => {
      expect(formatMinorAmount(0, 'USD')).toBe('$0.00');
    });

    it('formats large amounts with thousands separator', () => {
      expect(formatMinorAmount(1234567, 'USD')).toBe('$12,345.67');
    });
  });
});
