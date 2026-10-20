// @vitest-environment node
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BufferShim, bufferShim } from '../platform/buffer-shim.js';
import * as shimCrypto from '../platform/crypto.js';

/**
 * The browser shims for `node:crypto` and `Buffer` (MUT-286) checked from the
 * web suite, which is the one whose coverage counts `src/**`.
 * server/src/__tests__/platform-shim.test.ts runs the 10k-input parity sweep
 * and the production cursor formats; this file pins each branch of the shims
 * against real Node output on fixed inputs, including the paths that sweep
 * never reaches (multi-block messages, keys over one block, the randomUUID
 * fallback, invalid hex). asyncHooksShim.test.ts covers the third shim.
 */

const INPUTS = ['', 'abc', 'شمعة ✓', 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(64), 'q'.repeat(1000)];

describe('crypto shim', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(INPUTS)('SHA-256 of %j matches node:crypto in hex and base64url', (input) => {
    expect(shimCrypto.createHash('sha256').update(input).digest('hex')).toBe(createHash('sha256').update(input).digest('hex'));
    expect(shimCrypto.createHash('sha256').update(input).digest('base64url')).toBe(createHash('sha256').update(input).digest('base64url'));
  });

  it('hashes chunked string and byte updates as one message, and digest() returns bytes', () => {
    const real = createHash('sha256').update('hello, world').digest();
    const shimmed = shimCrypto.createHash('sha256').update('hello, ').update(new TextEncoder().encode('world')).digest();
    expect(shimmed).toBeInstanceOf(BufferShim);
    expect([...shimmed]).toEqual([...real]);
  });

  it.each([
    ['short string key', 'k'],
    ['64-byte key', 'k'.repeat(64)],
    ['key longer than one block', 'k'.repeat(65)],
  ])('HMAC-SHA256 with a %s matches node:crypto', (_label, key) => {
    for (const message of INPUTS) {
      expect(shimCrypto.createHmac('sha256', key).update(message).digest('hex')).toBe(createHmac('sha256', key).update(message).digest('hex'));
    }
  });

  it('HMAC accepts a byte key and chunked updates, and digest() returns bytes', () => {
    const key = Uint8Array.from([1, 2, 3, 250, 251, 252]);
    const real = createHmac('sha256', key).update('session:abc').digest();
    const shimmed = shimCrypto.createHmac('sha256', key).update('session:').update(new TextEncoder().encode('abc')).digest();
    expect(shimmed).toBeInstanceOf(BufferShim);
    expect([...shimmed]).toEqual([...real]);
    expect(shimCrypto.createHmac('sha256', key).update('session:abc').digest('base64url')).toBe(real.toString('base64url'));
  });

  it('timingSafeEqual agrees with node:crypto and refuses unequal lengths', () => {
    const a = Uint8Array.from([1, 2, 3, 4]);
    const same = Uint8Array.from([1, 2, 3, 4]);
    const differs = Uint8Array.from([1, 2, 3, 5]);
    expect(shimCrypto.timingSafeEqual(a, same)).toBe(timingSafeEqual(a, same));
    expect(shimCrypto.timingSafeEqual(a, differs)).toBe(timingSafeEqual(a, differs));
    expect(shimCrypto.timingSafeEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
    expect(() => shimCrypto.timingSafeEqual(a, new Uint8Array(5))).toThrow(RangeError);
  });

  it('randomBytes fills the requested length from Web Crypto', () => {
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues');
    const bytes = shimCrypto.randomBytes(24);
    expect(bytes).toBeInstanceOf(BufferShim);
    expect(bytes).toHaveLength(24);
    expect(spy).toHaveBeenCalledOnce();
  });

  const V4_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('randomUUID uses the native crypto.randomUUID when present', () => {
    const spy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('11111111-2222-4333-8444-555555555555');
    expect(shimCrypto.randomUUID()).toBe('11111111-2222-4333-8444-555555555555');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('randomUUID falls back to a v4 UUID built from random bytes', () => {
    const webCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => webCrypto.getRandomValues(bytes),
    });
    try {
      const ids = new Set(Array.from({ length: 50 }, () => shimCrypto.randomUUID()));
      expect(ids.size).toBe(50);
      for (const id of ids) expect(id).toMatch(V4_UUID);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('Buffer shim', () => {
  it.each(INPUTS)('utf8 → base64url → utf8 of %j matches Buffer', (text) => {
    const encoded = bufferShim.from(text, 'utf8').toString('base64url');
    expect(encoded).toBe(Buffer.from(text, 'utf8').toString('base64url'));
    expect(bufferShim.from(encoded, 'base64url').toString('utf8')).toBe(text);
  });

  it('defaults to utf8 both ways', () => {
    expect(bufferShim.from('مرحبا').toString()).toBe('مرحبا');
  });

  it('round-trips hex, in either case, like Buffer', () => {
    const bytes = Uint8Array.from([0, 15, 16, 127, 128, 255]);
    const hex = Buffer.from(bytes).toString('hex');
    expect(new BufferShim(bytes).toString('hex')).toBe(hex);
    expect([...bufferShim.from(hex, 'hex')]).toEqual([...bytes]);
    expect([...BufferShim.encode(hex.toUpperCase(), 'hex')]).toEqual([...bytes]);
  });

  it('rejects a non-hex digit', () => {
    expect(() => BufferShim.encode('0g', 'hex')).toThrow(RangeError);
  });

  it('wraps array-like input byte for byte', () => {
    const shimmed = bufferShim.from([104, 105]);
    expect(shimmed).toBeInstanceOf(BufferShim);
    expect(shimmed.toString('utf8')).toBe('hi');
  });
});
