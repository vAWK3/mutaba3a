import { ApiError, apiErrorReason, retryMinutes, type ShareLinkUnlock } from '../../api/client';

/**
 * MUT-562: the share-link page's states, driven only by the server's answers (MUT-560's visitor routes). Nothing
 * that names the profile or its owner exists before `open` (SL1): the check says only "it opens with a PIN".
 */

export type PinProblem = { kind: 'wrong'; attemptsLeft: number } | { kind: 'rateLimited'; minutes: number } | { kind: 'unreachable' } | { kind: 'retry' };

export type ShareLinkState =
  | { kind: 'checking' }
  /** The check got no usable answer (network, a server error, a limit): Retry. */
  | { kind: 'unreachable'; minutes?: number }
  /** `again`: the visitor's 8 hours ended (SL8), shown only once it has. */
  | { kind: 'pin'; again: boolean; problem: PinProblem | null }
  | { kind: 'open'; unlock: ShareLinkUnlock }
  | { kind: 'locked' }
  | { kind: 'gone' }
  | { kind: 'limit' };

export type ShareLinkEvent =
  | { type: 'checked' }
  | { type: 'checkFailed'; error: unknown }
  | { type: 'retry' }
  | { type: 'unlocked'; unlock: ShareLinkUnlock }
  | { type: 'unlockFailed'; error: unknown }
  | { type: 'viewFailed'; error: unknown };

export const INITIAL_SHARE_LINK_STATE: ShareLinkState = { kind: 'checking' };

/** A refusal that ends the page for good: gone, locked, the viewer limit; or null when it isn't one. */
function terminal(error: unknown): ShareLinkState | null {
  if (!(error instanceof ApiError)) return null;
  if (error.status === 404) return { kind: 'gone' };
  // A malformed token in the fragment is a link that doesn't work, the same as an unknown one.
  if (error.status === 422) return { kind: 'gone' };
  const reason = apiErrorReason(error);
  if (error.code === 'SHARE_LINK_REFUSED' && reason === 'LOCKED') return { kind: 'locked' };
  if (error.code === 'SHARE_LINK_REFUSED' && reason === 'VIEWER_LIMIT') return { kind: 'limit' };
  return null;
}

function attemptsLeftOf(error: ApiError): number {
  const left = (error.details as { attemptsLeft?: unknown } | null)?.attemptsLeft;
  return typeof left === 'number' ? left : 0;
}

/** Why an unlock didn't open, kept on the PIN step. */
function pinProblem(error: unknown): PinProblem {
  if (!(error instanceof ApiError)) return { kind: 'unreachable' };
  if (error.code === 'SHARE_LINK_REFUSED' && apiErrorReason(error) === 'PIN_WRONG') return { kind: 'wrong', attemptsLeft: attemptsLeftOf(error) };
  if (error.status === 429) return { kind: 'rateLimited', minutes: retryMinutes(error) };
  // 409 SHARE_LINK_STALE_VIEWER: a parallel unlock from this browser won; the person presses Open again.
  if (error.status === 409) return { kind: 'retry' };
  return { kind: 'unreachable' };
}

export function shareLinkReducer(state: ShareLinkState, event: ShareLinkEvent): ShareLinkState {
  switch (event.type) {
    case 'checked':
      return { kind: 'pin', again: false, problem: null };
    case 'checkFailed': {
      const end = terminal(event.error);
      if (end) return end;
      return event.error instanceof ApiError && event.error.status === 429 ? { kind: 'unreachable', minutes: retryMinutes(event.error) } : { kind: 'unreachable' };
    }
    case 'retry':
      return INITIAL_SHARE_LINK_STATE;
    case 'unlocked':
      return { kind: 'open', unlock: event.unlock };
    case 'unlockFailed':
      return terminal(event.error) ?? { kind: 'pin', again: state.kind === 'pin' && state.again, problem: pinProblem(event.error) };
    case 'viewFailed': {
      const end = terminal(event.error);
      if (end) return end;
      if (event.error instanceof ApiError && event.error.status === 401) return { kind: 'pin', again: true, problem: null };
      // Anything else (a limit, an outage) stays on the open view; the view shows its own Retry.
      return state;
    }
  }
}

/** Whether this answer means the viewer token for the link should be forgotten (the link is gone for good). */
export function forgetsViewer(state: ShareLinkState): boolean {
  return state.kind === 'gone';
}
