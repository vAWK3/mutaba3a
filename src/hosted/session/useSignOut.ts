import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { api } from '../api/client';
import { useToast } from '../components/Toast';
import { useT } from '../../lib/i18n/core';
import { announceSignedOut } from './channel';
import { endSession } from './endSession';
import { setMode } from './mode';

/**
 * Sign out (mut-43-auth-states.md E2, S13). The cookie is httpOnly, so only the
 * server can end the session: if `DELETE` fails, the person is told and stays
 * signed in rather than being shown a sign-out that didn't happen.
 */
export function useSignOut(options: { onFailed?: () => void } = {}): { signOut: () => Promise<void>; signingOut: boolean } {
  const { onFailed } = options;
  const queryClient = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const t = useT();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await api.signOut();
    } catch {
      setSigningOut(false);
      // MUT-346: a caller above the inert app (the Updated-terms dialog) says it where it can be seen
      if (onFailed) onFailed();
      else toast(t('hosted.auth.signOutFailed'));
      return;
    }
    // Signed out, this device is the local app again (MUT-286); another tab reads the same hint.
    setMode('local');
    announceSignedOut();
    endSession(queryClient, router, { reason: 'signed_out' });
  }, [queryClient, router, toast, t, onFailed]);

  return { signOut, signingOut };
}
