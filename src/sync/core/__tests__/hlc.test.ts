import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HybridLogicalClock,
  initializeClock,
  getClock,
  tick,
  receive,
} from '../hlc';
import type { HLC } from '../ops-types';

describe('HybridLogicalClock', () => {
  describe('constructor', () => {
    it('should create a clock with given nodeId', () => {
      const clock = new HybridLogicalClock('node-1');
      const hlc = clock.now();
      expect(hlc.nodeId).toBe('node-1');
    });

    it('should use current time if no initialTs provided', () => {
      const before = Date.now();
      const clock = new HybridLogicalClock('node-1');
      const after = Date.now();
      const hlc = clock.now();

      expect(hlc.ts).toBeGreaterThanOrEqual(before);
      expect(hlc.ts).toBeLessThanOrEqual(after);
    });

    it('should use provided initialTs', () => {
      const clock = new HybridLogicalClock('node-1', 1000, 5);
      const hlc = clock.now();

      expect(hlc.ts).toBe(1000);
      expect(hlc.counter).toBe(5);
    });

    it('should default counter to 0 if not provided', () => {
      const clock = new HybridLogicalClock('node-1', 1000);
      const hlc = clock.now();

      expect(hlc.counter).toBe(0);
    });
  });

  describe('tick()', () => {
    it('should generate monotonically increasing timestamps', () => {
      const clock = new HybridLogicalClock('node-1');
      const first = clock.tick();
      const second = clock.tick();
      const third = clock.tick();

      expect(HybridLogicalClock.lt(first, second)).toBe(true);
      expect(HybridLogicalClock.lt(second, third)).toBe(true);
    });

    it('should increment counter when physical time has not advanced', () => {
      // Fix Date.now to a specific value
      const fixedTime = 1700000000000;
      vi.spyOn(Date, 'now').mockReturnValue(fixedTime);

      const clock = new HybridLogicalClock('node-1', fixedTime, 0);

      const first = clock.tick();
      const second = clock.tick();
      const third = clock.tick();

      expect(first.ts).toBe(fixedTime);
      expect(first.counter).toBe(1);
      expect(second.counter).toBe(2);
      expect(third.counter).toBe(3);

      vi.restoreAllMocks();
    });

    it('should reset counter when physical time advances', () => {
      let currentTime = 1700000000000;
      vi.spyOn(Date, 'now').mockImplementation(() => currentTime);

      const clock = new HybridLogicalClock('node-1', currentTime - 1000, 0);

      const first = clock.tick();
      expect(first.ts).toBe(currentTime);
      expect(first.counter).toBe(0);

      // Advance time
      currentTime += 1000;
      const second = clock.tick();
      expect(second.ts).toBe(currentTime);
      expect(second.counter).toBe(0);

      vi.restoreAllMocks();
    });

    it('should preserve nodeId across ticks', () => {
      const clock = new HybridLogicalClock('my-unique-node');
      const first = clock.tick();
      const second = clock.tick();

      expect(first.nodeId).toBe('my-unique-node');
      expect(second.nodeId).toBe('my-unique-node');
    });
  });

  describe('receive()', () => {
    it('should return HLC greater than both local and remote', () => {
      const clock = new HybridLogicalClock('node-1', 1000, 5);
      const remote: HLC = { ts: 2000, counter: 10, nodeId: 'node-2' };

      const result = clock.receive(remote);

      expect(HybridLogicalClock.gt(result, remote)).toBe(true);
    });

    it('should adopt remote time when remote is ahead', () => {
      const fixedTime = 1000;
      vi.spyOn(Date, 'now').mockReturnValue(fixedTime);

      const clock = new HybridLogicalClock('node-1', 500, 0);
      const remote: HLC = { ts: 2000, counter: 5, nodeId: 'node-2' };

      const result = clock.receive(remote);

      expect(result.ts).toBe(2000);
      expect(result.counter).toBe(6); // remote.counter + 1

      vi.restoreAllMocks();
    });

    it('should take max counter + 1 when times are equal', () => {
      const fixedTime = 1000;
      vi.spyOn(Date, 'now').mockReturnValue(fixedTime);

      const clock = new HybridLogicalClock('node-1', 2000, 3);
      const remote: HLC = { ts: 2000, counter: 5, nodeId: 'node-2' };

      const result = clock.receive(remote);

      expect(result.ts).toBe(2000);
      expect(result.counter).toBe(6); // max(3, 5) + 1

      vi.restoreAllMocks();
    });

    it('should increment own counter when local is ahead', () => {
      const fixedTime = 1000;
      vi.spyOn(Date, 'now').mockReturnValue(fixedTime);

      const clock = new HybridLogicalClock('node-1', 3000, 5);
      const remote: HLC = { ts: 2000, counter: 10, nodeId: 'node-2' };

      const result = clock.receive(remote);

      expect(result.ts).toBe(3000);
      expect(result.counter).toBe(6);

      vi.restoreAllMocks();
    });

    it('should use physical clock when it is ahead of both', () => {
      const fixedTime = 5000;
      vi.spyOn(Date, 'now').mockReturnValue(fixedTime);

      const clock = new HybridLogicalClock('node-1', 1000, 5);
      const remote: HLC = { ts: 2000, counter: 10, nodeId: 'node-2' };

      const result = clock.receive(remote);

      expect(result.ts).toBe(5000);
      expect(result.counter).toBe(0);

      vi.restoreAllMocks();
    });

    it('should preserve local nodeId', () => {
      const clock = new HybridLogicalClock('local-node');
      const remote: HLC = { ts: 2000, counter: 5, nodeId: 'remote-node' };

      const result = clock.receive(remote);

      expect(result.nodeId).toBe('local-node');
    });
  });

  describe('now()', () => {
    it('should return current clock value without advancing', () => {
      const clock = new HybridLogicalClock('node-1', 1000, 5);

      const first = clock.now();
      const second = clock.now();

      expect(HybridLogicalClock.eq(first, second)).toBe(true);
    });
  });

  describe('compare()', () => {
    it('should return negative when a < b (by timestamp)', () => {
      const a: HLC = { ts: 1000, counter: 0, nodeId: 'node-1' };
      const b: HLC = { ts: 2000, counter: 0, nodeId: 'node-1' };

      expect(HybridLogicalClock.compare(a, b)).toBeLessThan(0);
    });

    it('should return positive when a > b (by timestamp)', () => {
      const a: HLC = { ts: 2000, counter: 0, nodeId: 'node-1' };
      const b: HLC = { ts: 1000, counter: 0, nodeId: 'node-1' };

      expect(HybridLogicalClock.compare(a, b)).toBeGreaterThan(0);
    });

    it('should compare by counter when timestamps are equal', () => {
      const a: HLC = { ts: 1000, counter: 5, nodeId: 'node-1' };
      const b: HLC = { ts: 1000, counter: 10, nodeId: 'node-1' };

      expect(HybridLogicalClock.compare(a, b)).toBeLessThan(0);
    });

    it('should use nodeId for tie-breaking when ts and counter are equal', () => {
      const a: HLC = { ts: 1000, counter: 5, nodeId: 'aaa' };
      const b: HLC = { ts: 1000, counter: 5, nodeId: 'bbb' };

      expect(HybridLogicalClock.compare(a, b)).toBeLessThan(0);
      expect(HybridLogicalClock.compare(b, a)).toBeGreaterThan(0);
    });

    it('should return 0 for identical HLCs', () => {
      const a: HLC = { ts: 1000, counter: 5, nodeId: 'node-1' };
      const b: HLC = { ts: 1000, counter: 5, nodeId: 'node-1' };

      expect(HybridLogicalClock.compare(a, b)).toBe(0);
    });
  });

  describe('comparison operators', () => {
    const earlier: HLC = { ts: 1000, counter: 0, nodeId: 'node-1' };
    const later: HLC = { ts: 2000, counter: 0, nodeId: 'node-1' };
    const same: HLC = { ts: 1000, counter: 0, nodeId: 'node-1' };

    describe('lt()', () => {
      it('should return true when a < b', () => {
        expect(HybridLogicalClock.lt(earlier, later)).toBe(true);
      });

      it('should return false when a >= b', () => {
        expect(HybridLogicalClock.lt(later, earlier)).toBe(false);
        expect(HybridLogicalClock.lt(earlier, same)).toBe(false);
      });
    });

    describe('lte()', () => {
      it('should return true when a <= b', () => {
        expect(HybridLogicalClock.lte(earlier, later)).toBe(true);
        expect(HybridLogicalClock.lte(earlier, same)).toBe(true);
      });

      it('should return false when a > b', () => {
        expect(HybridLogicalClock.lte(later, earlier)).toBe(false);
      });
    });

    describe('gt()', () => {
      it('should return true when a > b', () => {
        expect(HybridLogicalClock.gt(later, earlier)).toBe(true);
      });

      it('should return false when a <= b', () => {
        expect(HybridLogicalClock.gt(earlier, later)).toBe(false);
        expect(HybridLogicalClock.gt(earlier, same)).toBe(false);
      });
    });

    describe('gte()', () => {
      it('should return true when a >= b', () => {
        expect(HybridLogicalClock.gte(later, earlier)).toBe(true);
        expect(HybridLogicalClock.gte(earlier, same)).toBe(true);
      });

      it('should return false when a < b', () => {
        expect(HybridLogicalClock.gte(earlier, later)).toBe(false);
      });
    });

    describe('eq()', () => {
      it('should return true for identical HLCs', () => {
        expect(HybridLogicalClock.eq(earlier, same)).toBe(true);
      });

      it('should return false for different HLCs', () => {
        expect(HybridLogicalClock.eq(earlier, later)).toBe(false);
      });

      it('should return false when only nodeId differs', () => {
        const a: HLC = { ts: 1000, counter: 0, nodeId: 'node-a' };
        const b: HLC = { ts: 1000, counter: 0, nodeId: 'node-b' };
        expect(HybridLogicalClock.eq(a, b)).toBe(false);
      });
    });
  });

  describe('max() and min()', () => {
    const earlier: HLC = { ts: 1000, counter: 0, nodeId: 'node-1' };
    const later: HLC = { ts: 2000, counter: 0, nodeId: 'node-1' };

    it('max() should return the greater HLC', () => {
      expect(HybridLogicalClock.max(earlier, later)).toBe(later);
      expect(HybridLogicalClock.max(later, earlier)).toBe(later);
    });

    it('min() should return the lesser HLC', () => {
      expect(HybridLogicalClock.min(earlier, later)).toBe(earlier);
      expect(HybridLogicalClock.min(later, earlier)).toBe(earlier);
    });

    it('max() should return first when equal', () => {
      const a: HLC = { ts: 1000, counter: 0, nodeId: 'node-1' };
      const b: HLC = { ts: 1000, counter: 0, nodeId: 'node-1' };
      expect(HybridLogicalClock.max(a, b)).toBe(a);
    });

    it('min() should return first when equal', () => {
      const a: HLC = { ts: 1000, counter: 0, nodeId: 'node-1' };
      const b: HLC = { ts: 1000, counter: 0, nodeId: 'node-1' };
      expect(HybridLogicalClock.min(a, b)).toBe(a);
    });
  });

  describe('serialization', () => {
    describe('serialize()', () => {
      it('should produce a string in correct format', () => {
        const hlc: HLC = { ts: 1700000000000, counter: 42, nodeId: 'device12' };
        const serialized = HybridLogicalClock.serialize(hlc);

        // Format: TTTTTTTTTTT-CCCCC-NNNNNNNN
        expect(serialized).toMatch(/^[0-9a-z]{11}-[0-9a-z]{5}-[a-z0-9]{8}$/i);
      });

      it('should truncate long nodeIds to 8 chars', () => {
        const hlc: HLC = { ts: 1000, counter: 0, nodeId: 'very-long-node-id-here' };
        const serialized = HybridLogicalClock.serialize(hlc);

        expect(serialized.endsWith('very-lon')).toBe(true);
      });

      it('should pad short nodeIds to 8 chars', () => {
        const hlc: HLC = { ts: 1000, counter: 0, nodeId: 'ab' };
        const serialized = HybridLogicalClock.serialize(hlc);

        expect(serialized.endsWith('ab000000')).toBe(true);
      });

      it('should maintain lexicographic ordering', () => {
        const earlier: HLC = { ts: 1000, counter: 0, nodeId: 'node-1' };
        const later: HLC = { ts: 2000, counter: 0, nodeId: 'node-1' };

        const serializedEarlier = HybridLogicalClock.serialize(earlier);
        const serializedLater = HybridLogicalClock.serialize(later);

        expect(serializedEarlier < serializedLater).toBe(true);
      });

      it('should maintain ordering with different counters', () => {
        const low: HLC = { ts: 1000, counter: 5, nodeId: 'node-1' };
        const high: HLC = { ts: 1000, counter: 100, nodeId: 'node-1' };

        const serializedLow = HybridLogicalClock.serialize(low);
        const serializedHigh = HybridLogicalClock.serialize(high);

        expect(serializedLow < serializedHigh).toBe(true);
      });
    });

    describe('parse()', () => {
      it('should parse a valid HLC string', () => {
        const original: HLC = { ts: 1700000000000, counter: 42, nodeId: 'device12' };
        const serialized = HybridLogicalClock.serialize(original);
        const parsed = HybridLogicalClock.parse(serialized);

        expect(parsed.ts).toBe(original.ts);
        expect(parsed.counter).toBe(original.counter);
        // Note: nodeId might be truncated/padded, so compare prefix
        expect(parsed.nodeId.startsWith('device12')).toBe(true);
      });

      it('should handle nodeIds with dashes', () => {
        const hlc: HLC = { ts: 1000, counter: 0, nodeId: 'a-b-c-d-e' };
        const serialized = HybridLogicalClock.serialize(hlc);
        const parsed = HybridLogicalClock.parse(serialized);

        // Truncated to 8 chars: 'a-b-c-d-'
        expect(parsed.nodeId).toBe('a-b-c-d-');
      });

      it('should throw on invalid format', () => {
        expect(() => HybridLogicalClock.parse('invalid')).toThrow('Invalid HLC string');
        expect(() => HybridLogicalClock.parse('abc-def')).toThrow('Invalid HLC string');
      });

      it('should roundtrip serialize/parse', () => {
        const original: HLC = { ts: 1234567890123, counter: 999, nodeId: 'testnode' };
        const serialized = HybridLogicalClock.serialize(original);
        const parsed = HybridLogicalClock.parse(serialized);

        expect(parsed.ts).toBe(original.ts);
        expect(parsed.counter).toBe(original.counter);
        expect(parsed.nodeId).toBe('testnode');
      });
    });
  });

  describe('zero values', () => {
    describe('zero()', () => {
      it('should return HLC with all zero values', () => {
        const zero = HybridLogicalClock.zero();

        expect(zero.ts).toBe(0);
        expect(zero.counter).toBe(0);
        expect(zero.nodeId).toBe('');
      });
    });

    describe('zeroString()', () => {
      it('should return serialized zero HLC', () => {
        const zeroStr = HybridLogicalClock.zeroString();
        const parsed = HybridLogicalClock.parse(zeroStr);

        expect(parsed.ts).toBe(0);
        expect(parsed.counter).toBe(0);
      });
    });

    describe('isZero()', () => {
      it('should return true for zero HLC', () => {
        expect(HybridLogicalClock.isZero(HybridLogicalClock.zero())).toBe(true);
      });

      it('should return false for non-zero HLC', () => {
        expect(HybridLogicalClock.isZero({ ts: 1, counter: 0, nodeId: '' })).toBe(false);
        expect(HybridLogicalClock.isZero({ ts: 0, counter: 1, nodeId: '' })).toBe(false);
        expect(HybridLogicalClock.isZero({ ts: 0, counter: 0, nodeId: 'a' })).toBe(false);
      });
    });
  });

  describe('date conversion', () => {
    describe('toDate()', () => {
      it('should convert HLC timestamp to Date', () => {
        const timestamp = 1700000000000;
        const hlc: HLC = { ts: timestamp, counter: 5, nodeId: 'node-1' };
        const date = HybridLogicalClock.toDate(hlc);

        expect(date.getTime()).toBe(timestamp);
      });
    });

    describe('fromDate()', () => {
      it('should create HLC from Date with zero counter', () => {
        const date = new Date(1700000000000);
        const hlc = HybridLogicalClock.fromDate(date, 'node-1');

        expect(hlc.ts).toBe(1700000000000);
        expect(hlc.counter).toBe(0);
        expect(hlc.nodeId).toBe('node-1');
      });
    });
  });
});

