import { useEffect } from 'react';
import { useSearch } from '@tanstack/react-router';
import { pickShellOverlay } from '../data/filters';
import { trialWelcomeDue } from '../data/trialPrompt';
import { useMe } from '../session/me';
import { useIsLocalMode } from '../session/mode';
import { takeTrialWelcomeOffer } from '../session/trialWelcomeOffer';
import { useAccountDrawers } from './AccountDrawers';

/**
 * MUT-418 (D6): opens the first-run trial step for a first sign-in that never passed through /setup's `firstRunPath`
 * (an operator-approved signup signs in on /sign-in; another device before the person answered). It waits for no
 * other drawer to be open, then replaces the URL with `?billing=true&step=welcome`, so Back never lands on it.
 */
export function TrialWelcomeOpener() {
  const me = useMe();
  const local = useIsLocalMode();
  const drawers = useAccountDrawers();
  const overlayOpen = Object.keys(pickShellOverlay(useSearch({ strict: false }) as Record<string, unknown>)).length > 0;
  const due = !local && !overlayOpen && trialWelcomeDue(me, new Date());
  useEffect(() => {
    if (due && takeTrialWelcomeOffer()) drawers.openBilling('welcome', true);
  }, [due, drawers]);
  return null;
}
