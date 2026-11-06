import { ApiError, apiErrorReason, retryMinutes, type AccountantInviteCheck } from '../../api/client';

/**
 * MUT-562: the accept-invite page's states (layout B), from three answers: the invite's check, whether someone is
 * signed in on this browser, and what an accept or a signup answered. Pure, so every combination is a unit test.
 */

export type InviteView =
  | { kind: 'checking' }
  | { kind: 'unreachable'; minutes?: number }
  /** Used, withdrawn, ended or past its 14 days: ask for a new one. */
  | { kind: 'gone' }
  /** Signed out: Sign in to accept | Create an account. */
  | { kind: 'invite' }
  | { kind: 'signup' }
  /** Signed in: Accept | Not now. */
  | { kind: 'accept' }
  /** 403 INVITE_EMAIL_MISMATCH: the invite's masked address, and the same-domain hint (SL7). */
  | { kind: 'mismatch'; maskedEmail: string }
  /** 409 ALREADY_HAS_ACCESS. */
  | { kind: 'already' }
  /** 409 ACCOUNT_EXISTS from the signup: sign in and accept instead. */
  | { kind: 'exists' }
  /** The account was made, but signing in after failed (a network blip): sign in to continue, never a second signup. */
  | { kind: 'signInToContinue' };

export type InviteOutcome = Exclude<InviteView, { kind: 'checking' | 'invite' | 'signup' | 'accept' | 'unreachable' }> | null;

export interface InviteInputs {
  check: { status: 'pending' } | { status: 'error'; error: unknown } | { status: 'success'; data: AccountantInviteCheck };
  /** null while the session check is still asking. */
  signedIn: boolean | null;
  /** The person pressed Create an account. */
  signingUp: boolean;
  outcome: InviteOutcome;
}

export function inviteView({ check, signedIn, signingUp, outcome }: InviteInputs): InviteView {
  if (outcome) return outcome;
  if (check.status === 'pending' || signedIn === null) return { kind: 'checking' };
  if (check.status === 'error') return checkFailure(check.error);
  if (check.data.expired) return { kind: 'gone' };
  if (signedIn) return { kind: 'accept' };
  return signingUp ? { kind: 'signup' } : { kind: 'invite' };
}

function checkFailure(error: unknown): InviteView {
  if (error instanceof ApiError && (error.status === 404 || error.status === 422)) return { kind: 'gone' };
  if (error instanceof ApiError && error.status === 429) return { kind: 'unreachable', minutes: retryMinutes(error) };
  return { kind: 'unreachable' };
}

/** What a refused accept means; null when it isn't a refusal the page shows as a state (an outage: a banner). */
export function acceptOutcome(error: unknown): InviteOutcome {
  if (!(error instanceof ApiError)) return null;
  if (error.status === 404) return { kind: 'gone' };
  if (error.code === 'INVITE_EMAIL_MISMATCH') {
    const masked = (error.details as { maskedEmail?: unknown } | null)?.maskedEmail;
    return { kind: 'mismatch', maskedEmail: typeof masked === 'string' ? masked : '' };
  }
  if (error.status === 409 && apiErrorReason(error) === 'ALREADY_HAS_ACCESS') return { kind: 'already' };
  return null;
}

/** A refused signup, as the form handles it. */
export type SignupFailure =
  | { kind: 'outcome'; outcome: Exclude<InviteOutcome, null> }
  | { kind: 'termsStale'; current: string | null }
  | { kind: 'checkFailed' }
  | { kind: 'password' }
  | { kind: 'rateLimited'; minutes: number }
  | { kind: 'unreachable' };

export function signupFailure(error: unknown): SignupFailure {
  if (!(error instanceof ApiError)) return { kind: 'unreachable' };
  if (error.status === 404) return { kind: 'outcome', outcome: { kind: 'gone' } };
  if (error.code === 'TERMS_VERSION_STALE') {
    const current = (error.details as { current?: unknown } | null)?.current;
    return { kind: 'termsStale', current: typeof current === 'string' ? current : null };
  }
  if (error.status === 409) return { kind: 'outcome', outcome: { kind: 'exists' } };
  if (error.code === 'CHECK_FAILED') return { kind: 'checkFailed' };
  if (error.status === 422) return { kind: 'password' };
  if (error.status === 429) return { kind: 'rateLimited', minutes: retryMinutes(error) };
  return { kind: 'unreachable' };
}

/** "17 Nov": when the invite ends, in the person's language with Western digits. */
export function inviteEnds(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { day: 'numeric', month: 'short' }).format(new Date(iso));
}

// ---- The token ---------------------------------------------------------------------------------------------------

/** Kept for this tab so it survives the sign-in round trip (`/sign-in?next=/accountant-invite`); never localStorage. */
const TAB_KEY = 'mtb3a-accountant-invite';

export function rememberInviteForTab(token: string): void {
  try {
    sessionStorage.setItem(TAB_KEY, token);
  } catch {
    // The page keeps it in state regardless
  }
}

export function inviteForTab(): string | null {
  try {
    return sessionStorage.getItem(TAB_KEY);
  } catch {
    return null;
  }
}

/** Accepted (or made the account): the token has done its job. */
export function forgetInviteForTab(): void {
  try {
    sessionStorage.removeItem(TAB_KEY);
  } catch {
    // Nothing stored
  }
}

