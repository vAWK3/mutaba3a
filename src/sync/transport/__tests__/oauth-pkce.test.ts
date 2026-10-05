import { describe, it, expect } from 'vitest';
import {
  base64UrlEncode,
  generateCodeVerifier,
  deriveCodeChallenge,
  generateState,
  createPkcePair,
  MIN_VERIFIER_LENGTH,
  MAX_VERIFIER_LENGTH,
} from '../oauth-pkce';

/**
 * RFC 7636 Appendix B test vector. This is the one assertion in this file that
 * proves we implement S256 the way the authorization server will verify it —
 * everything else is shape and charset.
 */
const RFC7636_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC7636_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

/** Deterministic byte source so verifier/state generation is testable. */
function fixedBytes(fill: number): (n: number) => Uint8Array {
  return (n: number) => new Uint8Array(n).fill(fill);
}

describe('base64UrlEncode', () => {
  it('uses the URL-safe alphabet and strips padding', () => {
    // 0xff 0xff 0xff would be "////" in standard base64 and needs padding at 4 bytes.
    const encoded = base64UrlEncode(new Uint8Array([0xff, 0xff, 0xff, 0xfb, 0xff]));
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
    expect(encoded).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('round-trips the RFC 7636 verifier bytes to the expected charset', () => {
    const encoded = base64UrlEncode(new Uint8Array(32).fill(0));
    expect(encoded).toBe('A'.repeat(43));
  });

  it('returns an empty string for empty input', () => {
    expect(base64UrlEncode(new Uint8Array(0))).toBe('');
  });
});

describe('deriveCodeChallenge', () => {
  it('matches the RFC 7636 Appendix B test vector', async () => {
    await expect(deriveCodeChallenge(RFC7636_VERIFIER)).resolves.toBe(RFC7636_CHALLENGE);
  });

  it('is deterministic for the same verifier', async () => {
    const a = await deriveCodeChallenge(RFC7636_VERIFIER);
    const b = await deriveCodeChallenge(RFC7636_VERIFIER);
    expect(a).toBe(b);
  });

  it('produces a different challenge for a different verifier', async () => {
    const a = await deriveCodeChallenge(RFC7636_VERIFIER);
    const b = await deriveCodeChallenge(`${RFC7636_VERIFIER.slice(0, -1)}X`);
    expect(a).not.toBe(b);
  });

  it('rejects a verifier shorter than the RFC minimum', async () => {
    await expect(deriveCodeChallenge('tooshort')).rejects.toThrow(/verifier/i);
  });

  it('rejects a verifier longer than the RFC maximum', async () => {
    await expect(deriveCodeChallenge('a'.repeat(MAX_VERIFIER_LENGTH + 1))).rejects.toThrow(
      /verifier/i
    );
  });

  it('rejects a verifier containing characters outside the RFC unreserved set', async () => {
    // Correct length, illegal character — the server would reject this, so we must too.
    await expect(deriveCodeChallenge(`${'a'.repeat(42)}+`)).rejects.toThrow(/verifier/i);
  });
});

describe('generateCodeVerifier', () => {
  it('produces a 43-character verifier from 32 bytes of entropy', () => {
    expect(generateCodeVerifier(fixedBytes(0))).toHaveLength(43);
  });

  it('stays within the RFC length bounds', () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(MIN_VERIFIER_LENGTH);
    expect(verifier.length).toBeLessThanOrEqual(MAX_VERIFIER_LENGTH);
  });

  it('only uses the RFC unreserved character set', () => {
    expect(generateCodeVerifier()).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it('returns a different value on each call', () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });
});

describe('generateState', () => {
  it('returns a URL-safe opaque value', () => {
    expect(generateState()).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('returns a different value on each call', () => {
    expect(generateState()).not.toBe(generateState());
  });

  it('is long enough to be unguessable', () => {
    // 16 bytes -> 22 base64url chars. Anything shorter invites CSRF guessing.
    expect(generateState().length).toBeGreaterThanOrEqual(22);
  });
});

describe('createPkcePair', () => {
  it('pairs a verifier with its own S256 challenge', async () => {
    const pair = await createPkcePair();
    expect(pair.method).toBe('S256');
    await expect(deriveCodeChallenge(pair.verifier)).resolves.toBe(pair.challenge);
  });

  it('never reports the plain method — downgrade must not be representable', async () => {
    const pair = await createPkcePair();
    // `plain` is legal in RFC 7636 but forbidden by OAuth 2.1 and by the
    // server (codeChallengeMethod defaults to S256). Keep it unreachable.
    expect(pair.method).not.toBe('plain');
  });
});
