/**
 * When the local web app suggests Malafat (MUT-190, epic MUT-189, ADR-078).
 * Pure rules: the components read the settings row, the businesses and the
 * clients, and ask these functions what to show. Nothing here reaches the
 * network (ADR-024); the link itself is `malafatUrl` (src/content/malafatLinks.ts).
 */

import type { MalafatMoment, StoredMalafatSuggestions } from '../types';

/** The working business's live clients at which the Clients page suggests Malafat (C2). */
export const MALAFAT_CLIENT_THRESHOLD = 10;

const MOMENTS: readonly MalafatMoment[] = ['business-profile', 'client-threshold', 'second-business'];

export interface MalafatSuggestions {
  /** The Settings switch "Show Malafat suggestions"; the static Settings row ignores it. */
  on: boolean;
  /** Moments retired for good, each once. */
  dismissed: MalafatMoment[];
}

/** The stored field, tolerant of a missing field (older rows, backups) and of junk. */
export function resolveMalafatSuggestions(stored: StoredMalafatSuggestions | undefined): MalafatSuggestions {
  const dismissed = Array.isArray(stored?.dismissed) ? stored.dismissed : [];
  return {
    on: stored?.off !== true,
    dismissed: MOMENTS.filter((moment) => dismissed.includes(moment)),
  };
}

/**
 * Retires a moment. The business-added note and the second-business card are
 * one event (a second business), so retiring the note retires the card too.
 */
export function dismissMoment(current: MalafatSuggestions, moment: MalafatMoment): MalafatSuggestions {
  const retired = moment === 'business-profile' ? ['business-profile', 'second-business'] : [moment];
  return { on: current.on, dismissed: MOMENTS.filter((m) => current.dismissed.includes(m) || retired.includes(m)) };
}

/** The stored form of a resolved value; both fields always written, since the repository replaces nested objects. */
export function toStored(value: MalafatSuggestions): StoredMalafatSuggestions {
  return { off: !value.on, dismissed: [...value.dismissed] };
}

interface ClientsMomentInput {
  suggestions: MalafatSuggestions;
  /** Live clients of the working business. */
  clientCount: number;
  /** Live businesses. */
  businessCount: number;
}

/** The one suggestion for the Clients page: the client threshold first, else a second business, else none. */
export function pickClientsMoment({ suggestions, clientCount, businessCount }: ClientsMomentInput): MalafatMoment | null {
  if (!suggestions.on) return null;
  const open = (moment: MalafatMoment) => !suggestions.dismissed.includes(moment);
  if (clientCount >= MALAFAT_CLIENT_THRESHOLD && open('client-threshold')) return 'client-threshold';
  if (businessCount >= 2 && open('second-business')) return 'second-business';
  return null;
}

interface BusinessAddedInput {
  suggestions: MalafatSuggestions;
  /** A business was added in this session, while another already existed. */
  businessAdded: boolean;
  businessCount: number;
}

/** The note in Settings right after a second (or later) business is added; never for the first, which is onboarding. */
export function showBusinessAddedNote({ suggestions, businessAdded, businessCount }: BusinessAddedInput): boolean {
  return suggestions.on && businessAdded && businessCount >= 2 && !suggestions.dismissed.includes('business-profile');
}

/**
 * The web build only: desktop is retired until v2. Read at render time and
 * guarded with typeof, so the test runner (no build mode) sees no suggestion.
 */
export function malafatSuggestionsEnabled(): boolean {
  return typeof __BUILD_MODE__ !== 'undefined' && __BUILD_MODE__ === 'web';
}

interface MarkInput {
  /** Live businesses after the create. */
  liveBusinesses: number;
  /** A visitor sample is open (MUT-78). */
  sample: boolean;
  /** Demo data is loaded. */
  demo: boolean;
}

/** Whether a business just created should bring up the business-added note: never the first (onboarding), never in sample or demo data. */
export function shouldMarkBusinessAdded({ liveBusinesses, sample, demo }: MarkInput): boolean {
  return liveBusinesses >= 2 && !sample && !demo;
}
