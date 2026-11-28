import { useEffect } from 'react';
import { useSearch } from '@tanstack/react-router';
import { pickShellOverlay } from '../data/filters';
import { pilotWelcomeDue } from '../data/pilot';
import { usePilot } from '../data/pilotQueries';
import { takePilotWelcomeOffer } from '../session/pilotWelcomeOffer';
import { useAccountDrawers } from './AccountDrawers';

/**
 * MUT-755 (design review 3B): opens the pilot Welcome once per account, on the first page a tester reaches with no
 * other drawer open. It replaces the URL with `?pilotWelcome=true`, so Back never lands on it. At most once per page
 * load: the server's flag (set when it closes) keeps it closed on every later visit and device.
 */
export function PilotWelcomeOpener() {
  const drawers = useAccountDrawers();
  const { billing } = usePilot();
  const overlayOpen = Object.keys(pickShellOverlay(useSearch({ strict: false }) as Record<string, unknown>)).length > 0;
  const due = !overlayOpen && pilotWelcomeDue(billing);
  useEffect(() => {
    if (due && takePilotWelcomeOffer()) drawers.openPilotWelcome();
  }, [due, drawers]);
  return null;
}
