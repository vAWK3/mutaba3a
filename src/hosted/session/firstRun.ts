import type { Me } from '../api/client';
import { trialWelcomeDue } from '../data/trialPrompt';

/** MUT-418: the Billing drawer's first-run step, "Your 14-day free trial has started". */
export const TRIAL_WELCOME_SEARCH = { billing: true, step: 'welcome' } as const;

export interface FirstRunTarget {
  to: string;
  search?: typeof TRIAL_WELCOME_SEARCH;
}

/**
 * Where a person lands after the first sign-in from a signup link (MUT-368, D13): their personal profile's Home.
 * MUT-418: with a new trial and no card, Home opens on the trial step (`?billing=true&step=welcome`) in the same
 * navigation, so there is one history entry and no flash of Home first. Anywhere a profile is missing, `/` decides
 * (HomeRedirect: the first profile, or the offer to create one). `TrialWelcomeOpener` covers first sign-ins that never
 * pass through /setup (an operator-approved signup signs in on /sign-in).
 */
export function firstRunPath(me: Me, now: Date = new Date()): FirstRunTarget {
  const personal = me.profiles.find((profile) => profile.isPersonalDefault);
  if (!personal) return { to: '/' };
  return trialWelcomeDue(me, now) ? { to: `/p/${personal.id}`, search: TRIAL_WELCOME_SEARCH } : { to: `/p/${personal.id}` };
}
