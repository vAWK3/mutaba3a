import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bufferShim, BufferShim } from '../../../src/hosted/local/platform/buffer-shim.js';
import * as shimCrypto from '../../../src/hosted/local/platform/crypto.js';
import { decodeConversionCursor, encodeConversionCursor } from '../conversions/cursor.js';
import { decodeExpenseCursor, encodeExpenseCursor } from '../expenses/cursor.js';
import { decodeCursor, encodeCursor } from '../pagination.js';

/**
 * MUT-286 Phase A listed this test under the server suite but it could only
 * be finished once Phase B's browser shims existed (`src/hosted/local/platform/`).
 * It proves the browser substitutes for `node:crypto`/`Buffer` are
 * byte-identical to the real Node implementations they replace in the hosted
 * build (vite.config.ts `hostedConfig()`'s `resolve.alias`) — SHA-256,
 * HMAC-SHA256 and base64url round-trips directly, and the three cursor
 * formats that are the actual production callers of all of it, run through
 * both implementations and compared.
 *
 * A fixed-seed PRNG, not `Math.random()`, for a deterministic, reproducible
 * run — a failure here must repro on the next run, not just the one that found it.
 */

// mulberry32: tiny, deterministic, seedable. Public domain algorithm.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 0x286_286_01;
const ITERATIONS = 10_000;

function randomByteArray(rand: () => number, maxLength: number): Uint8Array {
  const length = Math.floor(rand() * maxLength);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = Math.floor(rand() * 256);
  return bytes;
}

function bytesToString(bytes: Uint8Array): string {
  // Arbitrary bytes round-tripped through UTF-8 aren't always valid UTF-8; building the string from code points
  // (not decoding raw bytes) guarantees both implementations are hashing/encoding the exact same text.
  return Array.from(bytes, (b) => String.fromCharCode(b)).join('');
}

describe('platform shims: byte-identical to node:crypto / Buffer', () => {
  it(`SHA-256 matches real node:crypto across ${ITERATIONS} randomized inputs`, () => {
    const rand = mulberry32(SEED);
    for (let i = 0; i < ITERATIONS; i++) {
      const input = bytesToString(randomByteArray(rand, 256));
      const real = createHash('sha256').update(input, 'utf8').digest('hex');
      const shimmed = shimCrypto.createHash('sha256').update(input).digest('hex');
      expect(shimmed).toBe(real);
    }
  });

  it(`HMAC-SHA256 matches real node:crypto across ${ITERATIONS} randomized inputs`, () => {
    const rand = mulberry32(SEED + 1);
    for (let i = 0; i < ITERATIONS; i++) {
      const key = bytesToString(randomByteArray(rand, 64));
      const message = bytesToString(randomByteArray(rand, 256));
      const real = createHmac('sha256', key).update(message, 'utf8').digest('hex');
      const shimmed = shimCrypto.createHmac('sha256', key).update(message).digest('hex');
      expect(shimmed).toBe(real);
    }
  });

  it(`base64url round-trips match real Buffer across ${ITERATIONS} randomized inputs`, () => {
    const rand = mulberry32(SEED + 2);
    for (let i = 0; i < ITERATIONS; i++) {
      const text = bytesToString(randomByteArray(rand, 200));
      const realEncoded = Buffer.from(text, 'utf8').toString('base64url');
      const shimEncoded = bufferShim.from(text, 'utf8').toString('base64url');
      expect(shimEncoded).toBe(realEncoded);

      const realDecoded = Buffer.from(realEncoded, 'base64url').toString('utf8');
      const shimDecoded = bufferShim.from(realEncoded, 'base64url').toString('utf8');
      expect(shimDecoded).toBe(text);
      expect(shimDecoded).toBe(realDecoded);
    }
  });

  it('randomBytes/randomUUID produce correctly-shaped, CSPRNG-backed output', () => {
    // Not a parity check against node:crypto's own randomness (there is nothing to compare — both are random) — this
    // asserts the shim's output has the right shape (Web Crypto's getRandomValues really did run) and that
    // randomUUID() produces RFC 4122 v4-shaped ids.
    const bytes = shimCrypto.randomBytes(32);
    expect(bytes).toHaveLength(32);
    expect(bytes instanceof BufferShim).toBe(true);

    const uuid = shimCrypto.randomUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('timingSafeEqual matches real node:crypto', () => {
    const rand = mulberry32(SEED + 3);
    for (let i = 0; i < 1000; i++) {
      const a = randomByteArray(rand, 64);
      const equal = rand() < 0.5;
      const b = equal ? Uint8Array.from(a) : randomByteArray(rand, a.length || 1);
      if (b.length !== a.length) continue; // timingSafeEqual requires equal length on both sides
      expect(shimCrypto.timingSafeEqual(a, b)).toBe(timingSafeEqual(a, b));
    }
    expect(() => shimCrypto.timingSafeEqual(new Uint8Array(4), new Uint8Array(5))).toThrow(RangeError);
  });

  describe('cursor formats actually used in production (pagination.ts / expenses/cursor.ts / conversions/cursor.ts)', () => {
    const realBuffer = globalThis.Buffer;

    function withShimBuffer<T>(fn: () => T): T {
      globalThis.Buffer = bufferShim as unknown as typeof Buffer;
      try {
        return fn();
      } finally {
        globalThis.Buffer = realBuffer;
      }
    }

    it('encodeCursor/decodeCursor (pagination.ts) agree byte-for-byte with the shim installed', () => {
      const rand = mulberry32(SEED + 4);
      for (let i = 0; i < 500; i++) {
        const cursor = { createdAt: new Date(Math.floor(rand() * 2_000_000_000_000)), id: randomUuidLike(rand) };
        const real = encodeCursor(cursor);
        const shimmed = withShimBuffer(() => encodeCursor(cursor));
        expect(shimmed).toBe(real);
        expect(withShimBuffer(() => decodeCursor(real))).toEqual(decodeCursor(real));
      }
    });

    it('encodeExpenseCursor/decodeExpenseCursor agree byte-for-byte with the shim installed', () => {
      const rand = mulberry32(SEED + 5);
      for (let i = 0; i < 500; i++) {
        const cursor = { occurredOn: randomIsoDate(rand), id: randomUuidLike(rand) };
        const real = encodeExpenseCursor(cursor);
        const shimmed = withShimBuffer(() => encodeExpenseCursor(cursor));
        expect(shimmed).toBe(real);
        expect(withShimBuffer(() => decodeExpenseCursor(real))).toEqual(decodeExpenseCursor(real));
      }
    });

    it('encodeConversionCursor/decodeConversionCursor agree byte-for-byte with the shim installed', () => {
      const rand = mulberry32(SEED + 6);
      for (let i = 0; i < 500; i++) {
        const cursor = { occurredOn: randomIsoDate(rand), id: randomUuidLike(rand) };
        const real = encodeConversionCursor(cursor);
        const shimmed = withShimBuffer(() => encodeConversionCursor(cursor));
        expect(shimmed).toBe(real);
        expect(withShimBuffer(() => decodeConversionCursor(real))).toEqual(decodeConversionCursor(real));
      }
    });
  });
});

function randomUuidLike(rand: () => number): string {
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[Math.floor(rand() * 4)]}${hex(3)}-${hex(12)}`;
}

function randomIsoDate(rand: () => number): string {
  const year = 2000 + Math.floor(rand() * 50);
  const month = String(1 + Math.floor(rand() * 12)).padStart(2, '0');
  const day = String(1 + Math.floor(rand() * 28)).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
