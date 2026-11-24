import { ApiError, retryMinutes, type TwoFactorChallenge } from '../api/client';
import { CODE_LENGTH } from '../pages/auth/signInCode';

/**
 * The pure half of two-step sign-in (MUT-710, ADR-274): which refusal starts the second step, and what a refused code
 * means for the page. Every screen that takes the second step (sign-in, a setup link, Malafat's return, You › Account)
 * reads the server through these.
 */

export type TwoFactorMethod = TwoFactorChallenge['method'];

/** An answer to the second step: the app's or the mail's code, or one of the ten recovery codes in its place. */
export type TwoFactorAnswer = { code: string } | { recoveryCode: string };

export type TwoFactorFailure =
  | { kind: 'wrong'; triesLeft: number }
  /** Five wrong codes ended this try: start signing in again. */
  | { kind: 'tooMany' }
  /** The step lapsed (10 minutes), was used, or a password change voided it: start again. */
  | { kind: 'expired' }
  /** Five wrong second steps in 15 minutes lock it (D3), or a code was mailed a moment ago. */
  | { kind: 'wait'; minutes: number }
  | { kind: 'unreachable' };

/** The challenge a 403 TWO_FACTOR_REQUIRED carries (D1), or null for any other refusal. */
export function twoFactorChallengeOf(error: unknown): TwoFactorChallenge | null {
  if (!(error instanceof ApiError) || error.code !== 'TWO_FACTOR_REQUIRED') return null;
  const details = error.details as Partial<TwoFactorChallenge> | null;
  if (!details || typeof details.challengeToken !== 'string') return null;
  if (details.method !== 'totp' && details.method !== 'email') return null;
  return {
    challengeToken: details.challengeToken,
    method: details.method,
    expiresAt: typeof details.expiresAt === 'string' ? details.expiresAt : '',
    ...(typeof details.emailHint === 'string' ? { emailHint: details.emailHint } : {}),
  };
}

export function twoFactorFailure(error: unknown): TwoFactorFailure {
  if (!(error instanceof ApiError)) return { kind: 'unreachable' };
  switch (error.code) {
    case 'TWO_FACTOR_CODE_WRONG': {
      const left = (error.details as { triesLeft?: unknown } | null)?.triesLeft;
      return { kind: 'wrong', triesLeft: typeof left === 'number' ? left : 1 };
    }
    case 'TWO_FACTOR_TOO_MANY_TRIES':
      return { kind: 'tooMany' };
    case 'TWO_FACTOR_CHALLENGE_EXPIRED':
      return { kind: 'expired' };
    default:
      if (error.status === 429) return { kind: 'wait', minutes: retryMinutes(error) };
      return { kind: 'unreachable' };
  }
}

/** Whether the try is over: a new one starts from the first step (or a fresh challenge). */
export function endsTheTry(failure: TwoFactorFailure): boolean {
  return failure.kind === 'tooMany' || failure.kind === 'expired';
}

/** Recovery codes are `xxxx-xxxx` (D9); spaces, case and a missing hyphen are forgiven, as the server does. */
export function recoveryCodeOf(typed: string): string {
  const plain = typed.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  return plain.length > 4 ? `${plain.slice(0, 4)}-${plain.slice(4)}` : plain;
}

/** The TWO_FACTOR_SETUP_REQUIRED refusal before issuing (D10): `enrolled` means it's on, but this session predates it. */
export function setupRequiredOf(error: unknown): { enrolled: boolean } | null {
  if (!(error instanceof ApiError) || error.code !== 'TWO_FACTOR_SETUP_REQUIRED') return null;
  return { enrolled: (error.details as { enrolled?: unknown } | null)?.enrolled === true };
}

/** Whether a refusal is the two-step one, so the screen shows the prompt instead of its general failure. */
export const isTwoFactorRefusal = (error: unknown): boolean => setupRequiredOf(error) !== null;

/** The second step's field, as typed (TwoFactorFields): the code, or a recovery code in its place. */
export interface TwoFactorInput {
  mode: 'code' | 'recovery';
  code: string;
  recoveryCode: string;
}

export const EMPTY_TWO_FACTOR_INPUT: TwoFactorInput = { mode: 'code', code: '', recoveryCode: '' };

/** `xxxx-xxxx`: eight letters and a hyphen. */
export const RECOVERY_CODE_LENGTH = 9;

/** The answer to send, or null while the field isn't complete. */
export function answerOf(input: TwoFactorInput): TwoFactorAnswer | null {
  if (input.mode === 'code') return input.code.length === CODE_LENGTH ? { code: input.code } : null;
  return input.recoveryCode.length === RECOVERY_CODE_LENGTH ? { recoveryCode: input.recoveryCode } : null;
}
