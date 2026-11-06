import { ApiError } from '../errors.js';
import type { AuditEventInput, JsonObject, ShareLinkRecord } from '../repositories/ports.js';

/**
 * MUT-560 (ADR-246): the rules of a share link's life: its limits, the PIN's shape and hash input, how the owner sees
 * a link, its audit rows and its refusals. Access itself is shareLinkAccess (access.ts); the period is period.ts; the
 * routes are routes/share-links.ts. Kept free of Node-only imports, like accountants/grants.ts.
 */

/** SHARE_LINKS_PER_PROFILE_MAX's default: live links (not revoked, unexpired) one profile may hold (A12). */
export const SHARE_LINKS_PER_PROFILE_DEFAULT = 10;

/** Links one owner may create per hour, across their profiles (a refused one counts too) (A12). */
export const SHARE_LINK_CREATE_POLICY = { perUserPerHour: 20 } as const;

/** Requests one viewer may make per minute on the view routes (A7). */
export const SHARE_LINK_VIEW_POLICY = { perViewerPerMinute: 60 } as const;

/** Browsers that may open one link (comment 13226). */
export const SHARE_LINK_MAX_VIEWERS = 3;

/** Wrong PINs over a link's life; the last one locks it, for good (A5). */
export const SHARE_LINK_PIN_ATTEMPTS = 5;

/** A viewer's access after an unlock, never past the link's own expiry (A2). */
export const SHARE_VIEWER_ACCESS_MS = 8 * 3_600_000;

/** The lifetimes an owner may choose. */
export const SHARE_LINK_EXPIRY_DAYS = [1, 7, 30] as const;

const DIGITS_FOLD: ReadonlyArray<[number, number]> = [
  [0x0660, 0x0669], // Arabic-Indic ٠-٩
  [0x06f0, 0x06f9], // Eastern Arabic-Indic ۰-۹
];

/** The PIN with Arabic-Indic and Eastern Arabic-Indic digits folded to ASCII (A18): Arabic-first keypads send either. */
export function foldPinDigits(pin: string): string {
  return [...pin]
    .map((ch) => {
      const code = ch.codePointAt(0)!;
      const range = DIGITS_FOLD.find(([zero, nine]) => code >= zero && code <= nine);
      return range ? String(code - range[0]) : ch;
    })
    .join('');
}

const PIN_RE = /^[0-9]{4,8}$/;

/** A folded PIN of 4 to 8 digits, or null. */
export function normalizePin(pin: string): string | null {
  const folded = foldPinDigits(pin);
  return PIN_RE.test(folded) ? folded : null;
}

/** What the PIN's argon2id hashes: the link id and the PIN, peppered by the caller (A4: a DB leak alone can't crack it). */
export function pinHashInput(linkId: string, pin: string): string {
  return `${linkId}:${pin}`;
}

/** The link: the token rides in the fragment, which browsers never send (MUT-559 D3). Shown once, at creation. */
export function shareLinkUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/share#${token}`;
}

/** Revoked or expired at `at`: gone from the owner's list and from every visitor. */
export function isLiveLink(link: Pick<ShareLinkRecord, 'revokedAt' | 'expiresAt'>, at: Date): boolean {
  return link.revokedAt === null && link.expiresAt > at;
}

/** When a viewer unlocking at `at` loses access: 8 hours on, or the link's expiry if sooner. */
export function viewerAccessExpiry(link: Pick<ShareLinkRecord, 'expiresAt'>, at: Date): Date {
  return new Date(Math.min(at.getTime() + SHARE_VIEWER_ACCESS_MS, link.expiresAt.getTime()));
}

export type ShareLinkAuditAction = 'share_link.created' | 'share_link.revoked' | 'share_link.unlocked' | 'share_link.locked';

/**
 * An audit row about a link, on its profile. Never the token, the PIN, an address or an IP; `share_link.unlocked`
 * carries only the viewer's number. A visitor has no account: their rows have no actor.
 */
export function shareLinkAudit(
  link: Pick<ShareLinkRecord, 'id' | 'organizationId'>,
  action: ShareLinkAuditAction,
  actorId: string | null,
  requestId: string | null,
  metadata: JsonObject = {},
): AuditEventInput {
  return { organizationId: link.organizationId, actorType: actorId ? 'USER' : 'SYSTEM', actorId, action, entityType: 'share_link', entityId: link.id, metadata, requestId };
}

/** The one answer for every link that can't be used: unknown, revoked, expired, its profile gone or its owner closing (A10). */
export function shareLinkUnavailable(): ApiError {
  return new ApiError('NOT_FOUND', 'This link is no longer available', { reason: 'SHARE_LINK_UNAVAILABLE' });
}

/** A visitor's refusal at check or unlock: LOCKED, PIN_WRONG (with attemptsLeft) or VIEWER_LIMIT. */
export function shareLinkRefused(reason: 'LOCKED' | 'VIEWER_LIMIT'): ApiError;
export function shareLinkRefused(reason: 'PIN_WRONG', attemptsLeft: number): ApiError;
export function shareLinkRefused(reason: 'LOCKED' | 'PIN_WRONG' | 'VIEWER_LIMIT', attemptsLeft?: number): ApiError {
  const messages = {
    LOCKED: 'This link was locked after too many wrong PINs; ask for a new one',
    PIN_WRONG: 'That PIN isn’t right',
    VIEWER_LIMIT: `This link has been opened on ${SHARE_LINK_MAX_VIEWERS} devices already; ask for a new one`,
  } as const;
  return new ApiError('SHARE_LINK_REFUSED', messages[reason], reason === 'PIN_WRONG' ? { reason, attemptsLeft } : { reason });
}

/** A known viewer whose 8 hours have passed, on a usable link: the page asks for the PIN again. */
export function shareViewExpired(): ApiError {
  return new ApiError('UNAUTHENTICATED', 'Enter the PIN again to keep reading', { reason: 'SHARE_VIEW_EXPIRED' });
}
