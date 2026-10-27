/**
 * When Mutaba3a suggests Malafat (MUT-190, epic MUT-189, ADR-078). The portal
 * reads the clients and asks this what to show; the local web app's other
 * suggestion rules were retired with it (MUT-445). Nothing here reaches the
 * network (ADR-024); the link itself is `malafatUrl` (src/content/malafatLinks.ts).
 */

/** A contextual Malafat suggestion that can be retired (the Settings row itself can't). */
export type MalafatMoment = 'business-profile' | 'client-threshold' | 'second-business';

/** The working business's live clients at which the Clients page suggests Malafat (C2). */
export const MALAFAT_CLIENT_THRESHOLD = 10;

export interface MalafatSuggestions {
  /** The Settings switch "Show Malafat suggestions"; the static Settings row ignores it. */
  on: boolean;
  /** Moments retired for good, each once. */
  dismissed: MalafatMoment[];
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
