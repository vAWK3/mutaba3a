import type { QueryClient } from '@tanstack/react-query';
import type { AnyRouter } from '@tanstack/react-router';
import { useSavedFlashStore } from '../../lib/savedFlashStore';
import { useMalafatPortalMoments } from './malafatMoments';

/**
 * End the session on this tab (mut-43-auth-states.md E1–E3): drop every cached
 * figure synchronously, *then* go to sign-in, so nothing can render there. The
 * after-save store is cleared too (MUT-91): it holds a record id and profile.
 */
export function endSession(queryClient: QueryClient, router: AnyRouter, search: { reason: 'expired' | 'signed_out'; next?: string }) {
  queryClient.clear();
  useSavedFlashStore.getState().clear();
  // MUT-191: the next person in this tab starts with no Malafat moment pending
  useMalafatPortalMoments.getState().reset();
  void router.navigate({ to: '/sign-in', search, replace: true });
}
