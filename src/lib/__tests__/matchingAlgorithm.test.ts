import { describe, it, expect } from 'vitest';
import {
  calculateMatch,
  filterAndSortSuggestions,
  getConfidenceColor,
  getConfidenceLabel,
} from '../matchingAlgorithm';
import type { Receipt, ExpenseDisplay, ReceiptMatchSuggestion } from '../../types';

describe('matchingAlgorithm', () => {
  // Helper to create test receipt
  const createReceipt = (overrides: Partial<Receipt> = {}): Receipt => ({
    id: 'receipt-1',
    profileId: 'profile-1',
    monthKey: '2024-06',
    fileName: 'receipt.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    data: 'base64data',
    createdAt: '2024-06-15T12:00:00Z',
    updatedAt: '2024-06-15T12:00:00Z',
    ...overrides,
  });

  // Helper to create test expense
  const createExpense = (overrides: Partial<ExpenseDisplay> = {}): ExpenseDisplay => ({
    id: 'expense-1',
    profileId: 'profile-1',
    title: 'Test Expense',
    amountMinor: 10000,
    currency: 'USD',
    occurredAt: '2024-06-15',
    createdAt: '2024-06-15T12:00:00Z',
    updatedAt: '2024-06-15T12:00:00Z',
    receiptCount: 0,
    isFromRecurring: false,
    ...overrides,
  });

  describe('calculateMatch', () => {
    describe('amount scoring', () => {
      it('should give 50 points for exact match', () => {
        const receipt = createReceipt({ amountMinor: 10000 });
        const expense = createExpense({ amountMinor: 10000 });
        const result = calculateMatch(receipt, expense);
        expect(result.breakdown.amountScore).toBe(50);
      });

      it('should give 50 points for match within 1%', () => {
        const receipt = createReceipt({ amountMinor: 10050 }); // 0.5% diff
        const expense = createExpense({ amountMinor: 10000 });
        const result = calculateMatch(receipt, expense);
        expect(result.breakdown.amountScore).toBe(50);
      });

      it('should give 40 points for match within 5%', () => {
        const receipt = createReceipt({ amountMinor: 10400 }); // 4% diff
        const expense = createExpense({ amountMinor: 10000 });
        const result = calculateMatch(receipt, expense);
        expect(result.breakdown.amountScore).toBe(40);
      });

      it('should give 30 points for match within 10%', () => {
        const receipt = createReceipt({ amountMinor: 10800 }); // 8% diff
        const expense = createExpense({ amountMinor: 10000 });
        const result = calculateMatch(receipt, expense);
        expect(result.breakdown.amountScore).toBe(30);
      });

      it('should give 20 points for match within 20%', () => {
        const receipt = createReceipt({ amountMinor: 11500 }); // 15% diff
        const expense = createExpense({ amountMinor: 10000 });
        const result = calculateMatch(receipt, expense);
        expect(result.breakdown.amountScore).toBe(20);
      });

      it('should give 0 points for large difference', () => {
        const receipt = createReceipt({ amountMinor: 15000 }); // 50% diff
        const expense = createExpense({ amountMinor: 10000 });
        const result = calculateMatch(receipt, expense);
        expect(result.breakdown.amountScore).toBe(0);
      });

      it('should give 0 points for missing amount', () => {
        const receipt = createReceipt({ amountMinor: undefined });
        const expense = createExpense({ amountMinor: 10000 });
        const result = calculateMatch(receipt, expense);
        expect(result.breakdown.amountScore).toBe(0);
      });
    });

    describe('date scoring', () => {
      it('should give 25 points for same day', () => {
        const receipt = createReceipt({ occurredAt: '2024-06-15' });
        const expense = createExpense({ occurredAt: '2024-06-15' });
        const result = calculateMatch(receipt, expense);
        expect(result.breakdown.dateScore).toBe(25);
      });

      it('should give 20 points for within 3 days', () => {
        const receipt = createReceipt({ occurredAt: '2024-06-13' });
        const expense = createExpense({ occurredAt: '2024-06-15' });
        const result = calculateMatch(receipt, expense);
        expect(result.breakdown.dateScore).toBe(20);
      });

      it('should give 15 points for within 7 days', () => {
        const receipt = createReceipt({ occurredAt: '2024-06-10' });
        const expense = createExpense({ occurredAt: '2024-06-15' });
        const result = calculateMatch(receipt, expense);
        expect(result.breakdown.dateScore).toBe(15);
      });

      it('should give 10 points for within 30 days', () => {
        const receipt = createReceipt({ occurredAt: '2024-06-01' });
        const expense = createExpense({ occurredAt: '2024-06-20' }); // 19 days diff
        const result = calculateMatch(receipt, expense);
        expect(result.breakdown.dateScore).toBe(10);
      });

      it('should give 0 points for more than 30 days apart', () => {
        const receipt = createReceipt({ occurredAt: '2024-05-01' });
        const expense = createExpense({ occurredAt: '2024-06-15' }); // 45 days diff
        const result = calculateMatch(receipt, expense);
        expect(result.breakdown.dateScore).toBe(0);
      });

      it('should give 10 points for same month (when no date on receipt)', () => {
        const receipt = createReceipt({ occurredAt: undefined, monthKey: '2024-06' });
        const expense = createExpense({ occurredAt: '2024-06-15' });
        const result = calculateMatch(receipt, expense);
        expect(result.breakdown.dateScore).toBe(10);
      });

      it('should give 0 points for different month (when no date on receipt)', () => {
        const receipt = createReceipt({ occurredAt: undefined, monthKey: '2024-05' });
        const expense = createExpense({ occurredAt: '2024-06-15' });
        const result = calculateMatch(receipt, expense);
        expect(result.breakdown.dateScore).toBe(0);
      });
    });

    describe('vendor scoring', () => {
      it('should give 25 points for same vendorId', () => {
        const receipt = createReceipt({ vendorId: 'vendor-1' });
        const expense = createExpense({ vendorId: 'vendor-1' });
        const result = calculateMatch(receipt, expense);
        expect(result.breakdown.vendorScore).toBe(25);
      });

      it('should give 20 points for high similarity', () => {
        const receipt = createReceipt({ vendorRaw: 'Microsoft Corp' });
        const expense = createExpense({ vendor: 'Microsoft Corporation' });
        const result = calculateMatch(receipt, expense);
        expect(result.breakdown.vendorScore).toBe(20);
      });

      it('should give 10 points for medium similarity', () => {
        // 'Micro' vs 'Microsoft' = similarity ~0.55
        const receipt = createReceipt({ vendorRaw: 'Micro' });
        const expense = createExpense({ vendor: 'Microsoft' });
        const result = calculateMatch(receipt, expense);
        expect(result.breakdown.vendorScore).toBe(10);
      });

      it('should give 0 points for low similarity', () => {
        const receipt = createReceipt({ vendorRaw: 'Apple' });
        const expense = createExpense({ vendor: 'Microsoft' });
        const result = calculateMatch(receipt, expense);
        expect(result.breakdown.vendorScore).toBe(0);
      });
    });

    describe('confidence levels', () => {
      it('should return high confidence for score >= 80', () => {
        const receipt = createReceipt({
          amountMinor: 10000,
          occurredAt: '2024-06-15',
          vendorId: 'vendor-1',
        });
        const expense = createExpense({
          amountMinor: 10000,
          occurredAt: '2024-06-15',
          vendorId: 'vendor-1',
        });
        const result = calculateMatch(receipt, expense);
        expect(result.score).toBe(100);
        expect(result.confidence).toBe('high');
      });

      it('should return medium confidence for score >= 60', () => {
        const receipt = createReceipt({
          amountMinor: 10000,
          occurredAt: '2024-06-15',
        });
        const expense = createExpense({
          amountMinor: 10000,
          occurredAt: '2024-06-15',
        });
        const result = calculateMatch(receipt, expense);
        expect(result.score).toBe(75);
        expect(result.confidence).toBe('medium');
      });

      it('should return low confidence for score >= 40', () => {
        // Use different month to avoid month matching bonus
        const receipt = createReceipt({
          amountMinor: 10000,
          monthKey: '2024-05', // Different month
        });
        const expense = createExpense({
          amountMinor: 10000,
          occurredAt: '2024-06-15',
        });
        const result = calculateMatch(receipt, expense);
        expect(result.score).toBe(50); // Amount only
        expect(result.confidence).toBe('low');
      });

      it('should return none confidence for score < 40', () => {
        // Use different month to avoid month matching bonus
        const receipt = createReceipt({
          amountMinor: 15000, // 50% diff - 0 points
          monthKey: '2024-05', // Different month
        });
        const expense = createExpense({
          amountMinor: 10000,
          occurredAt: '2024-06-15',
        });
        const result = calculateMatch(receipt, expense);
        expect(result.score).toBe(0);
        expect(result.confidence).toBe('none');
      });
    });
  });

  describe('filterAndSortSuggestions', () => {
    const mockExpense = createExpense();
    const createSuggestion = (score: number, confidence: 'high' | 'medium' | 'low'): ReceiptMatchSuggestion => ({
      receiptId: 'receipt-1',
      expenseId: `expense-${score}`,
      score,
      confidence,
      breakdown: { amountScore: score / 2, dateScore: score / 4, vendorScore: score / 4 },
      expense: mockExpense,
    });

    const suggestions: ReceiptMatchSuggestion[] = [
      createSuggestion(80, 'high'),
      createSuggestion(50, 'low'),
      createSuggestion(90, 'high'),
      { ...createSuggestion(30, 'low'), confidence: 'low' },
      createSuggestion(60, 'medium'),
    ];

    it('should filter out suggestions below threshold', () => {
      const result = filterAndSortSuggestions(suggestions, 40);
      expect(result.every((s) => s.score >= 40)).toBe(true);
      expect(result.some((s) => s.score === 30)).toBe(false);
    });

    it('should sort by score descending', () => {
      const result = filterAndSortSuggestions(suggestions, 40);
      expect(result[0].score).toBe(90);
      expect(result[1].score).toBe(80);
    });

    it('should limit results', () => {
      const result = filterAndSortSuggestions(suggestions, 40, 2);
      expect(result).toHaveLength(2);
    });

    it('should use default limit of 5', () => {
      const manySuggestions = Array.from({ length: 10 }, (_, i) => ({
        ...createSuggestion(50 + i, 'low' as const),
        expenseId: `${i}`,
        score: 50 + i,
        confidence: 'low' as const,
      }));
      const result = filterAndSortSuggestions(manySuggestions, 40);
      expect(result).toHaveLength(5);
    });
  });

  describe('getConfidenceColor', () => {
    it('should return success for high', () => {
      expect(getConfidenceColor('high')).toBe('text-success');
    });

    it('should return warning for medium', () => {
      expect(getConfidenceColor('medium')).toBe('text-warning');
    });

    it('should return muted for low', () => {
      expect(getConfidenceColor('low')).toBe('text-muted');
    });

    it('should return muted for none', () => {
      expect(getConfidenceColor('none')).toBe('text-muted');
    });
  });

  describe('getConfidenceLabel', () => {
    it('should return correct labels', () => {
      expect(getConfidenceLabel('high')).toBe('High match');
      expect(getConfidenceLabel('medium')).toBe('Likely match');
      expect(getConfidenceLabel('low')).toBe('Possible match');
      expect(getConfidenceLabel('none')).toBe('Low match');
    });
  });
});
