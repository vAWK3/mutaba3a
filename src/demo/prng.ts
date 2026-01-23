/**
 * Seeded Pseudo-Random Number Generator
 *
 * Uses the Mulberry32 algorithm for deterministic random number generation.
 * This ensures demo data is reproducible across sessions and devices.
 */

import { DEMO_PREFIXES } from './constants';

/**
 * Mulberry32 PRNG - fast and good quality for non-cryptographic use
 * @param seed - 32-bit integer seed
 * @returns A function that returns random numbers in [0, 1)
 */
function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seeded random number generator with utility methods
 */
export class SeededRandom {
  private rng: () => number;

  constructor(seed: number = 42) {
    this.rng = mulberry32(seed);
  }

  /**
   * Get next random number in [0, 1)
   */
  next(): number {
    return this.rng();
  }

  /**
   * Get random integer in [min, max] (inclusive)
   */
  int(min: number, max: number): number {
    return Math.floor(this.rng() * (max - min + 1)) + min;
  }

  /**
   * Get random float in [min, max)
   */
  float(min: number, max: number): number {
    return this.rng() * (max - min) + min;
  }

  /**
   * Pick a random element from an array
   */
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.rng() * arr.length)];
  }

  /**
   * Pick multiple unique elements from an array
   */
  pickMany<T>(arr: readonly T[], count: number): T[] {
    const shuffled = this.shuffle([...arr]);
    return shuffled.slice(0, Math.min(count, arr.length));
  }

  /**
   * Shuffle an array using Fisher-Yates algorithm
   */
  shuffle<T>(arr: T[]): T[] {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /**
   * Return true with given probability (0-1)
   */
  chance(probability: number): boolean {
    return this.rng() < probability;
  }

  /**
   * Generate a demo entity ID with prefix and zero-padded index
   */
  demoId(prefix: keyof typeof DEMO_PREFIXES, index: number): string {
    return `${DEMO_PREFIXES[prefix]}${String(index).padStart(3, '0')}`;
  }

  /**
   * Generate a random date within a range
   */
  date(start: Date, end: Date): Date {
    const startTime = start.getTime();
    const endTime = end.getTime();
    return new Date(startTime + this.rng() * (endTime - startTime));
  }

  /**
   * Generate a random date string (YYYY-MM-DD) within a range
   */
  dateString(start: Date, end: Date): string {
    return this.date(start, end).toISOString().split('T')[0];
  }

  /**
   * Generate a random ISO timestamp within a range
   */
  isoTimestamp(start: Date, end: Date): string {
    return this.date(start, end).toISOString();
  }

  /**
   * Pick a weighted random item based on weights
   */
  weightedPick<T>(items: readonly T[], weights: readonly number[]): T {
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    let random = this.rng() * totalWeight;

    for (let i = 0; i < items.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        return items[i];
      }
    }

    return items[items.length - 1];
  }

  /**
   * Generate a random amount in minor units (cents/agorot)
   * Amounts are rounded to look realistic (multiples of 50 or 100)
   */
  amountMinor(minMajor: number, maxMajor: number): number {
    const major = this.int(minMajor, maxMajor);
    // Round to nearest 50 for cleaner amounts
    const rounded = Math.round(major / 50) * 50;
    return rounded * 100; // Convert to minor units
  }

  /**
   * Generate a random phone number (Israeli format)
   */
  phoneNumber(): string {
    const prefix = this.pick(['050', '052', '053', '054', '055', '058']);
    const digits = String(this.int(1000000, 9999999));
    return `${prefix}-${digits.slice(0, 3)}-${digits.slice(3)}`;
  }

  /**
   * Generate a random email from a name
   */
  email(name: string): string {
    const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '.');
    const domains = ['gmail.com', 'outlook.com', 'company.co.il', 'business.com'];
    return `${cleanName}@${this.pick(domains)}`;
  }
}

// Default seeded random instance
export const seededRandom = new SeededRandom();
