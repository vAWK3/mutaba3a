/**
 * Cross-tab sign-out (mut-43-auth-states.md E3). A tab that signs out tells the
 * others, which clear their figures at once instead of at their next request.
 * Browsers without BroadcastChannel fall back to the next request's 401 (E1).
 */

export const SESSION_CHANNEL = 'mut-session';
export const SIGNED_OUT = 'signed_out';

function open(): BroadcastChannel | null {
  return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(SESSION_CHANNEL);
}

export function announceSignedOut(): void {
  const channel = open();
  if (!channel) return;
  channel.postMessage(SIGNED_OUT);
  channel.close();
}

/** Calls `onSignedOut` when another tab signs out; returns the unsubscribe function. */
export function onSignedOutElsewhere(onSignedOut: () => void): () => void {
  const channel = open();
  if (!channel) return () => {};
  channel.onmessage = (event) => {
    if (event.data === SIGNED_OUT) onSignedOut();
  };
  return () => channel.close();
}
