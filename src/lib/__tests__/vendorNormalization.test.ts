import { describe, it, expect } from 'vitest';
import {
  normalizeVendor,
  vendorSimilarity,
  isSameVendor,
  findBestVendorMatch,
  suggestCanonicalName,
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

  describe('isSameVendor', () => {
    it('should return true for same vendor', () => {
      expect(isSameVendor('Acme LLC', 'ACME Inc.')).toBe(true);
    });

    it('should return true for similar vendors above threshold', () => {
      expect(isSameVendor('Microsoft', 'Microsft')).toBe(true);
    });

    it('should return false for different vendors', () => {
      expect(isSameVendor('Acme', 'Zenith')).toBe(false);
    });

    it('should respect custom threshold', () => {
      // With high threshold, slight differences fail
      expect(isSameVendor('Microsoft', 'Microsft', 0.95)).toBe(false);
      // With low threshold, they pass
      expect(isSameVendor('Microsoft', 'Microsft', 0.7)).toBe(true);
    });
  });

  describe('findBestVendorMatch', () => {
    const candidates = ['Microsoft', 'Apple', 'Google', 'Amazon', 'Meta'];

    it('should find exact match', () => {
      const result = findBestVendorMatch('Microsoft', candidates);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Microsoft');
      expect(result!.score).toBe(1);
    });

    it('should find similar match', () => {
      const result = findBestVendorMatch('Microsft', candidates);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Microsoft');
      expect(result!.score).toBeGreaterThan(0.8);
    });

    it('should return null for no match above threshold', () => {
      const result = findBestVendorMatch('Totally Unknown', candidates);
      expect(result).toBeNull();
    });

    it('should return null for empty candidates', () => {
      const result = findBestVendorMatch('Microsoft', []);
      expect(result).toBeNull();
    });

    it('should return null for empty target', () => {
      const result = findBestVendorMatch('', candidates);
      expect(result).toBeNull();
    });

    it('should find best match among multiple possibilities', () => {
      const vendors = ['Acme Corp', 'Acme Inc', 'Acme Solutions'];
      const result = findBestVendorMatch('Acme Corporation', vendors);
      expect(result).not.toBeNull();
      // Should find one of the Acme variants
      expect(result!.name).toContain('Acme');
    });

    it('should respect custom threshold', () => {
      // With very high threshold, typo won't match
      const result = findBestVendorMatch('Microsft', candidates, 0.99);
      expect(result).toBeNull();
    });
  });

  describe('suggestCanonicalName', () => {
    it('should title case the normalized name', () => {
      // Note: "corp" is a business suffix and gets removed by normalizeVendor
      expect(suggestCanonicalName('acme')).toBe('Acme');
      expect(suggestCanonicalName('ACME')).toBe('Acme');
      expect(suggestCanonicalName('acme solutions')).toBe('Acme Solutions');
    });

    it('should remove business suffixes', () => {
      expect(suggestCanonicalName('Acme LLC')).toBe('Acme');
      expect(suggestCanonicalName('The Acme Company')).toBe('Acme');
      expect(suggestCanonicalName('Acme Corp')).toBe('Acme'); // corp is removed
    });

    it('should handle empty input', () => {
      expect(suggestCanonicalName('')).toBe('');
    });

    it('should handle hyphenated names', () => {
      expect(suggestCanonicalName('coca-cola')).toBe('Coca Cola');
    });
  });
});
