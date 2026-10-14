import { useCallback, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useProfileStore } from '../lib/profileStore';
import { useMalafatMomentStore } from '../lib/malafatMomentStore';
import { useSampleSessionStore } from './sampleSessionStore';
import { SAMPLE_QUERY_PARAM, readSampleSession } from './sampleSession';
import { enterVisitorSample, leaveVisitorSample } from './visitorSample';

/** Remove a query parameter from the address bar without a navigation. */
function stripQueryParam(name: string): void {
  const params = new URLSearchParams(window.location.search);
  params.delete(name);
  const query = params.toString();
  window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
}

/**
 * When the app is opened from the landing page (`?sample=1`), open the sample
 * business with no dialogs (MUT-78). Mounted once, in `AppShell`.
 */
export function useVisitorSampleEntry(): void {
  const queryClient = useQueryClient();
  const setStatus = useSampleSessionStore((s) => s.setStatus);
  const setActiveProfile = useProfileStore((s) => s.setActiveProfile);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get(SAMPLE_QUERY_PARAM) !== '1') return;
    stripQueryParam(SAMPLE_QUERY_PARAM);

    // No cancellation on cleanup: only the first run sees the parameter (it is
    // stripped above), so under StrictMode's double mount a cancelled first
    // run would leave the app "preparing" for good. The stores it updates are
    // global, so finishing after an unmount is safe.
    setStatus('preparing');
    enterVisitorSample()
      .then(async (result) => {
        if (result.kind === 'sample') setActiveProfile(result.profileId);
        await queryClient.invalidateQueries();
        setStatus(readSampleSession() ? 'active' : 'none');
      })
      .catch((error) => {
        console.error('[sample] could not open the sample:', error);
        setStatus(readSampleSession() ? 'active' : 'none');
      });
  }, [queryClient, setActiveProfile, setStatus]);
}

/** "Start with your own": clear the sample and land on the first run. */
export function useLeaveSample(): () => Promise<void> {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setStatus = useSampleSessionStore((s) => s.setStatus);
  const resetProfile = useProfileStore((s) => s.reset);

  return useCallback(async () => {
    await leaveVisitorSample();
    resetProfile();
    useMalafatMomentStore.getState().clearBusinessAdded();
    setStatus('none');
    await queryClient.invalidateQueries();
    navigate({ to: '/', replace: true });
  }, [navigate, queryClient, resetProfile, setStatus]);
}
