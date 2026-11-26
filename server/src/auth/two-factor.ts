import { createHmac, hkdfSync, randomBytes, randomInt } from 'node:crypto';
import { TokenBox } from '../jurisdictions/index.js';
import { sessionDigest } from './sessions.js';

/**
 * MUT-710 (ADR-274): the pure rules of two-step sign-in. The flow lives in sign-in.ts (the challenge at sign-in) and
 * routes/two-factor.ts (turning it on and off); TOTP itself is totp.ts.
 */
export const TWO_FACTOR_POLICY = {
  /** A challenge (sign-in, enrolment, reset) lives this long. */
  challengeMinutes: 10,
  /** Wrong codes one challenge takes before it dies. */
  maxAttempts: 5,
  recoveryCodes: 10,
  /** D3: the person's own lock, kept in the database so it survives instances and restarts. */
  lockAfterFailures: 5,
  failureWindowMinutes: 15,
  lockMinutes: 15,
  /** D5: an emailed code can be re-sent after this long, at most this many times per challenge. */
  resendAfterSeconds: 30,
  maxCodesPerChallenge: 5,
  /** Expired challenges are deleted this long after they end (as sign-in codes, MUT-618). */
  pruneAfterExpiryHours: 24,
} as const;

/** 32 letters without l, o, 0, 1: 5 bits a letter, 40 bits a code. */
const RECOVERY_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const RECOVERY_SHAPE = new RegExp(`^[${RECOVERY_ALPHABET}]{8}$`);

export function generateRecoveryCodes(): string[] {
  const codes = new Set<string>();
  while (codes.size < TWO_FACTOR_POLICY.recoveryCodes) {
    let raw = '';
    for (let i = 0; i < 8; i += 1) raw += RECOVERY_ALPHABET[randomInt(0, RECOVERY_ALPHABET.length)];
    codes.add(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return [...codes];
}

/** What a person typed, as stored: lower case, no spaces, one dash in the middle; null if it can't be a code. */
export function normalizeRecoveryCode(input: string): string | null {
  const raw = input.toLowerCase().replace(/[\s\-‐-―]/g, '');
  return RECOVERY_SHAPE.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4)}` : null;
}

/**
 * D4: TWO_FACTOR_SEAL_KEY seals TOTP secrets (AES-256-GCM through the Tax Authority's TokenBox, its own HKDF context)
 * and keys the recovery-code digests (a second HKDF key). Separate from the session pepper, so rotating the pepper to
 * sign everyone out doesn't void recovery codes.
 */
export class TwoFactorKeys {
  private readonly box: TokenBox;
  private readonly recoveryKey: Buffer;

  constructor(secret: string) {
    this.box = new TokenBox(secret, 'mutaba3a/two-factor-totp/v1');
    this.recoveryKey = Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), 'mutaba3a/two-factor-recovery/v1', 32));
  }

  sealSecret(secret: string): string {
    return this.box.seal(secret);
  }

  openSecret(sealed: string): string | null {
    return this.box.open(sealed);
  }

  recoveryDigest(userId: string, code: string): string {
    return createHmac('sha256', this.recoveryKey).update(`${userId}:${code}`).digest('hex');
  }
}

export function generateChallengeToken(): string {
  return randomBytes(32).toString('base64url');
}

export function challengeTokenDigest(pepper: string, token: string): string {
  return sessionDigest(pepper, `two-factor:${token}`);
}

export function emailCodeDigest(pepper: string, challengeId: string, code: string): string {
  return sessionDigest(pepper, `two-factor-code:${challengeId}:${code}`);
}

/** "s•••@basel.ps": enough for the person to recognise their address, nothing for a shoulder. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  return `${email.slice(0, 1)}•••${email.slice(at)}`;
}
