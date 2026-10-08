import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * API key format and hashing (plan §10.1, §13.3).
 *
 *   mut_<env>_<prefix>_<secret>
 *     env     live | test              — which deployment may accept it
 *     prefix  8 chars [a-z0-9]         — public; used for lookup and masking
 *     secret  43 chars base64url       — 32 random bytes
 *
 * The service stores only `prefix` and `sha256(fullKey)`. A leaked database
 * yields no usable credential. Lookup is by prefix (unique), then the stored
 * hash is compared in constant time against the hash of the presented key.
 */
export type ApiKeyEnvironment = 'live' | 'test';

const PREFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const KEY_RE = /^mut_(live|test)_([a-z0-9]{8})_([A-Za-z0-9_-]{43})$/;

export interface GeneratedApiKey {
  /** The full key. Shown to the operator exactly once; never persisted. */
  secret: string;
  prefix: string;
  keyHash: string;
  environment: ApiKeyEnvironment;
}

export interface ParsedApiKey {
  environment: ApiKeyEnvironment;
  prefix: string;
}

function randomPrefix(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (const b of bytes) out += PREFIX_ALPHABET[b % PREFIX_ALPHABET.length];
  return out;
}

export function hashApiKey(fullKey: string): string {
  return createHash('sha256').update(fullKey, 'utf8').digest('hex');
}

export function generateApiKey(environment: ApiKeyEnvironment): GeneratedApiKey {
  const prefix = randomPrefix();
  const secretPart = randomBytes(32).toString('base64url');
  const secret = `mut_${environment}_${prefix}_${secretPart}`;
  return { secret, prefix, keyHash: hashApiKey(secret), environment };
}

export function parseApiKey(presented: string): ParsedApiKey | null {
  const m = KEY_RE.exec(presented);
  if (!m) return null;
  const environment = m[1] as ApiKeyEnvironment;
  const prefix = m[2] as string;
  return { environment, prefix };
}

/** Constant-time comparison of two hex digests of equal length. */
export function hashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** `mut_live_a9f3k2…c41d` — what Malafat shows after the key is stored (UX brief D13). */
export function maskApiKey(environment: ApiKeyEnvironment, prefix: string, keyHash: string): string {
  return `mut_${environment}_${prefix.slice(0, 4)}…${keyHash.slice(-4)}`;
}
