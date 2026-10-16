import { ApiError, retryMinutes, type SetupLinkRefusal } from '../../api/client';

/**
 * The pure half of `/setup` (MUT-236, mut-236-setup-page.md §2.3–§2.4): the
 * password rule, the token from the fragment, and what a failed redeem means
 * for the page. Kept out of the component so each rule is tested on its own.
 */

/**
 * The server's rule (`NEW_PASSWORD_POLICY`, server/src/auth/account-setup.ts),
 * mirrored because the portal can't import across the package boundary;
 * setupLink.test.ts pins it to the published OpenAPI `NewPassword` bounds.
 * `length` counts UTF-16 code units, as zod does, so the two never disagree.
 */
export const NEW_PASSWORD_POLICY = { minLength: 12, maxLength: 128 } as const;

export type PasswordProblem = 'tooShort' | 'tooLong';

export function passwordProblem(password: string): PasswordProblem | null {
  if (password.length < NEW_PASSWORD_POLICY.minLength) return 'tooShort';
  if (password.length > NEW_PASSWORD_POLICY.maxLength) return 'tooLong';
  return null;
}

/** The router's `location.hash` (no `#`). The token's shape is the server's to judge: a malformed one comes back as 422. */
export function tokenFromHash(hash: string): string | null {
  const token = hash.trim();
  return token ? token : null;
}

const REFUSALS: readonly SetupLinkRefusal[] = ['expired', 'used', 'superseded', 'invalid'];
const FIRST_SERVER_ERROR = 500;

export type RedeemFailure =
  | { kind: 'refused'; state: SetupLinkRefusal }
  /** "used" after an attempt whose answer never arrived: that attempt most likely set the password (TD-149, D3). */
  | { kind: 'trySignIn' }
  | { kind: 'policy' }
  | { kind: 'rateLimited'; minutes: number }
  | { kind: 'unreachable' };

function refusalState(error: ApiError): SetupLinkRefusal {
  const state = (error.details as { state?: unknown } | null)?.state;
  return REFUSALS.find((refusal) => refusal === state) ?? 'invalid';
}

/**
 * True when the redeem may have been applied although the page never heard
 * back: no answer at all, or a 5xx a proxy can send after the server committed.
 */
export function answerWasLost(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status === 0 || error.status >= FIRST_SERVER_ERROR;
}

/** `answerLost`: an earlier attempt on this page ended without an answer (see `answerWasLost`). */
export function redeemFailure(error: unknown, answerLost: boolean): RedeemFailure {
  if (!(error instanceof ApiError)) return { kind: 'unreachable' };
  if (error.status === 410) {
    const state = refusalState(error);
    return state === 'used' && answerLost ? { kind: 'trySignIn' } : { kind: 'refused', state };
  }
  if (error.status === 422) return { kind: 'policy' };
  if (error.status === 429) return { kind: 'rateLimited', minutes: retryMinutes(error) };
  return { kind: 'unreachable' };
}
