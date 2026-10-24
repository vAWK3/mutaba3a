import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { localBackend, setUnauthorisedHandler } from '../api/client';
import { onSignedOutElsewhere } from './channel';
import { endSession } from './endSession';
import { ME_KEY } from './me';
import { onModeChangedElsewhere, useIsLocalMode } from './mode';

/**
 * The one place the session ends (mut-43-auth-states.md E1, E3). The query
 * cache is cleared synchronously *before* navigating, so no figure can render
 * on the sign-in route. A 401 while nobody was signed in (first load, or the
 * sign-in page's own check) is left to the route that asked.
 *
 * Signed out (MUT-286), another tab's save refreshes this tab's figures: the
 * local backend already reloads its records before the next request, so
 * invalidating the cache is all it takes (brief §2.5, "two tabs").
 */

// MUT-368: /signup and /recover too: someone there is mid-way through asking for a link, typed email and all.
const SIGNED_OUT_PAGES = new Set(['/sign-in', '/setup', '/signup', '/recover']);

export function SessionBridge() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const local = useIsLocalMode();

  // MUT-286 review: another tab signed in, or continued on this device. This tab's next request already goes the
  // new way, so nothing cached from the old one may stay on screen: drop it all and reopen from `/`, where AuthGate
  // asks the right backend. Sign-in and setup are left alone: whoever is there is mid-way through choosing.
  useEffect(
    () =>
      onModeChangedElsewhere(() => {
        if (SIGNED_OUT_PAGES.has(router.state.location.pathname)) return;
        queryClient.clear();
        void router.navigate({ to: '/', replace: true });
      }),
    [queryClient, router],
  );

  useEffect(() => {
    if (!local) return;
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    localBackend()
      .then((backend) => {
        if (!cancelled) unsubscribe = backend.onRemoteWrite(() => void queryClient.invalidateQueries());
      })
      // A backend that can't boot shows its own error on the first request; there is nothing to listen to.
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [local, queryClient]);

  useEffect(
    () =>
      setUnauthorisedHandler(() => {
        if (queryClient.getQueryData(ME_KEY) === undefined) return;
        endSession(queryClient, router, { reason: 'expired', next: router.state.location.href });
      }),
    [queryClient, router],
  );

  useEffect(
    () =>
      onSignedOutElsewhere(() => {
        // On sign-in there is nothing to clear: whatever brought this tab here already ended its session.
        // On /setup there is no session to end, and leaving would lose the link's token (MUT-236).
        if (SIGNED_OUT_PAGES.has(router.state.location.pathname)) return;
        endSession(queryClient, router, { reason: 'signed_out' });
      }),
    [queryClient, router],
  );

  return null;
}
