import type { QueryClient } from '@tanstack/react-query';
import type { AnyRouter } from '@tanstack/react-router';

/**
 * End the session on this tab (mut-43-auth-states.md E1–E3): drop every cached
 * figure synchronously, *then* go to sign-in, so nothing can render there.
 */
export function endSession(queryClient: QueryClient, router: AnyRouter, search: { reason: 'expired' | 'signed_out'; next?: string }) {
  queryClient.clear();
  void router.navigate({ to: '/sign-in', search, replace: true });
}
