import type { HLC } from './ops-types';

/**
 * Hybrid Logical Clock implementation for distributed systems.
 *
 * Combines physical time with a logical counter to ensure:
 * 1. Timestamps are always monotonically increasing
 * 2. Causality is preserved (if A happens-before B, HLC(A) < HLC(B))
 * 3. Ordering is deterministic even when physical clocks are skewed
 *
 * Based on: "Logical Physical Clocks and Consistent Snapshots in Globally
 * Distributed Databases" by Kulkarni et al.
 */
export class HybridLogicalClock {
  private ts: number;
  private counter: number;
  private nodeId: string;

  constructor(nodeId: string, initialTs?: number, initialCounter?: number) {
    this.nodeId = nodeId;
    this.ts = initialTs ?? Date.now();
    this.counter = initialCounter ?? 0;
  }

  /**
   * Generate a new HLC timestamp for a local event.
   * Call this when creating a new operation.
   */
  tick(): HLC {
    const now = Date.now();

    if (now > this.ts) {
      // Physical clock advanced - use it and reset counter
      this.ts = now;
      this.counter = 0;
    } else {
      // Physical clock hasn't advanced - increment counter
      this.counter++;
    }

    return {
      ts: this.ts,
      counter: this.counter,
      nodeId: this.nodeId,
    };
  }

  /**
   * Update the clock when receiving a remote timestamp.
   * Call this when applying a remote operation.
   * Returns a new HLC that is guaranteed to be greater than both
   * the local clock and the received timestamp.
   */
  receive(remote: HLC): HLC {
    const now = Date.now();

    if (now > this.ts && now > remote.ts) {
      // Physical clock is ahead of both - use it
      this.ts = now;
      this.counter = 0;
    } else if (this.ts === remote.ts) {
      // Same physical time - take max counter + 1
      this.counter = Math.max(this.counter, remote.counter) + 1;
    } else if (remote.ts > this.ts) {
      // Remote is ahead - adopt remote time
      this.ts = remote.ts;
      this.counter = remote.counter + 1;
    } else {
      // We're ahead - just increment our counter
      this.counter++;
    }

    return {
      ts: this.ts,
      counter: this.counter,
      nodeId: this.nodeId,
    };
  }

  /**
   * Get current clock value without advancing it.
   */
  now(): HLC {
    return {
      ts: this.ts,
      counter: this.counter,
      nodeId: this.nodeId,
    };
  }

  /**
   * Compare two HLC timestamps.
   * Returns:
   *   - negative if a < b
   *   - zero if a === b
   *   - positive if a > b
   */
  static compare(a: HLC, b: HLC): number {
    // First compare physical timestamps
    if (a.ts !== b.ts) {
      return a.ts - b.ts;
    }

    // Then compare logical counters
    if (a.counter !== b.counter) {
      return a.counter - b.counter;
    }

    // Finally, use node ID for deterministic tie-breaking
    return a.nodeId.localeCompare(b.nodeId);
  }

  /**
   * Check if a is less than b.
   */
  static lt(a: HLC, b: HLC): boolean {
    return HybridLogicalClock.compare(a, b) < 0;
  }

  /**
   * Check if a is less than or equal to b.
   */
  static lte(a: HLC, b: HLC): boolean {
    return HybridLogicalClock.compare(a, b) <= 0;
  }

  /**
   * Check if a is greater than b.
   */
  static gt(a: HLC, b: HLC): boolean {
    return HybridLogicalClock.compare(a, b) > 0;
  }

  /**
   * Check if a is greater than or equal to b.
   */
  static gte(a: HLC, b: HLC): boolean {
    return HybridLogicalClock.compare(a, b) >= 0;
  }

  /**
   * Check if two HLCs are equal.
   */
  static eq(a: HLC, b: HLC): boolean {
    return a.ts === b.ts && a.counter === b.counter && a.nodeId === b.nodeId;
  }

  /**
   * Get the maximum of two HLCs.
   */
  static max(a: HLC, b: HLC): HLC {
    return HybridLogicalClock.compare(a, b) >= 0 ? a : b;
  }

  /**
   * Get the minimum of two HLCs.
   */
  static min(a: HLC, b: HLC): HLC {
    return HybridLogicalClock.compare(a, b) <= 0 ? a : b;
  }

  /**
   * Serialize HLC to a string for storage and indexing.
   * Format: TTTTTTTTTTT-CCCCC-NNNNNNNN
   * - T: Base36 timestamp (11 chars, padded)
   * - C: Base36 counter (5 chars, padded)
   * - N: Node ID (8 chars, truncated/padded)
   *
   * This format ensures lexicographic ordering matches HLC ordering.
   */
  static serialize(hlc: HLC): string {
    const ts = hlc.ts.toString(36).padStart(11, '0');
    const counter = hlc.counter.toString(36).padStart(5, '0');
    const nodeId = hlc.nodeId.slice(0, 8).padEnd(8, '0');
    return `${ts}-${counter}-${nodeId}`;
  }

  /**
   * Parse a serialized HLC string back to an HLC object.
   */
  static parse(str: string): HLC {
    const parts = str.split('-');
    if (parts.length < 3) {
      throw new Error(`Invalid HLC string: ${str}`);
    }

    return {
      ts: parseInt(parts[0], 36),
      counter: parseInt(parts[1], 36),
      nodeId: parts.slice(2).join('-'), // Handle node IDs with dashes
    };
  }

  /**
   * Create an HLC representing the earliest possible time.
   * Useful for "since the beginning" queries.
   */
  static zero(): HLC {
    return { ts: 0, counter: 0, nodeId: '' };
  }

  /**
   * Serialize the zero HLC.
   */
  static zeroString(): string {
    return HybridLogicalClock.serialize(HybridLogicalClock.zero());
  }

  /**
   * Check if an HLC is the zero value.
   */
  static isZero(hlc: HLC): boolean {
    return hlc.ts === 0 && hlc.counter === 0 && hlc.nodeId === '';
  }

  /**
   * Extract just the physical timestamp from an HLC.
   */
  static toDate(hlc: HLC): Date {
    return new Date(hlc.ts);
  }

  /**
   * Create an HLC from a Date (for import/migration purposes).
   * Counter will be 0, so this should not be used for new operations.
   */
  static fromDate(date: Date, nodeId: string): HLC {
    return {
      ts: date.getTime(),
      counter: 0,
      nodeId,
    };
  }
}

// Singleton instance - will be initialized with device ID
let globalClock: HybridLogicalClock | null = null;

/**
 * Initialize the global clock with the device ID.
 * Must be called once at app startup.
 */
export function initializeClock(deviceId: string): void {
  globalClock = new HybridLogicalClock(deviceId);
}

/**
 * Get the global clock instance.
 * Throws if not initialized.
 */
export function getClock(): HybridLogicalClock {
  if (!globalClock) {
    throw new Error('HLC not initialized. Call initializeClock() first.');
  }
  return globalClock;
}

/**
 * Generate a new HLC timestamp using the global clock.
 */
export function tick(): HLC {
  return getClock().tick();
}

/**
 * Update the global clock with a received timestamp.
 */
export function receive(remote: HLC): HLC {
  return getClock().receive(remote);
}
