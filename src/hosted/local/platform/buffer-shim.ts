/**
 * Browser substitute for the slice of Node's `Buffer` the server's route
 * modules touch (MUT-286 Phase B): `Buffer.from(str, 'utf8' | 'base64url')`
 * and `.toString('hex' | 'base64url' | 'utf8')` — cursors (`pagination.ts`,
 * `expenses/cursor.ts`, `conversions/cursor.ts`) and preview/session tokens.
 * Only this subset is implemented; it is not a general Buffer polyfill.
 *
 * `tsconfig.hosted-local.json` pins `@types/node` to the server's own copy
 * (see that file's comment) so `server/src/**`'s bare `Buffer` references
 * type-check the same way they do under `server`'s own `tsc` — which means
 * the *type* `Buffer` here is still Node's real, ~70-method interface.
 * `BufferShim` only ever reaches `globalThis.Buffer` through an explicit
 * `as unknown as typeof Buffer` cast (`installBufferShim`, below): it does
 * not — and structurally cannot — `implements Buffer`, and does not
 * override `Uint8Array`'s own static `from` (a subclass may not narrow it
 * without breaking the static side's Liskov substitution; `BufferShim.encode`
 * is the string-decoding factory instead, used internally and by the
 * `globalThis.Buffer.from` shim exported below).
 */

export type ShimBufferEncoding = 'utf8' | 'hex' | 'base64url';

const HEX_DIGITS = '0123456789abcdef';

/** eslint's portal rule bans `Number()`/`parseInt` (hosted-portal.md §7.3, amounts-as-strings); a lookup avoids both. */
function hexNibble(digit: string | undefined): number {
  const value = digit === undefined ? -1 : HEX_DIGITS.indexOf(digit.toLowerCase());
  if (value < 0) throw new RangeError(`Invalid hex digit: ${digit}`);
  return value;
}

/** A `Uint8Array` with the one `Buffer` instance method the server's cursors and tokens call. */
export class BufferShim extends Uint8Array {
  /** The string-decoding half of `Buffer.from`; the array-like half is `Uint8Array`'s own inherited `from`/constructor, unchanged. */
  static encode(value: string, encoding: ShimBufferEncoding): BufferShim {
    switch (encoding) {
      case 'utf8':
        return new BufferShim(new TextEncoder().encode(value));
      case 'hex':
        return BufferShim.fromHex(value);
      case 'base64url':
        return BufferShim.fromBase64Url(value);
    }
  }

  private static fromHex(hex: string): BufferShim {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (hexNibble(hex[i * 2]) << 4) | hexNibble(hex[i * 2 + 1]);
    return new BufferShim(bytes);
  }

  private static fromBase64Url(value: string): BufferShim {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new BufferShim(bytes);
  }

  toString(encoding: ShimBufferEncoding = 'utf8'): string {
    switch (encoding) {
      case 'utf8':
        return new TextDecoder().decode(this);
      case 'hex':
        return [...this].map((b) => b.toString(16).padStart(2, '0')).join('');
      case 'base64url': {
        let binary = '';
        for (const b of this) binary += String.fromCharCode(b);
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      }
    }
  }
}

/**
 * The one static method `server/src/**` actually calls on the global
 * `Buffer`; everything else of Node's real interface is never touched
 * (confirmed by grep — see this file's docblock and `crypto.ts`'s). Exported
 * as a standalone object, not only installed, so
 * `server/src/__tests__/platform-shim.test.ts` can swap it in for a direct
 * comparison against the real `Buffer` without needing `globalThis.Buffer` to
 * start out `undefined` (it never is under Node/Vitest).
 */
export const bufferShim = {
  from(data: string | ArrayLike<number> | ArrayBufferLike, encoding?: ShimBufferEncoding): BufferShim {
    return typeof data === 'string' ? BufferShim.encode(data, encoding ?? 'utf8') : new BufferShim(data as ArrayLike<number>);
  },
};

/** Idempotent: safe to call more than once (e.g. hot reload in dev). */
export function installBufferShim(): void {
  if (typeof globalThis.Buffer === 'undefined') {
    globalThis.Buffer = bufferShim as unknown as typeof Buffer;
  }
}
