import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { setUnauthorisedHandler } from '../api/client';
import { onSignedOutElsewhere } from './channel';
import { endSession } from './endSession';
import { ME_KEY } from './me';

/**
 * The one place the session ends (mut-43-auth-states.md E1, E3). The query
 * cache is cleared synchronously *before* navigating, so no figure can render
 * on the sign-in route. A 401 while nobody was signed in (first load, or the
 * sign-in page's own check) is left to the route that asked.
 */

export function SessionBridge() {
  const queryClient = useQueryClient();
  const router = useRouter();

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
        if (router.state.location.pathname === '/sign-in') return;
        endSession(queryClient, router, { reason: 'signed_out' });
      }),
    [queryClient, router],
  );

  return null;
}
