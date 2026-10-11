/**
 * Cross-tab sign-out (mut-43-auth-states.md E3). A tab that signs out tells the
 * others, which clear their figures at once instead of at their next request.
 * Browsers without BroadcastChannel fall back to the next request's 401 (E1).
 *
 * One channel per tab sends and listens: BroadcastChannel never delivers a
 * message back to the object that posted it, so a tab never hears its own
 * sign-out and tears its session down twice.
 */

export const SESSION_CHANNEL = 'mut-session';
export const SIGNED_OUT = 'signed_out';

let tabChannel: BroadcastChannel | null = null;
const listeners = new Set<() => void>();

function channel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!tabChannel) {
    tabChannel = new BroadcastChannel(SESSION_CHANNEL);
    tabChannel.onmessage = (event) => {
      if (event.data === SIGNED_OUT) listeners.forEach((listener) => listener());
    };
  }
  return tabChannel;
}

export function announceSignedOut(): void {
  channel()?.postMessage(SIGNED_OUT);
}

/** Calls `onSignedOut` when another tab signs out; returns the unsubscribe function. */
export function onSignedOutElsewhere(onSignedOut: () => void): () => void {
  if (!channel()) return () => {};
  listeners.add(onSignedOut);
  return () => {
    listeners.delete(onSignedOut);
  };
}
