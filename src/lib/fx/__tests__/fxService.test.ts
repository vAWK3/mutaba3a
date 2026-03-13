import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getCachedFxRate,
  saveFxToCache,
  isCacheStale,
  fetchLiveFxRate,
  convertAmount,
  getUnifiedTotal,
  getUnifiedTotalWithEur,
  type FxCacheEntry,
} from '../fxService';

const CACHE_KEY = 'mutaba3a_fx_cache';

describe('fxService', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('getCachedFxRate', () => {
    it('should return null when no cache exists', () => {
      const result = getCachedFxRate('USD', 'ILS');
      expect(result).toBeNull();
    });

    it('should return cached entry when exists', () => {
      const entry: FxCacheEntry = {
        rate: 3.7,
        base: 'USD',
        quote: 'ILS',
        date: '2024-03-15',
        fetchedAt: '2024-03-15T12:00:00Z',
      };
      const store = { 'USD-ILS': entry };
      localStorage.setItem(CACHE_KEY, JSON.stringify(store));

      const result = getCachedFxRate('USD', 'ILS');
      expect(result).toEqual(entry);
    });

    it('should return null for non-existent pair', () => {
      const entry: FxCacheEntry = {
        rate: 3.7,
        base: 'USD',
        quote: 'ILS',
        date: '2024-03-15',
        fetchedAt: '2024-03-15T12:00:00Z',
      };
      const store = { 'USD-ILS': entry };
      localStorage.setItem(CACHE_KEY, JSON.stringify(store));

      const result = getCachedFxRate('EUR', 'ILS');
      expect(result).toBeNull();
    });

    it('should return null on parse error', () => {
      localStorage.setItem(CACHE_KEY, 'invalid json');
      const result = getCachedFxRate('USD', 'ILS');
      expect(result).toBeNull();
    });
  });

  describe('saveFxToCache', () => {
    it('should save entry to cache', () => {
      const entry: FxCacheEntry = {
        rate: 3.7,
        base: 'USD',
        quote: 'ILS',
        date: '2024-03-15',
        fetchedAt: '2024-03-15T12:00:00Z',
      };

      saveFxToCache(entry);

      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      expect(cached['USD-ILS']).toEqual(entry);
    });

    it('should merge with existing cache', () => {
      const entry1: FxCacheEntry = {
        rate: 3.7,
        base: 'USD',
        quote: 'ILS',
        date: '2024-03-15',
        fetchedAt: '2024-03-15T12:00:00Z',
      };
      const entry2: FxCacheEntry = {
        rate: 1.1,
        base: 'EUR',
        quote: 'USD',
        date: '2024-03-15',
        fetchedAt: '2024-03-15T12:00:00Z',
      };

      saveFxToCache(entry1);
      saveFxToCache(entry2);

      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      expect(cached['USD-ILS']).toEqual(entry1);
      expect(cached['EUR-USD']).toEqual(entry2);
    });

    it('should silently fail when localStorage throws', () => {
      const mockSetItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Storage full');
      });

      const entry: FxCacheEntry = {
        rate: 3.7,
        base: 'USD',
        quote: 'ILS',
        date: '2024-03-15',
        fetchedAt: '2024-03-15T12:00:00Z',
      };

      // Should not throw
      expect(() => saveFxToCache(entry)).not.toThrow();

      mockSetItem.mockRestore();
    });
  });

  describe('isCacheStale', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return false for fresh cache', () => {
      vi.setSystemTime(new Date('2024-03-15T12:00:00Z'));

      const entry: FxCacheEntry = {
        rate: 3.7,
        base: 'USD',
        quote: 'ILS',
        date: '2024-03-15',
        fetchedAt: '2024-03-15T11:00:00Z', // 1 hour ago
      };

      expect(isCacheStale(entry)).toBe(false);
    });

    it('should return true for stale cache (> 4 hours)', () => {
      vi.setSystemTime(new Date('2024-03-15T18:00:00Z'));

      const entry: FxCacheEntry = {
        rate: 3.7,
        base: 'USD',
        quote: 'ILS',
        date: '2024-03-15',
        fetchedAt: '2024-03-15T12:00:00Z', // 6 hours ago
      };

      expect(isCacheStale(entry)).toBe(true);
    });
  });

  describe('fetchLiveFxRate', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-03-15T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return cached rate when offline', async () => {
      // Mock offline state
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

      const entry: FxCacheEntry = {
        rate: 3.7,
        base: 'USD',
        quote: 'ILS',
        date: '2024-03-14',
        fetchedAt: '2024-03-14T12:00:00Z',
      };
      saveFxToCache(entry);

      const result = await fetchLiveFxRate('USD', 'ILS');

      expect(result.source).toBe('cached');
      expect(result.rate).toBe(3.7);

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    });

    it('should return none when offline with no cache', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

      const result = await fetchLiveFxRate('USD', 'ILS');

      expect(result.source).toBe('none');
      expect(result.rate).toBe(0);

      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    });

    it('should fetch live rate and cache it', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

      const mockResponse = {
        amount: 1,
        base: 'USD',
        date: '2024-03-15',
        rates: { ILS: 3.7, EUR: 0.91 },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await fetchLiveFxRate('USD', 'ILS');

      expect(result.source).toBe('live');
      expect(result.rate).toBe(3.7);
      expect(result.date).toBe('2024-03-15');

      // Check it was cached
      const cached = getCachedFxRate('USD', 'ILS');
      expect(cached?.rate).toBe(3.7);

      // Check inverse was also cached
      const inverse = getCachedFxRate('ILS', 'USD');
      expect(inverse?.rate).toBeCloseTo(1 / 3.7, 5);
    });

    it('should fall back to cache on HTTP error', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

      const entry: FxCacheEntry = {
        rate: 3.5,
        base: 'USD',
        quote: 'ILS',
        date: '2024-03-14',
        fetchedAt: '2024-03-14T12:00:00Z',
      };
      saveFxToCache(entry);

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await fetchLiveFxRate('USD', 'ILS');

      expect(result.source).toBe('cached');
      expect(result.rate).toBe(3.5);
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('should return none on error with no cache', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await fetchLiveFxRate('USD', 'ILS');

      expect(result.source).toBe('none');
      expect(result.rate).toBe(0);

      warnSpy.mockRestore();
    });

    it('should handle invalid rate from API', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

      const mockResponse = {
        amount: 1,
        base: 'USD',
        date: '2024-03-15',
        rates: { ILS: 0 }, // Invalid rate
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await fetchLiveFxRate('USD', 'ILS');

      expect(result.source).toBe('none');

      warnSpy.mockRestore();
    });
  });

  describe('convertAmount', () => {
    it('should return same amount when currencies match', () => {
      const result = convertAmount(10000, 'USD', 'USD', 3.7);
      expect(result).toBe(10000);
    });

    it('should convert amount using rate', () => {
      const result = convertAmount(10000, 'USD', 'ILS', 3.7);
      expect(result).toBe(37000);
    });

    it('should round to nearest minor unit', () => {
      const result = convertAmount(10000, 'USD', 'ILS', 3.756);
      expect(result).toBe(37560);
    });
  });

  describe('getUnifiedTotal', () => {
    it('should return null when rate is null', () => {
      const result = getUnifiedTotal(10000, 5000, 'ILS', null);
      expect(result).toBeNull();
    });

    it('should return null when rate is zero', () => {
      const result = getUnifiedTotal(10000, 5000, 'ILS', 0);
      expect(result).toBeNull();
    });

    it('should convert USD to ILS when target is ILS', () => {
      // 10000 minor USD = $100, rate 3.7 = 37000 minor ILS
      // Plus 5000 minor ILS
      const result = getUnifiedTotal(10000, 5000, 'ILS', 3.7);
      expect(result).toBe(42000);
    });

    it('should convert ILS to USD when target is USD', () => {
      // 5000 minor ILS, rate 3.7 => 5000 / 3.7 = 1351.35 => rounds to 1351
      // Plus 10000 minor USD
      const result = getUnifiedTotal(10000, 5000, 'USD', 3.7);
      expect(result).toBe(11351);
    });
  });

  describe('getUnifiedTotalWithEur', () => {
    it('should return null when USD rate missing and USD amount present', () => {
      const result = getUnifiedTotalWithEur(10000, 5000, 0, null, 4.0);
      expect(result).toBeNull();
    });

    it('should return null when EUR rate missing and EUR amount present', () => {
      const result = getUnifiedTotalWithEur(0, 5000, 10000, 3.7, null);
      expect(result).toBeNull();
    });

    it('should work when only ILS amounts present', () => {
      const result = getUnifiedTotalWithEur(0, 5000, 0, null, null);
      expect(result).toBe(5000);
    });

    it('should convert all currencies to ILS', () => {
      // 10000 USD * 3.7 = 37000 ILS
      // 5000 EUR * 4.0 = 20000 ILS
      // Plus 3000 ILS base
      const result = getUnifiedTotalWithEur(10000, 3000, 5000, 3.7, 4.0);
      expect(result).toBe(60000);
    });

    it('should handle zero USD rate when USD amount is zero', () => {
      // Should not require USD rate when USD amount is 0
      const result = getUnifiedTotalWithEur(0, 5000, 2000, null, 4.0);
      expect(result).toBe(13000); // 5000 + 2000*4
    });

    it('should handle zero EUR rate when EUR amount is zero', () => {
      // Should not require EUR rate when EUR amount is 0
      const result = getUnifiedTotalWithEur(10000, 5000, 0, 3.7, null);
      expect(result).toBe(42000); // 10000*3.7 + 5000
    });
  });
});