describe('Global Clock Functions', () => {
  beforeEach(() => {
    // Reset the global clock before each test
    // We need to access the module's internal state
    // Since there's no reset function, we'll re-initialize
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initializeClock()', () => {
    it('should initialize the global clock', () => {
      initializeClock('test-device-1');
      const clock = getClock();

      expect(clock).toBeInstanceOf(HybridLogicalClock);
    });

    it('should use provided deviceId', () => {
      initializeClock('my-device-id');
      const hlc = tick();

      expect(hlc.nodeId).toBe('my-device-id');
    });
  });

  describe('getClock()', () => {
    it('should return the initialized clock', () => {
      initializeClock('device-for-get');
      const clock = getClock();

      expect(clock).toBeDefined();
      expect(clock.now().nodeId).toBe('device-for-get');
    });
  });

  describe('tick()', () => {
    it('should generate HLC using global clock', () => {
      initializeClock('tick-device');
      const hlc = tick();

      expect(hlc.nodeId).toBe('tick-device');
      expect(hlc.ts).toBeGreaterThan(0);
    });

    it('should generate monotonically increasing timestamps', () => {
      initializeClock('mono-device');
      const first = tick();
      const second = tick();
      const third = tick();

      expect(HybridLogicalClock.lt(first, second)).toBe(true);
      expect(HybridLogicalClock.lt(second, third)).toBe(true);
    });
  });

  describe('receive()', () => {
    it('should update global clock with remote timestamp', () => {
      initializeClock('receive-device');
      const remote: HLC = { ts: Date.now() + 10000, counter: 5, nodeId: 'remote' };

      const result = receive(remote);

      expect(result.nodeId).toBe('receive-device');
      expect(HybridLogicalClock.gt(result, remote)).toBe(true);
    });
  });
});

