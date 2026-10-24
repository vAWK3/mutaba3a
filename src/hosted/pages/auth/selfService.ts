import { ApiError, apiErrorFields, apiErrorReason, retryMinutes } from '../../api/client';

/**
 * The pure half of /signup and /recover (MUT-368, mut-368-portal-signup-recover.md §3.3): what a refused request means
 * for the page. Every refusal keeps the typed email and says what to do next; none depends on whether an account
 * exists (ADR-037 §4), because the server never answers differently for one.
 */

export type NotAcceptedReason = 'disposable' | 'no-mail' | 'other';

export type SelfServiceFailure =
  /** POST /v1/signups answered 404: signup isn't open on this server (any more). */
  | { kind: 'closed' }
  | { kind: 'notAccepted'; reason: NotAcceptedReason }
  /** The bot check refused the token (CHECK_FAILED). */
  | { kind: 'checkFailed' }
  | { kind: 'rateLimited'; minutes: number }
  | { kind: 'invalidEmail' }
  | { kind: 'unreachable' };

/** How long "Send again" stays off after a link was sent: the server's per-address budget is one a minute. */
export const SEND_AGAIN_COOLDOWN_MS = 60_000;

const MINUTES_PER_HOUR = 60;

export function selfServiceFailure(error: unknown): SelfServiceFailure {
  if (!(error instanceof ApiError)) return { kind: 'unreachable' };
  if (error.status === 404) return { kind: 'closed' };
  if (error.code === 'EMAIL_NOT_ACCEPTED') {
    const reason = apiErrorReason(error);
    return { kind: 'notAccepted', reason: reason === 'disposable' || reason === 'no-mail' ? reason : 'other' };
  }
  if (error.code === 'CHECK_FAILED') return { kind: 'checkFailed' };
  // Only the email is the person's to fix; any other field (the token) is the page's own bug.
  if (error.status === 422) return apiErrorFields(error).includes('email') ? { kind: 'invalidEmail' } : { kind: 'unreachable' };
  if (error.status === 429) return { kind: 'rateLimited', minutes: retryMinutes(error) };
  return { kind: 'unreachable' };
}

/** A wait in the unit people read it in: minutes up to an hour, then whole hours (the day budget answers up to 24 h). */
export function waitFor(minutes: number): { unit: 'minutes' | 'hours'; count: number } {
  return minutes <= MINUTES_PER_HOUR ? { unit: 'minutes', count: minutes } : { unit: 'hours', count: Math.ceil(minutes / MINUTES_PER_HOUR) };
}
