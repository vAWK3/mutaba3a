/**
 * Browser substitute for `node:crypto`'s synchronous surface the portal's
 * shared route modules touch (MUT-286 Phase B), traced by grepping every
 * `node:crypto` import reachable from `createLocalApp` rather than guessed:
 * `randomUUID` (ids, `memory.ts`/`personal-profile.ts`/`routes/profiles.ts`),
 * `randomBytes` (`auth/sessions.ts` session tokens, `auth/api-key.ts` key
 * material — imported by `auth/middleware.ts`, so its module executes even
 * though local mode never issues API keys), `createHash('sha256')`
 * (`idempotency.ts`, `preview-token.ts`), `createHmac('sha256')`
 * (`auth/sessions.ts` `sessionDigest`, used directly by `mintLocalSession`)
 * and `timingSafeEqual` (`preview-token.ts`, `auth/api-key.ts`).
 *
 * Node's `createHash`/`createHmac` are synchronous; Web Crypto's
 * `subtle.digest`/`subtle.sign` are Promise-only, and every call site above
 * is synchronous. There is no synchronous browser-native SHA-256, so this is
 * a small pure-JS implementation (FIPS 180-4 / RFC 2104), checked
 * byte-for-byte against real `node:crypto` across randomized inputs in
 * `server/src/__tests__/platform-shim.test.ts`. `randomUUID`/`randomBytes`
 * use the real, CSPRNG-backed Web Crypto (`crypto.getRandomValues`), so
 * nothing about randomness is home-grown.
 */
import { BufferShim, type ShimBufferEncoding } from './buffer-shim.js';

type HashAlgorithm = 'sha256';

export function randomUUID(): string {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto.randomUUID === 'function') return webCrypto.randomUUID();
  // Fallback only (every target this bundle ships to has `crypto.randomUUID`): a random v4 UUID, RFC 4122 §4.4.
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function randomBytes(size: number): BufferShim {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  return new BufferShim(bytes);
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length');
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/**
 * Mirrors the two call shapes `node:crypto`'s `Hash`/`Hmac` actually get here:
 * `.digest('hex' | 'base64url')` (every real call site) and the no-argument
 * `Buffer`-returning form (unused today, kept for type parity with
 * `node:crypto` so a future caller isn't silently mistyped).
 */
class Hash {
  private readonly chunks: Uint8Array[] = [];

  update(data: string | Uint8Array): this {
    this.chunks.push(typeof data === 'string' ? new TextEncoder().encode(data) : data);
    return this;
  }

  digest(encoding: ShimBufferEncoding): string;
  digest(): BufferShim;
  digest(encoding?: ShimBufferEncoding): string | BufferShim {
    const bytes = new BufferShim(sha256(concatBytes(this.chunks)));
    return encoding ? bytes.toString(encoding) : bytes;
  }
}

class Hmac {
  private readonly chunks: Uint8Array[] = [];
  private readonly key: Uint8Array;

  constructor(key: Uint8Array) {
    this.key = key;
  }

  update(data: string | Uint8Array): this {
    this.chunks.push(typeof data === 'string' ? new TextEncoder().encode(data) : data);
    return this;
  }

  digest(encoding: ShimBufferEncoding): string;
  digest(): BufferShim;
  digest(encoding?: ShimBufferEncoding): string | BufferShim {
    const bytes = new BufferShim(hmacSha256(this.key, concatBytes(this.chunks)));
    return encoding ? bytes.toString(encoding) : bytes;
  }
}

export function createHash(algorithm: HashAlgorithm): Hash {
  void algorithm; // only 'sha256' is ever requested (see file docblock); nothing to branch on.
  return new Hash();
}

export function createHmac(algorithm: HashAlgorithm, key: string | Uint8Array): Hmac {
  void algorithm;
  return new Hmac(typeof key === 'string' ? new TextEncoder().encode(key) : key);
}

// ---- SHA-256 (FIPS 180-4), pure JS: the one piece with no synchronous browser-native equivalent ----

const ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INITIAL_HASH = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function padMessage(message: Uint8Array): Uint8Array {
  const bitLength = BigInt(message.length) * 8n;
  const withMarker = message.length + 1;
  const paddedLength = Math.ceil((withMarker + 8) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[message.length] = 0x80;
  new DataView(padded.buffer).setBigUint64(paddedLength - 8, bitLength, false);
  return padded;
}

function sha256(message: Uint8Array): Uint8Array {
  // Named locals, not an indexable array: `noUncheckedIndexedAccess` (matching server/tsconfig.json, see
  // tsconfig.hosted-local.json) treats every indexed read — destructuring included — as possibly `undefined`, which
  // just adds noise for a fixed set of 8 words carried across a `for` loop.
  let [h0, h1, h2, h3, h4, h5, h6, h7] = INITIAL_HASH as unknown as readonly [number, number, number, number, number, number, number, number];

  const padded = padMessage(message);
  const view = new DataView(padded.buffer);
  const w = new Uint32Array(64);

  for (let chunkStart = 0; chunkStart < padded.length; chunkStart += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(chunkStart + i * 4, false);
    for (let i = 16; i < 64; i++) {
      // Always in bounds: i ranges 16..63, so i-15/i-2/i-16/i-7 always land in 0..63.
      const wim15 = w[i - 15]!;
      const wim2 = w[i - 2]!;
      const s0 = rotr(wim15, 7) ^ rotr(wim15, 18) ^ (wim15 >>> 3);
      const s1 = rotr(wim2, 17) ^ rotr(wim2, 19) ^ (wim2 >>> 10);
      w[i] = w[i - 16]! + s0 + w[i - 7]! + s1;
    }

    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4,
      f = h5,
      g = h6,
      hh = h7;

    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + ROUND_CONSTANTS[i]! + w[i]!) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) | 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + hh) | 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((word, i) => outView.setUint32(i * 4, word, false));
  return out;
}

/** RFC 2104, block size 64 bytes (SHA-256's). */
function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  const BLOCK_SIZE = 64;
  const keyBlock = new Uint8Array(BLOCK_SIZE);
  keyBlock.set(key.length > BLOCK_SIZE ? sha256(key) : key);

  const ipad = new Uint8Array(BLOCK_SIZE);
  const opad = new Uint8Array(BLOCK_SIZE);
  for (let i = 0; i < BLOCK_SIZE; i++) {
    ipad[i] = keyBlock[i]! ^ 0x36;
    opad[i] = keyBlock[i]! ^ 0x5c;
  }

  const inner = sha256(concatBytes([ipad, message]));
  return sha256(concatBytes([opad, inner]));
}
