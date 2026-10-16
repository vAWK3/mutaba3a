import { randomBytes } from 'node:crypto';
import type { AccountSetupTokenRecord, UserRecord } from '../repositories/ports.js';

/**
 * One-time setup links (MUT-235, ADR-088). The operator never knows anyone's
 * password: provisioning and resets issue a link, and the person sets their
 * own password through it. These are the pure rules; the store claims a link
 * inside the transaction that sets the password.
 */

/** A link lasts 72 hours unless the operator asks otherwise (`--valid-hours`), within these bounds. */
export const SETUP_LINK_POLICY = { defaultHours: 72, minHours: 1, maxHours: 720 } as const;

/** NIST SP 800-63B: length only, no composition rules. Shared with changing a password while signed in (MUT-237). */
export const NEW_PASSWORD_POLICY = { minLength: 12, maxLength: 128 } as const;

/** 32 random bytes → 43 base64url characters, the same size as a session token. Stored only as its digest. */
const SETUP_TOKEN_BYTES = 32;

export const SETUP_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateSetupToken(): string {
  return randomBytes(SETUP_TOKEN_BYTES).toString('base64url');
}

export type SetupLinkState = 'valid' | 'expired' | 'used' | 'superseded' | 'invalid';

/**
 * What a link is good for at `now`. `used` and `superseded` win over `expired`,
 * so a person is told the more useful thing. A link whose person is not ACTIVE
 * reads as `invalid`, the same as an unknown one.
 */
export function setupLinkState(link: AccountSetupTokenRecord | null, person: Pick<UserRecord, 'status'> | null, now: Date): SetupLinkState {
  if (!link || !person || person.status !== 'ACTIVE') return 'invalid';
  if (link.usedAt) return 'used';
  if (link.cancelledAt) return 'superseded';
  if (now.getTime() >= link.expiresAt.getTime()) return 'expired';
  return 'valid';
}

/** The token rides in the fragment, which browsers never send: it stays out of request lines, logs and Referer headers. */
export function setupUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/setup#${token}`;
}
