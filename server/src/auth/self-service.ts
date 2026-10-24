import { domainOf } from '../email/domains/screen.js';
import { SETUP_LINK_STATUSES, type EmailDomainClass, type SignupLinkRecord, type UserRecord, type UserStatus } from '../repositories/ports.js';
import type { SetupLinkState } from './account-setup.js';

/**
 * MUT-366 (ADR-159 §3–§7, ADR-175): the pure rules behind self-service signup and password recovery. The routes
 * (routes/self-service.ts) mail links; both end on the ADR-088 `/setup` page and redeem.
 */
export const SELF_SERVICE_POLICY = {
  /** A SIGNUP link: the person just asked for it and is waiting, and a short life keeps the token table small under abuse. */
  signupLinkHours: 24,
  /** A self-requested RESET link (operator links keep 72 h). Nothing changes until it is used (ADR-088 §3). */
  recoveryResetHours: 1,
  /** D4: a SETUP link recovery mails to an operator-created account that never set a password. */
  recoverySetupHours: 24,
  /** Both routes share these budgets (D6). The address budget counts whether or not an account exists. */
  ipPerHour: 10,
  addressPerMinute: 1,
  addressPerDay: 5,
  /** Answers come no earlier than this after the request began, whichever branch ran (ADR-159 §5). */
  signupFloorMs: 3000,
  recoveryFloorMs: 1500,
  /** Unredeemed SIGNUP links are deleted this long after they expire (D9). */
  pruneAfterExpiryDays: 7,
} as const;

/** A display name is at most this long (CreateUserRequestSchema). */
const DISPLAY_NAME_MAX = 200;

/**
 * What a SIGNUP link is good for at `now`. Once anyone holds its address (another link won, or the operator created
 * the account) it reads `used`: the account it was for exists. Otherwise the same order as `setupLinkState`.
 */
export function signupLinkState(link: SignupLinkRecord | null, holder: Pick<UserRecord, 'id'> | null, now: Date): SetupLinkState {
  if (!link) return 'invalid';
  if (link.usedAt || holder) return 'used';
  if (link.cancelledAt) return 'superseded';
  if (now.getTime() >= link.expiresAt.getTime()) return 'expired';
  return 'valid';
}

/**
 * Which link recovery mails (D5), or null for none. A disabled account gets nothing. An account with no password
 * that never signed in is an operator-created one waiting for its first: SETUP. Everything else, an operator `--lock`
 * included, is a RESET. MUT-367 (D9): an account waiting for review recovers too (the person owns the mailbox); a
 * new password still can't sign in until the operator approves.
 */
export function recoveryPurposeOf(person: Pick<UserRecord, 'status' | 'passwordHash' | 'lastSignInAt'>): 'SETUP' | 'RESET' | null {
  if (!SETUP_LINK_STATUSES.has(person.status)) return null;
  return person.passwordHash === null && person.lastSignInAt === null ? 'SETUP' : 'RESET';
}

export interface SignupAccountOutcome {
  status: UserStatus;
  trialStartsAt: Date | null;
  /** The review row a PENDING_REVIEW account waits on; null for an account that opens at once. */
  review: { domain: string; classification: EmailDomainClass; reasons: string[] } | null;
}

/**
 * The account a redeemed SIGNUP link opens (MUT-366 D1, MUT-367). A BUSINESS domain opens at once and its trial
 * starts now. Anything else (webmail, relay, a young or unverifiable domain, or a link issued before the screen
 * existed, D19) waits for the operator as PENDING_REVIEW with no trial: approval starts it.
 */
export function signupAccountOutcome(link: SignupLinkRecord, at: Date): SignupAccountOutcome {
  if (link.domainClass === 'BUSINESS') return { status: 'ACTIVE', trialStartsAt: at, review: null };
  const domain = domainOf(link.email);
  const review = link.domainClass
    ? { domain, classification: link.domainClass, reasons: [...link.domainReasons] }
    : { domain, classification: 'BUSINESS_UNVERIFIED' as const, reasons: ['unclassified'] };
  return { status: 'PENDING_REVIEW', trialStartsAt: null, review };
}

/** D3: a signup that names no one is called by its address's local part, which the person can change later. */
export function defaultDisplayName(email: string): string {
  const at = email.lastIndexOf('@');
  return (at > 0 ? email.slice(0, at) : email).slice(0, DISPLAY_NAME_MAX);
}

export interface MonotonicClock {
  /** Milliseconds on a clock that never jumps (performance.now), not the request's injectable `now`. */
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const SYSTEM_CLOCK: MonotonicClock = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Waits until `floorMs` after `startedMs` (D8). Returns how far past the floor the work already ran (0 when it
 * finished in time), so the caller can log a branch that took long enough to be told apart.
 */
export async function answerNoEarlierThan(startedMs: number, floorMs: number, clock: MonotonicClock): Promise<number> {
  const remaining = startedMs + floorMs - clock.now();
  if (remaining > 0) {
    await clock.sleep(remaining);
    return 0;
  }
  return -remaining;
}
