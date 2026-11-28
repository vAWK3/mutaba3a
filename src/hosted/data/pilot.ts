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
