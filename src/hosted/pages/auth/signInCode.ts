import { ApiError, retryMinutes } from '../../api/client';

/**
 * The pure half of "Email me a sign-in code" (MUT-618, ADR-256 D6, D9): what a refused code means for the page. The
 * server answers wrong / expired / too many tries the same for every address, so saying which never reveals whether an
 * account exists (ADR-037 §4).
 */
export type CodeFailure =
  | { kind: 'wrong'; triesLeft: number }
  | { kind: 'expired' }
  | { kind: 'tooMany' }
  /** The email key is locked, or this network asked too often. */
  | { kind: 'wait'; minutes: number }
  /** The right code on an account waiting for review: the page shows the review notice (MUT-367). */
  | { kind: 'underReview' }
  /** MUT-710 (D6): the right code, but the account's second step is a code by email too: one factor twice. */
  | { kind: 'usePassword' }
  | { kind: 'unreachable' };

/** Six digits; the server refuses anything else before spending a try. */
export const CODE_LENGTH = 6;

/** What a person typed or pasted ("123 456", "١٢٣٤٥٦"), as the six ASCII digits the server takes, or as far as it goes. */
export function codeDigits(typed: string): string {
  return typed
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, '')
    .slice(0, CODE_LENGTH);
}

export function codeFailure(error: unknown): CodeFailure {
  if (!(error instanceof ApiError)) return { kind: 'unreachable' };
  switch (error.code) {
    case 'SIGN_IN_CODE_WRONG': {
      const left = (error.details as { triesLeft?: unknown } | null)?.triesLeft;
      return { kind: 'wrong', triesLeft: typeof left === 'number' ? left : 1 };
    }
    case 'SIGN_IN_CODE_TOO_MANY_TRIES':
      return { kind: 'tooMany' };
    case 'ACCOUNT_UNDER_REVIEW':
      return { kind: 'underReview' };
    case 'TWO_FACTOR_USE_PASSWORD':
      return { kind: 'usePassword' };
    // No live code, or a code for an account that can no longer sign in: either way, a new code is the next step.
    case 'SIGN_IN_CODE_EXPIRED':
    case 'INVALID_CREDENTIALS':
      return { kind: 'expired' };
    default:
      if (error.status === 429) return { kind: 'wait', minutes: retryMinutes(error) };
      return { kind: 'unreachable' };
  }
}

/**
 * The reason PostHog records for a refused code (MUT-618 D9, contract 2.10.0: an enum, nothing about the person). Null for
 * an unreachable server: that is an error, and errors go to Sentry, never PostHog (MUT-146).
 */
export function refusalReason(failure: CodeFailure): 'wrong' | 'expired' | 'too_many_tries' | 'rate_limited' | 'under_review' | null {
  switch (failure.kind) {
    case 'wrong':
      return 'wrong';
    case 'expired':
      return 'expired';
    case 'tooMany':
      return 'too_many_tries';
    case 'wait':
      return 'rate_limited';
    case 'underReview':
      return 'under_review';
    // Not a refused code (contract 2.10.0 has no reason for it), and not an error either.
    case 'usePassword':
    case 'unreachable':
      return null;
  }
}
