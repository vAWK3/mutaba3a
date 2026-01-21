/**
 * FX Rate Service
 * Fetches live rates from Frankfurter API, caches for offline use.
 */

import type { Currency } from '../../types';

// Types
export type FxSource = 'live' | 'cached' | 'none';

export interface FxRateResult {
  rate: number;
  base: Currency;
  quote: Currency;
  date: string;
  source: FxSource;
  fetchedAt: string;
}

export interface FxCacheEntry {
  rate: number;
  base: Currency;
  quote: Currency;
  date: string;
  fetchedAt: string;
}

interface FrankfurterResponse {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
}

// Constants
const FRANKFURTER_API = 'https://api.frankfurter.dev/v1/latest';
const CACHE_KEY = 'mutaba3a_fx_cache';
const CACHE_STALE_MS = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Get cached FX rate from localStorage
 */
export function getCachedFxRate(base: Currency, quote: Currency): FxCacheEntry | null {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    const store: Record<string, FxCacheEntry> = JSON.parse(cached);
    const key = `${base}-${quote}`;
    return store[key] || null;
  } catch {
    return null;
  }
}

/**
 * Save FX rate to localStorage cache
 */
export function saveFxToCache(entry: FxCacheEntry): void {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    const store: Record<string, FxCacheEntry> = cached ? JSON.parse(cached) : {};
    const key = `${entry.base}-${entry.quote}`;
    store[key] = entry;
    localStorage.setItem(CACHE_KEY, JSON.stringify(store));
  } catch {
    // Silently fail if localStorage is unavailable
  }
}

/**
 * Check if cached entry is stale (older than CACHE_STALE_MS)
 */
export function isCacheStale(entry: FxCacheEntry): boolean {
  const fetchedAt = new Date(entry.fetchedAt).getTime();
  const now = Date.now();
  return now - fetchedAt > CACHE_STALE_MS;
}

/**
 * Fetch live FX rate from Frankfurter API
 * Falls back to cached rate on failure
 */
export async function fetchLiveFxRate(
  base: Currency = 'USD',
  quote: Currency = 'ILS'
): Promise<FxRateResult> {
  const cached = getCachedFxRate(base, quote);
  const now = new Date().toISOString();

  // Check if online
  if (!navigator.onLine) {
    if (cached) {
      return {
        rate: cached.rate,
        base,
        quote,
        date: cached.date,
        source: 'cached',
        fetchedAt: cached.fetchedAt,
      };
    }
    return {
      rate: 0,
      base,
      quote,
      date: '',
      source: 'none',
      fetchedAt: now,
    };
  }

  try {
    const url = `${FRANKFURTER_API}?base=${base}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data: FrankfurterResponse = await response.json();
    const rate = data.rates[quote];

    if (typeof rate !== 'number' || rate <= 0) {
      throw new Error('Invalid rate received');
    }

    const entry: FxCacheEntry = {
      rate,
      base,
      quote,
      date: data.date,
      fetchedAt: now,
    };

    // Cache the result
    saveFxToCache(entry);

    // Also cache the inverse rate
    const inverseEntry: FxCacheEntry = {
      rate: 1 / rate,
      base: quote,
      quote: base,
      date: data.date,
      fetchedAt: now,
    };
    saveFxToCache(inverseEntry);

    return {
      rate,
      base,
      quote,
      date: data.date,
      source: 'live',
      fetchedAt: now,
    };
  } catch (error) {
    console.warn('FX fetch failed:', error);

    // Fall back to cached rate
    if (cached) {
      return {
        rate: cached.rate,
        base,
        quote,
        date: cached.date,
        source: 'cached',
        fetchedAt: cached.fetchedAt,
      };
    }

    return {
      rate: 0,
      base,
      quote,
      date: '',
      source: 'none',
      fetchedAt: now,
    };
  }
}

/**
 * Convert amount from one currency to another
 * @param amountMinor Amount in minor units (cents/agorot)
 * @param fromCurrency Source currency
 * @param toCurrency Target currency
 * @param rate Exchange rate (how many toCurrency per 1 fromCurrency)
 * @returns Converted amount in minor units
 */
export function convertAmount(
  amountMinor: number,
  fromCurrency: Currency,
  toCurrency: Currency,
  rate: number
): number {
  if (fromCurrency === toCurrency) {
    return amountMinor;
  }
  return Math.round(amountMinor * rate);
}

/**
 * Get unified total in target currency
 * @param usdMinor Amount in USD minor units
 * @param ilsMinor Amount in ILS minor units
 * @param targetCurrency Target currency for unified total
 * @param usdToIlsRate Exchange rate (how many ILS per 1 USD)
 * @returns Unified total in target currency minor units, or null if rate unavailable
 */
export function getUnifiedTotal(
  usdMinor: number,
  ilsMinor: number,
  targetCurrency: Currency,
  usdToIlsRate: number | null
): number | null {
  if (usdToIlsRate === null || usdToIlsRate <= 0) {
    return null;
  }

  if (targetCurrency === 'ILS') {
    // Convert USD to ILS and add
    const convertedUsd = convertAmount(usdMinor, 'USD', 'ILS', usdToIlsRate);
    return ilsMinor + convertedUsd;
  } else {
    // Convert ILS to USD and add
    const ilsToUsdRate = 1 / usdToIlsRate;
    const convertedIls = convertAmount(ilsMinor, 'ILS', 'USD', ilsToUsdRate);
    return usdMinor + convertedIls;
  }
}

/**
 * Get unified total in ILS including EUR amounts
 * @param usdMinor Amount in USD minor units
 * @param ilsMinor Amount in ILS minor units
 * @param eurMinor Amount in EUR minor units
 * @param usdToIlsRate Exchange rate (how many ILS per 1 USD)
 * @param eurToIlsRate Exchange rate (how many ILS per 1 EUR)
 * @returns Unified total in ILS minor units, or null if required rates unavailable
 */
export function getUnifiedTotalWithEur(
  usdMinor: number,
  ilsMinor: number,
  eurMinor: number,
  usdToIlsRate: number | null,
  eurToIlsRate: number | null
): number | null {
  // Need USD rate if there are USD amounts
  if (usdMinor !== 0 && (usdToIlsRate === null || usdToIlsRate <= 0)) {
    return null;
  }

  // Need EUR rate if there are EUR amounts
  if (eurMinor !== 0 && (eurToIlsRate === null || eurToIlsRate <= 0)) {
    return null;
  }

  // Convert everything to ILS
  const convertedUsd = usdMinor !== 0 && usdToIlsRate ? convertAmount(usdMinor, 'USD', 'ILS', usdToIlsRate) : 0;
  const convertedEur = eurMinor !== 0 && eurToIlsRate ? convertAmount(eurMinor, 'EUR', 'ILS', eurToIlsRate) : 0;

  return ilsMinor + convertedUsd + convertedEur;
}
