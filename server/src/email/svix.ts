import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * MUT-359 (D3): Svix's webhook signature, the scheme Resend signs with (docs.svix.com, "Verifying manually"),
 * written out rather than adding the `svix` package for one HMAC:
 *
 *   signed content = `${svix-id}.${svix-timestamp}.${raw body}`
 *   key            = base64-decode(secret without its `whsec_` prefix)
 *   svix-signature = space-separated `v1,<base64 HMAC-SHA256>` entries; any one matching is enough (rotation)
 *
 * The timestamp (seconds) must be within SVIX_TOLERANCE_SECONDS of now either way, so a captured delivery can't be
 * replayed later. Every comparison is constant-time.
 */
export const SVIX_TOLERANCE_SECONDS = 300;

export interface SvixVerifyInput {
  /** `whsec_<base64>`. */
  secret: string;
  header: (name: string) => string | undefined;
  /** The exact bytes received, before any JSON parsing. */
  body: string;
  now: Date;
}

export function verifySvixSignature({ secret, header, body, now }: SvixVerifyInput): boolean {
  const id = header('svix-id');
  const timestamp = header('svix-timestamp');
  const signatures = header('svix-signature');
  if (!id || !timestamp || !signatures || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > SVIX_TOLERANCE_SECONDS) return false;
  if (!secret.startsWith('whsec_')) return false;
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  if (key.length === 0) return false;

  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();
  let matched = false;
  for (const entry of signatures.split(' ')) {
    const [version, value] = entry.split(',', 2);
    if (version !== 'v1' || !value) continue;
    const candidate = Buffer.from(value, 'base64');
    // Keep looping after a match: the time taken doesn't say which entry matched.
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) matched = true;
  }
  return matched;
}
