import { describe, it, expect } from 'vitest';
import {
  normalizeVendor,
  vendorSimilarity,
} from '../vendorNormalization';

describe('vendorNormalization', () => {
  describe('normalizeVendor', () => {
    it('should convert to lowercase', () => {
      expect(normalizeVendor('ACME Corp')).toBe('acme');
    });

    it('should trim whitespace', () => {
      expect(normalizeVendor('  Acme  ')).toBe('acme');
    });

    it('should remove punctuation', () => {
      expect(normalizeVendor('Acme, Inc.')).toBe('acme');
      expect(normalizeVendor("O'Reilly")).toBe('oreilly');
    });

    it('should collapse whitespace', () => {
      expect(normalizeVendor('Acme   Corp')).toBe('acme');
    });

    it('should remove business suffixes', () => {
      expect(normalizeVendor('Acme LLC')).toBe('acme');
      expect(normalizeVendor('Acme Inc')).toBe('acme');
      expect(normalizeVendor('Acme Inc.')).toBe('acme');
      expect(normalizeVendor('Acme Ltd')).toBe('acme');
      expect(normalizeVendor('Acme Corporation')).toBe('acme');
      expect(normalizeVendor('Acme Company')).toBe('acme');
      expect(normalizeVendor('Acme GmbH')).toBe('acme');
    });

    it('should remove Hebrew business suffixes', () => {
      expect(normalizeVendor('חברה בע״מ')).toBe('חברה');
      expect(normalizeVendor('חברה בע"מ')).toBe('חברה');
    });

    it('should remove common prefixes', () => {
      expect(normalizeVendor('The Acme Company')).toBe('acme');
    });

    it('should handle hyphens and underscores', () => {
      expect(normalizeVendor('Coca-Cola')).toBe('coca cola');
      expect(normalizeVendor('under_score')).toBe('under score');
    });

    it('should handle empty input', () => {
      expect(normalizeVendor('')).toBe('');
      expect(normalizeVendor(null as unknown as string)).toBe('');
      expect(normalizeVendor(undefined as unknown as string)).toBe('');
    });
  });

  describe('vendorSimilarity', () => {
    it('should return 1 for identical names', () => {
      expect(vendorSimilarity('Acme', 'Acme')).toBe(1);
    });

    it('should return 1 for names that normalize to same value', () => {
      expect(vendorSimilarity('Acme LLC', 'ACME Inc.')).toBe(1);
    });

    it('should return high score for similar names', () => {
      const score = vendorSimilarity('Acme Corp', 'Acme Corporation');
      expect(score).toBeGreaterThan(0.8);
    });

    it('should return low score for different names', () => {
      const score = vendorSimilarity('Acme', 'Totally Different Company');
      expect(score).toBeLessThan(0.5);
    });

    it('should handle typos', () => {
      const score = vendorSimilarity('Microsoft', 'Microsft');
      expect(score).toBeGreaterThan(0.8);
    });

    it('should return 0 when one string is empty', () => {
      expect(vendorSimilarity('', 'Acme')).toBe(0);
      expect(vendorSimilarity('Acme', '')).toBe(0);
    });

    it('should return 1 when both strings are empty (both normalize to same)', () => {
      // Both empty strings normalize to '' which are equal
      expect(vendorSimilarity('', '')).toBe(1);
    });
  });
});
