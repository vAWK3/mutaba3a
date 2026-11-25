import type { HostedProfile, IssuingSetup, Me } from '../api/client';
import { useIssuingSetup } from '../data/issuingQueries';
import { todayLocalISO } from '../format/dates';
import { useMeOrNull } from '../session/me';
import { useIsLocalMode } from '../session/mode';
import { SETUP_STEPS, type SetupStep } from '../pages/invoicing/setupSteps';

/**
 * MUT-722 (ADR-278): where invoicing is available on a profile but its setup can't issue yet, saving a shekel income
 * says "Finish setting up invoicing to issue its invoice" with Set up, instead of offering nothing (MUT-648 stays as it
 * is once the setup can issue). At most once a day per person and profile, remembered in this browser only, the
 * firm-banner precedent: storage that throws counts as not shown, and a day it refuses to remember lasts the page.
 */

type HintProfile = Pick<HostedProfile, 'id' | 'type' | 'owned' | 'writerOfRecord' | 'managedInMalafat'>;

/** Invoicing is available here: the person holds `invoicing`, on a business profile they own that Malafat doesn't write. */
export function invoicingAvailable(profile: HintProfile, me: Pick<Me, 'user'> | null, local: boolean): boolean {
  if (local || !me) return false;
  return me.user.features.includes('invoicing') && profile.owned === true && profile.type === 'BUSINESS' && profile.writerOfRecord !== 'MALAFAT' && !profile.managedInMalafat;
}

/** The first step issuing still waits for (details, then numbering); the setup page opens on it. */
export function firstMissingStep(setup: Pick<IssuingSetup, 'missing'>): SetupStep {
  const missing = new Set<SetupStep>(setup.missing.map((m) => (m === 'DETAILS' ? 'details' : 'numbering')));
  return SETUP_STEPS.find((step) => missing.has(step)) ?? 'details';
}

export function setupHintKey(userId: string, profileId: string): string {
  return `mutaba3a-setup-hint:${userId}:${profileId}`;
}

export function setupHintShownOn(key: string, day: string): boolean {
  try {
    return localStorage.getItem(key) === day;
  } catch {
    return false;
  }
}

export function rememberSetupHintShown(key: string, day: string): void {
  try {
    localStorage.setItem(key, day);
  } catch {
    // Private windows can refuse storage; the hint may then show again after the next save
  }
}

export interface SetupHint {
  /** Invoicing is available and the server says the setup can't issue yet. */
  due: boolean;
  /** Where Set up opens the setup. */
  step: SetupStep;
  /** True once a day: the save moment shows the hint, and the day is remembered (showing it counts, AC2). */
  takeToday: () => boolean;
}

export function useSetupHint(profile: HintProfile): SetupHint {
  const me = useMeOrNull();
  const available = invoicingAvailable(profile, me, useIsLocalMode());
  const setup = useIssuingSetup(profile.id, available);
  const due = available && setup.data !== undefined && !setup.data.canIssue;
  const step = setup.data ? firstMissingStep(setup.data) : 'details';
  const takeToday = () => {
    if (!due || !me) return false;
    const key = setupHintKey(me.user.id, profile.id);
    const today = todayLocalISO();
    if (setupHintShownOn(key, today)) return false;
    rememberSetupHintShown(key, today);
    return true;
  };
  return { due, step, takeToday };
}

/** The setup page's `?step=`: a known step survives, anything else is dropped. */
export function parseSetupStepSearch(raw: Record<string, unknown>): { step?: SetupStep } {
  const step = raw.step;
  return typeof step === 'string' && (SETUP_STEPS as readonly string[]).includes(step) ? { step: step as SetupStep } : {};
}
