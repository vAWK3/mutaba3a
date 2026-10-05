/**
 * PKCE (RFC 7636) for the OAuth 2.1 authorization-code flow.
 *
 * Mutaba3a is a public client — a desktop app cannot keep a secret — so PKCE
 * is the only thing binding an authorization code to the client that requested
 * it. Malafat's server registers desktop clients with
 * `tokenEndpointAuthMethod: "none"` and `codeChallengeMethod` defaulting to
 * S256, so S256 is the only method implemented here.
 *
 * `plain` is deliberately absent. RFC 7636 permits it, OAuth 2.1 forbids it,
 * and leaving it unimplemented means a downgrade cannot be introduced by
 * passing a different argument.
 *
 * Pure module: no Tauri, no network, no storage. That keeps it unit-testable
 * against the RFC's own test vector.
 */

/** RFC 7636 §4.1 — a verifier is 43..128 characters of unreserved charset. */
export const MIN_VERIFIER_LENGTH = 43;
export const MAX_VERIFIER_LENGTH = 128;

/** 32 bytes of entropy encodes to exactly 43 base64url characters. */
const VERIFIER_ENTROPY_BYTES = 32;
/** 16 bytes -> 22 base64url characters; enough to make `state` unguessable. */
const STATE_ENTROPY_BYTES = 16;

/** RFC 7636 §4.1 unreserved set: ALPHA / DIGIT / "-" / "." / "_" / "~" */
const VERIFIER_CHARSET = /^[A-Za-z0-9\-._~]+$/;

export interface PkcePair {
  /** Secret. Held in memory until the token exchange, then discarded. */
  verifier: string;
  /** Public. Sent on the authorize request. */
  challenge: string;
  method: 'S256';
}

type RandomBytes = (byteLength: number) => Uint8Array;

function defaultRandomBytes(byteLength: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(byteLength));
}

/**
 * base64url without padding (RFC 4648 §5).
 *
 * Built from binary -> base64 -> substitution rather than from a Buffer so the
 * same code runs in the Tauri webview and in the browser PWA build.
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Reject anything the authorization server would reject, at the point of use.
 *
 * Validating here rather than only at generation matters because a verifier can
 * arrive from storage after an app restart mid-flow, and a malformed one should
 * fail locally with a clear error instead of as an opaque `invalid_grant`.
 */
function assertValidVerifier(verifier: string): void {
  if (typeof verifier !== 'string') {
    throw new Error('PKCE code verifier must be a string');
  }
  if (verifier.length < MIN_VERIFIER_LENGTH || verifier.length > MAX_VERIFIER_LENGTH) {
    throw new Error(
      `PKCE code verifier must be ${MIN_VERIFIER_LENGTH}-${MAX_VERIFIER_LENGTH} characters, got ${verifier.length}`
    );
  }
  if (!VERIFIER_CHARSET.test(verifier)) {
    throw new Error('PKCE code verifier contains characters outside the RFC 7636 unreserved set');
  }
}

export function generateCodeVerifier(randomBytes: RandomBytes = defaultRandomBytes): string {
  return base64UrlEncode(randomBytes(VERIFIER_ENTROPY_BYTES));
}

/** Opaque CSRF token echoed back on the redirect and compared byte-for-byte. */
export function generateState(randomBytes: RandomBytes = defaultRandomBytes): string {
  return base64UrlEncode(randomBytes(STATE_ENTROPY_BYTES));
}

export async function deriveCodeChallenge(verifier: string): Promise<string> {
  assertValidVerifier(verifier);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

export async function createPkcePair(
  randomBytes: RandomBytes = defaultRandomBytes
): Promise<PkcePair> {
  const verifier = generateCodeVerifier(randomBytes);
  const challenge = await deriveCodeChallenge(verifier);
  return { verifier, challenge, method: 'S256' };
}
