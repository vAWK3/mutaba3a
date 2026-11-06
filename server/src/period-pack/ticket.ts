import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { sessionDigest } from '../auth/sessions.js';

/**
 * MUT-314 (ADR-248, D3, D5, D22): the download ticket. Stateless: base64url JSON, a dot, and an HMAC-SHA256 of the
 * payload under the session pepper (domain-separated from every other digest), compared in constant time. It lives
 * 120 s and names one download (`type`) for one caller (`kind` and `sub`) on one profile, over one range, as of one
 * moment. Holding it proves nothing by itself: the stream checks the caller's access again (access.ts).
 */
export const TICKET_TTL_MS = 120_000;

export const DOWNLOAD_TYPES = ['report', 'receipts'] as const;
export type DownloadType = (typeof DOWNLOAD_TYPES)[number];
export type DownloadKind = 'member' | 'accountant' | 'link';

const ClaimsSchema = z.object({
  type: z.enum(DOWNLOAD_TYPES),
  kind: z.enum(['member', 'accountant', 'link']),
  org: z.string().uuid(),
  /** The user id (member, accountant) or the share-link viewer id (link). */
  sub: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  asOf: z.string().datetime(),
  lang: z.enum(['ar', 'en']),
  /** The session that minted a member's or accountant's ticket (its id: no credential); null for a link. */
  sid: z.string().uuid().nullable(),
});
export type TicketClaims = z.infer<typeof ClaimsSchema>;

const PayloadSchema = ClaimsSchema.extend({ v: z.literal(1), exp: z.number().int(), n: z.string() });

const sign = (pepper: string, payload: string) => sessionDigest(pepper, `period-download:${payload}`);

export function mintTicket(pepper: string, claims: TicketClaims, now: Date): { ticket: string; expiresAt: Date } {
  const expiresAt = new Date(now.getTime() + TICKET_TTL_MS);
  const payload = Buffer.from(JSON.stringify({ v: 1, ...claims, exp: expiresAt.getTime(), n: randomBytes(9).toString('base64url') })).toString('base64url');
  return { ticket: `${payload}.${sign(pepper, payload)}`, expiresAt };
}

/** A verified ticket: its claims, and its nonce and expiry (for single use). */
export type VerifiedTicket = TicketClaims & { n: string; exp: number };

/** The ticket's claims, or null when it is malformed, forged, of the wrong shape, or expired. */
export function verifyTicket(pepper: string, ticket: string, now: Date): VerifiedTicket | null {
  const parts = ticket.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, signature] = parts as [string, string];
  const expected = Buffer.from(sign(pepper, payload), 'hex');
  const given = Buffer.from(signature, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const parsed = PayloadSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.exp <= now.getTime()) return null;
  return { ...ClaimsSchema.parse(parsed.data), n: parsed.data.n, exp: parsed.data.exp };
}
