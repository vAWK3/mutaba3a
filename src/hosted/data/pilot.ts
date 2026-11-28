import type { BillingOverview, Me, Schemas } from '../api/client';

/**
 * MUT-753 (plan `docs/designs/pilot-testers-business-plan.md`, design review): the free pilot as the portal reads it
 * from GET /v1/billing (`pilot`, `pilotEnded`). Pure. The server decides who is a tester and until when; prices and
 * limits come from `pilot.plans` and are never written here (eng review D4).
 */

export type BillingPilot = Schemas['BillingPilot'];
export type BillingPilotEnded = Schemas['BillingPilotEnded'];
export type PilotPlan = BillingPilot['plans'][number];

/** Design review, interaction states: the last 14 days say "N days left" and "Ends <date>". */
export const PILOT_LAST_DAYS = 14;

/** The running pilot, or null (none, or a server older than 1.162.0). The generated type is a loose nullable union. */
export function billingPilotOf(billing: Partial<Pick<BillingOverview, 'pilot'>> | null | undefined): BillingPilot | null {
  return ((billing?.pilot ?? null) as BillingPilot | null) ?? null;
}

/** MUT-753 (ADR-330): the pilot that ended lately, or null (none, or a server older than 1.200.0). */
export function billingPilotEndedOf(billing: Partial<Pick<BillingOverview, 'pilotEnded'>> | null | undefined): BillingPilotEnded | null {
  return ((billing?.pilotEnded ?? null) as BillingPilotEnded | null) ?? null;
}

/**
 * The currency the plans' Expected prices show in: the saved billing address's (ILS in Israel, else USD), ILS when
 * none is saved (the design partners' clients are in Israel and Palestine), and the other one when that has no price.
 */
export function pilotCurrencyOf(billing: Pick<BillingOverview, 'billingAddress'>, plans: readonly PilotPlan[]): 'ILS' | 'USD' {
  const country = (billing.billingAddress as { country?: string } | null | undefined)?.country;
  const wanted: 'ILS' | 'USD' = !country || country === 'IL' ? 'ILS' : 'USD';
  const other: 'ILS' | 'USD' = wanted === 'ILS' ? 'USD' : 'ILS';
  const priced = (c: 'ILS' | 'USD') => plans.some((p) => p.expectedMonthly[c] !== null);
  return priced(wanted) || !priced(other) ? wanted : other;
}

/**
 * MUT-755: whether this person may be on a pilot, from /v1/me alone: a profile they own is covered by an operator
 * grant that ends (a pilot grant always ends, ADR-296). Only then does the shell read GET /v1/billing for the
 * Welcome and the milestones, so nobody else pays for that read.
 */
export function mayBeOnPilot(me: Pick<Me, 'profiles' | 'user'>): boolean {
  if (me.user.status !== undefined && me.user.status !== 'ACTIVE') return false;
  return me.profiles.some((p) => p.owned === true && p.billing?.source === 'OPERATOR' && p.billing.until !== null);
}

/** MUT-755 (design review 3B): the Welcome opens once per account: a pilot runs and it was never closed. */
export function pilotWelcomeDue(billing: Partial<Pick<BillingOverview, 'pilot'>> | null | undefined): boolean {
  const pilot = billingPilotOf(billing);
  return pilot !== null && pilot.welcomeSeenAt === null;
}

// ---- The milestones: first scan, first invoice (MUT-758 S5, ADR-298) ----------------------------------------------

export type PilotFirst = 'scan' | 'invoice';
export const PILOT_FIRSTS: readonly PilotFirst[] = ['scan', 'invoice'];

/** What this browser saw of the person's firsts: which were still null at a read, and which it already celebrated. */
export interface FirstsMemory {
  nullSeen: PilotFirst[];
  celebrated: PilotFirst[];
}

export const NO_FIRSTS_MEMORY: FirstsMemory = { nullSeen: [], celebrated: [] };

function firstAt(pilot: BillingPilot, first: PilotFirst): string | null {
  return (first === 'scan' ? pilot.firstScanAt : pilot.firstInvoiceAt) ?? null;
}

/**
 * ADR-298 rule 2: a "first" happens when the field was null at this browser's last read and is set now. Only those
 * are celebrated (and sent, MUT-758), once each; a first made before this browser ever looked is not.
 */
export function firstsReached(pilot: BillingPilot | null, memory: FirstsMemory): PilotFirst[] {
  if (!pilot) return [];
  return PILOT_FIRSTS.filter((f) => firstAt(pilot, f) !== null && memory.nullSeen.includes(f) && !memory.celebrated.includes(f));
}

/** The memory after this read: firsts still null are remembered as such; reached ones are marked celebrated. */
export function nextFirstsMemory(pilot: BillingPilot | null, memory: FirstsMemory): FirstsMemory {
  if (!pilot) return memory;
  const nullNow = PILOT_FIRSTS.filter((f) => firstAt(pilot, f) === null);
  const reached = firstsReached(pilot, memory);
  return { nullSeen: [...new Set([...memory.nullSeen, ...nullNow])], celebrated: [...new Set([...memory.celebrated, ...reached])] };
}

/** The hours from the pilot's start to a first (MUT-758 `hours_since_start`), never negative; null without a start. */
export function hoursSinceStart(pilot: BillingPilot, first: PilotFirst): number | null {
  const at = firstAt(pilot, first);
  if (!at || !pilot.startedAt) return null;
  return Math.max(0, Math.floor((new Date(at).getTime() - new Date(pilot.startedAt).getTime()) / 3_600_000));
}

const FIRSTS_STORE = 'mutaba3a-pilot-firsts';

/** Per-viewer convenience (DESIGN: never state that must persist): a blocked store only means no celebration. */
export function readFirstsMemory(userId: string): FirstsMemory {
  try {
    const all = JSON.parse(localStorage.getItem(FIRSTS_STORE) ?? '{}') as Record<string, FirstsMemory>;
    const mine = all[userId];
    return mine && Array.isArray(mine.nullSeen) && Array.isArray(mine.celebrated) ? mine : NO_FIRSTS_MEMORY;
  } catch {
    return NO_FIRSTS_MEMORY;
  }
}

export function writeFirstsMemory(userId: string, memory: FirstsMemory): void {
  try {
    const all = JSON.parse(localStorage.getItem(FIRSTS_STORE) ?? '{}') as Record<string, FirstsMemory>;
    localStorage.setItem(FIRSTS_STORE, JSON.stringify({ ...all, [userId]: memory }));
  } catch {
    // Nothing to do: the celebration is a convenience.
  }
}
