import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { setMode, setUnhintedMode } from './mode';

/**
 * "Continue on this device" from the sign-in page and "Try it on this device" from the welcome (MUT-513): the portal
 * switches to this device's records and opens them from `/`. Nothing cached from the server may stay on screen.
 *
 * `remember: false` is the welcome after the server couldn't be reached (D7): the choice holds for this page only, so
 * an account holder caught in an outage gets their account back on the next load.
 */
export function useContinueOnThisDevice(): (options?: { remember?: boolean }) => void {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return ({ remember = true } = {}) => {
    if (remember) setMode('local');
    else setUnhintedMode('local');
    queryClient.clear();
    void navigate({ to: '/', replace: true });
  };
}
