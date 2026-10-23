import { useLostAccess } from './lostAccess';
import type { QueryClient } from '@tanstack/react-query';
import type { AnyRouter } from '@tanstack/react-router';
import { useSavedFlashStore } from '../../lib/savedFlashStore';
import { useMalafatPortalMoments } from './malafatMoments';
import { endPortalUsage } from '../analytics/portalAnalytics';
import { setReporterUser } from '../observability/errorReporting';

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
  useLostAccess.getState().reset();
  // MUT-155: sign-out (this tab or another) forgets the usage choice and its random ID, sending
  // nothing; an expired session is the same person, so the choice stays (rule 6, B4)
  if (search.reason === 'signed_out') endPortalUsage();
  // MUT-149: whoever signs in next is not this person
  setReporterUser(null);
  void router.navigate({ to: '/sign-in', search, replace: true });
}