describe('HLC Causality Guarantees', () => {
  it('should preserve happens-before relationship across nodes', () => {
    const node1 = new HybridLogicalClock('node-1');
    const node2 = new HybridLogicalClock('node-2');

    // Node 1 creates event A
    const eventA = node1.tick();

    // Node 2 receives A and creates event B
    node2.receive(eventA);
    const eventB = node2.tick();

    // B must be after A (causality preserved)
    expect(HybridLogicalClock.gt(eventB, eventA)).toBe(true);
  });

  it('should handle concurrent events with deterministic ordering', () => {
    const fixedTime = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(fixedTime);

    const node1 = new HybridLogicalClock('aaa', fixedTime, 0);
    const node2 = new HybridLogicalClock('bbb', fixedTime, 0);

    // Both nodes create events at same time with same counter
    const event1 = node1.tick();
    const event2 = node2.tick();

    // They should have deterministic ordering based on nodeId
    expect(HybridLogicalClock.compare(event1, event2)).toBeLessThan(0);

    vi.restoreAllMocks();
  });

  it('should handle clock skew gracefully', () => {
    // Node 2 has a clock way in the future
    const node1 = new HybridLogicalClock('node-1', 1000, 0);
    const node2 = new HybridLogicalClock('node-2', 5000, 0);

    const remoteEvent = node2.tick();

    // Node 1 receives and must still generate valid timestamp
    const localAfter = node1.receive(remoteEvent);

    // Local clock should now be ahead of remote
    expect(HybridLogicalClock.gt(localAfter, remoteEvent)).toBe(true);

    // Future local events should still be monotonic
    const nextLocal = node1.tick();
    expect(HybridLogicalClock.gt(nextLocal, localAfter)).toBe(true);
  });
});
