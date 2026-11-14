import { randomInt } from 'node:crypto';
import { isAccountGone } from '../accounts/closure.js';
import type { UserRecord } from '../repositories/ports.js';
import { sessionDigest } from './sessions.js';

/**
 * MUT-618 (ADR-256): the pure rules of the emailed sign-in code. The routes (routes/self-service.ts asks,
 * routes/sessions.ts and routes/device-sessions.ts sign in) use these; `signInWithCode` in sign-in.ts runs the checks
 * every sign-in shares.
 */
export const SIGN_IN_CODE_POLICY = {
  /** Basel, 2026-11-14: six digits, ten minutes, single use. */
  digits: 6,
  validMinutes: 10,
  /** The fifth wrong try kills the code (AC3). */
  maxAttempts: 5,
  /** Rows are deleted this long after they expire (D3). */
  pruneAfterExpiryHours: 24,
} as const;

const CODE_SPACE = 10 ** SIGN_IN_CODE_POLICY.digits;
const CODE_SHAPE = new RegExp(`^\\d{${SIGN_IN_CODE_POLICY.digits}}$`);

/** A uniformly random code, zero-padded: "004817" is as likely as "917204". */
export function generateSignInCode(): string {
  return String(randomInt(0, CODE_SPACE)).padStart(SIGN_IN_CODE_POLICY.digits, '0');
}

/** Exactly six digits; the clients strip spaces before sending. */
export function isSignInCodeShape(code: string): boolean {
  return CODE_SHAPE.test(code);
}

/**
 * The stored form (D3): an HMAC under the server's pepper, bound to the address, so a leaked row can't be reversed by
 * trying all 10^6 codes and one address's code is worthless for another.
 */
export function signInCodeDigest(pepper: string, email: string, code: string): string {
  return sessionDigest(pepper, `sign-in-code:${email}:${code}`);
}

/**
 * D4: who gets the code by mail. An account that could sign in with the right password: active, or waiting for review
 * (the right code then shows the review notice, AC4); a password set (ADR-159 d9: a session binds to it) that the
 * person chose (MUT-596: an account Sign in with Malafat created holds a random one and signs in through Malafat; a
 * code session there could set its first password with no proof but the mailbox); not closed past its deadline.
 * Everyone else gets a row and no mail.
 */
export function mailsSignInCode(person: Pick<UserRecord, 'status' | 'passwordHash' | 'passwordChosen' | 'closure'> | null, now: Date): boolean {
  if (!person || person.passwordHash === null || !person.passwordChosen) return false;
  if (person.status !== 'ACTIVE' && person.status !== 'PENDING_REVIEW') return false;
  return !isAccountGone(person.closure, now);
}
