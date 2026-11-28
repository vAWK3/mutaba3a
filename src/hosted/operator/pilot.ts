import type { OperatorAccountListItem } from '../api/client';
import { PILOT_LAST_DAYS } from '../data/pilot';

/**
 * MUT-757 (design review 5A, build decision P8): an Accounts row's pilot chip, derived from `pilot.endsAt` (the server
 * sends no wording): "Pilot · ends <date>", then "N days left" in the last 14 days, then "Ended". Pure.
 */
export interface OperatorPilot {
  cohort: string;
  startedAt: string;
  endsAt: string;
  referredBy: { id: string; email: string; displayName: string } | null;
  /** MUT-777 (ADR-333): when the tester said yes to watched sessions; null: not asked or no. */
  watchConsentAt?: string | null;
}

export type PilotChip = { kind: 'ends'; endsAt: string } | { kind: 'daysLeft'; days: number } | { kind: 'ended' };

const DAY_MS = 86_400_000;

/** The row's pilot, or null (no pilot ever, or a server older than 1.171.0). The generated type is a loose union. */
export function rowPilotOf(account: Pick<OperatorAccountListItem, 'pilot'>): OperatorPilot | null {
  return ((account.pilot ?? null) as OperatorPilot | null) ?? null;
}

export function pilotChipOf(pilot: Pick<OperatorPilot, 'endsAt'>, now: Date): PilotChip {
  const left = Date.parse(pilot.endsAt) - now.getTime();
  if (left <= 0) return { kind: 'ended' };
  const days = Math.ceil(left / DAY_MS);
  return days <= PILOT_LAST_DAYS ? { kind: 'daysLeft', days } : { kind: 'ends', endsAt: pilot.endsAt };
}

/** The grant form's pilot fields: a cohort is a lowercase slug (the server's rule, ADR-296 P1). */
const COHORT_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function isCohort(value: string): boolean {
  return COHORT_RE.test(value);
}
