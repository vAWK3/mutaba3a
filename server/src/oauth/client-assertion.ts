import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { OAuthClientRecord } from '../repositories/ports.js';

/**
 * MUT-593 (ADR-254, RFC 7523 §2.2 and §3): how a confidential client proves itself at the token endpoint — a short JWT
 * it signed with a key it publishes at its JWKS URL. MTB3A holds no secret of the client's, so a leaked MTB3A database
 * or organization key mints nothing. Each assertion id is used once (the store's claim), so a captured assertion
 * can't be replayed inside its lifetime.
 */

export const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

/** Asymmetric only: an HMAC assertion would need a shared secret, and `none` proves nothing. */
export const ASSERTION_ALGORITHMS = ['RS256', 'PS256', 'ES256'] as const;

/** An assertion may live at most five minutes; clocks may differ by a minute either way. */
export const ASSERTION_MAX_LIFETIME_S = 300;
export const ASSERTION_CLOCK_TOLERANCE_S = 60;
const MAX_JTI_LENGTH = 255;

export type AssertionFailure = 'signature' | 'claims' | 'replay';

export interface VerifyAssertionInput {
  assertion: string;
  client: OAuthClientRecord;
  /** The token endpoint's URL and the issuer: either is a valid `aud`. */
  audiences: readonly string[];
  now: Date;
  keys: JWTVerifyGetKey;
  /** Records the assertion id until it expires; false when it was used before. */
  claimJti: (jti: string, expiresAt: Date) => Promise<boolean>;
}

export async function verifyClientAssertion(input: VerifyAssertionInput): Promise<{ ok: true } | { ok: false; reason: AssertionFailure }> {
  const nowS = Math.floor(input.now.getTime() / 1000);
  let payload: Awaited<ReturnType<typeof jwtVerify>>['payload'];
  try {
    ({ payload } = await jwtVerify(input.assertion, input.keys, {
      algorithms: [...ASSERTION_ALGORITHMS],
      currentDate: input.now,
      clockTolerance: ASSERTION_CLOCK_TOLERANCE_S,
      requiredClaims: ['exp'],
    }));
  } catch {
    return { ok: false, reason: 'signature' };
  }
  const audiences = typeof payload.aud === 'string' ? [payload.aud] : (payload.aud ?? []);
  const claimsHold =
    payload.iss === input.client.id &&
    payload.sub === input.client.id &&
    audiences.some((a) => input.audiences.includes(a)) &&
    typeof payload.jti === 'string' &&
    payload.jti.length > 0 &&
    payload.jti.length <= MAX_JTI_LENGTH &&
    typeof payload.exp === 'number' &&
    payload.exp <= nowS + ASSERTION_MAX_LIFETIME_S + ASSERTION_CLOCK_TOLERANCE_S;
  if (!claimsHold) return { ok: false, reason: 'claims' };
  const expiresAt = new Date(((payload.exp as number) + ASSERTION_CLOCK_TOLERANCE_S) * 1000);
  if (!(await input.claimJti(payload.jti as string, expiresAt))) return { ok: false, reason: 'replay' };
  return { ok: true };
}

/** The client id an assertion names, unverified: only to find which client's keys to verify it with. */
export function assertionIssuer(assertion: string): string | null {
  try {
    const { iss } = decodeJwt(assertion);
    return typeof iss === 'string' ? iss : null;
  } catch {
    return null;
  }
}

const REMOTE_KEY_SETS = new Map<string, JWTVerifyGetKey>();

/**
 * A client's published keys, fetched over HTTPS and cached ten minutes; an unknown `kid` refetches (at most every
 * 30 s), so a routine key rotation needs nothing from MTB3A (R4: rotation is not a revoke). The URL is set only by the
 * operator script, and only https is fetched.
 */
export function remoteKeys(jwksUri: string): JWTVerifyGetKey {
  const url = new URL(jwksUri);
  if (url.protocol !== 'https:') throw new Error('A client JWKS must be served over https');
  let keys = REMOTE_KEY_SETS.get(url.href);
  if (!keys) {
    keys = createRemoteJWKSet(url, { timeoutDuration: 5_000, cooldownDuration: 30_000, cacheMaxAge: 600_000 });
    REMOTE_KEY_SETS.set(url.href, keys);
  }
  return keys;
}
