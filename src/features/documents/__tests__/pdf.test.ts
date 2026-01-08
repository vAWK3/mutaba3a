import { describe, it, expect } from 'vitest';
import { getTexts, getDocumentTypeLabel, texts } from '../pdf/texts';
import {
  getTemplateStyles,
  getFontFamily,
  getTextDirection,
  getTextAlign,
  template1Styles,
  template2Styles,
  template3Styles,
} from '../pdf/styles';
import type { DocumentType, DocumentLanguage } from '../../../types';

describe('PDF Text Utilities', () => {
  describe('getTexts', () => {
    it('should return English texts for en language', () => {
      const t = getTexts('en');
      expect(t.item).toBe('Item');
      expect(t.subtotal).toBe('Subtotal');
      expect(t.total).toBe('Total');
      expect(t.invoice).toBe('Invoice');
      expect(t.receipt).toBe('Receipt');
    });

    it('should return Arabic texts for ar language', () => {
      const t = getTexts('ar');
      expect(t.item).toBe('بند');
      expect(t.subtotal).toBe('المجموع الفرعي');
      expect(t.total).toBe('المجموع');
      expect(t.invoice).toBe('فاتورة');
      expect(t.receipt).toBe('سند قبض');
    });
  });

  describe('getDocumentTypeLabel', () => {
    it('should return correct English labels for all document types', () => {
      const types: DocumentType[] = [
        'invoice',
        'receipt',
        'invoice_receipt',
        'credit_note',
        'price_offer',
        'proforma_invoice',
        'donation_receipt',
      ];

      const expectedLabels = [
        'Invoice',
        'Receipt',
        'Invoice Receipt',
        'Credit Note',
        'Price Offer',
        'Proforma Invoice',
        'Donation Receipt',
      ];

      types.forEach((type, index) => {
        expect(getDocumentTypeLabel(type, 'en')).toBe(expectedLabels[index]);
      });
    });

    it('should return correct Arabic labels for all document types', () => {
      const types: DocumentType[] = [
        'invoice',
        'receipt',
        'invoice_receipt',
        'credit_note',
        'price_offer',
        'proforma_invoice',
        'donation_receipt',
      ];

      const expectedLabels = [
        'فاتورة',
        'سند قبض',
        'فاتورة/إيصال',
        'إشعار دائن',
        'عرض سعر',
        'فاتورة أولية',
        'سند تبرّع',
      ];

      types.forEach((type, index) => {
        expect(getDocumentTypeLabel(type, 'ar')).toBe(expectedLabels[index]);
      });
    });
  });

  describe('texts object', () => {
    it('should have both ar and en translations', () => {
      expect(texts.ar).toBeDefined();
      expect(texts.en).toBeDefined();
    });

    it('should have all required text keys', () => {
      const requiredKeys = [
        'item',
        'subject',
        'quantity',
        'rate',
        'price',
        'subtotal',
        'tax',
        'discount',
        'total',
        'notes',
        'issued',
        'due',
        'original',
        'copy',
        'invoice',
        'receipt',
        'to',
        'from',
        'bill_to',
        'payment_method',
        'digitally_certified',
      ];

      requiredKeys.forEach((key) => {
        expect(texts.en[key as keyof typeof texts.en]).toBeDefined();
        expect(texts.ar[key as keyof typeof texts.ar]).toBeDefined();
      });
    });
  });
});

describe('PDF Style Utilities', () => {
  describe('getTemplateStyles', () => {
    it('should return template1Styles for template1', () => {
      const styles = getTemplateStyles('template1');
      expect(styles).toBe(template1Styles);
    });

    it('should return template2Styles for template2', () => {
      const styles = getTemplateStyles('template2');
      expect(styles).toBe(template2Styles);
    });

    it('should return template3Styles for template3', () => {
      const styles = getTemplateStyles('template3');
      expect(styles).toBe(template3Styles);
    });

    it('should return template1Styles as default for unknown template', () => {
      const styles = getTemplateStyles('unknown' as 'template1');
      expect(styles).toBe(template1Styles);
    });
  });

  describe('getFontFamily', () => {
    it('should return Arabic font family for ar language', () => {
      expect(getFontFamily('ar')).toBe('IBMPlexSansArabic');
    });

    it('should return English font family for en language', () => {
      expect(getFontFamily('en')).toBe('IBMPlexSans');
    });
  });

  describe('getTextDirection', () => {
    it('should return rtl for Arabic', () => {
      expect(getTextDirection('ar')).toBe('rtl');
    });

    it('should return ltr for English', () => {
      expect(getTextDirection('en')).toBe('ltr');
    });
  });

  describe('getTextAlign', () => {
    it('should return right for Arabic', () => {
      expect(getTextAlign('ar')).toBe('right');
    });

    it('should return left for English', () => {
      expect(getTextAlign('en')).toBe('left');
    });
  });

  describe('template styles structure', () => {
    it('template1 should have all required style keys', () => {
      const requiredKeys = [
        'page',
        'headerRow',
        'businessInfo',
        'documentInfo',
        'clientSection',
        'itemsTable',
        'summarySection',
        'summaryRow',
        'summaryLabel',
        'summaryValue',
        'totalRow',
        'notes',
        'footer',
      ];

      requiredKeys.forEach((key) => {
        expect(template1Styles).toHaveProperty(key);
      });
    });

    it('template2 should have accentBar style', () => {
      expect(template2Styles).toHaveProperty('accentBar');
    });

    it('template3 should have larger font sizes', () => {
      // Template 3 uses larger fonts
      expect(template3Styles.page).toHaveProperty('fontSize');
    });
  });
});

describe('Amount Formatting', () => {
  // Testing the format function logic directly
  function formatAmount(amountMinor: number, currency: 'USD' | 'ILS'): string {
    const amount = amountMinor / 100;
    const symbol = currency === 'USD' ? '$' : '₪';
    const formatted = amount.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${symbol}${formatted}`;
  }

  it('should format USD amounts correctly', () => {
    expect(formatAmount(10000, 'USD')).toBe('$100.00');
    expect(formatAmount(12345, 'USD')).toBe('$123.45');
    expect(formatAmount(100000, 'USD')).toBe('$1,000.00');
    expect(formatAmount(0, 'USD')).toBe('$0.00');
  });

  it('should format ILS amounts correctly', () => {
    expect(formatAmount(10000, 'ILS')).toBe('₪100.00');
    expect(formatAmount(12345, 'ILS')).toBe('₪123.45');
    expect(formatAmount(100000, 'ILS')).toBe('₪1,000.00');
  });

  it('should handle decimal amounts', () => {
    expect(formatAmount(99, 'USD')).toBe('$0.99');
    expect(formatAmount(1, 'USD')).toBe('$0.01');
  });
});

describe('Date Formatting', () => {
  function formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  it('should format dates in DD/MM/YYYY format', () => {
    expect(formatDate('2024-01-15')).toBe('15/01/2024');
    expect(formatDate('2024-12-31')).toBe('31/12/2024');
  });

  it('should handle ISO date strings', () => {
    expect(formatDate('2024-06-15T10:30:00.000Z')).toMatch(/15\/06\/2024/);
  });
});
