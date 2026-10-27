import type { EntitlementGrant } from '../api/client';
import { todayLocalISO } from '../format/dates';

/**
 * MUT-462 (design 14A): the billing grant drawer's dates, and where a grant stands. Pure, so the page tests stay about
 * the page.
 */
export type GrantState = 'active' | 'revoked' | 'ended';

/** The drawer's presets: 30 days, 90 days, or no end. */
export const GRANT_PRESET_DAYS = [30, 90] as const;

const DAY_MS = 86_400_000;

/** A grant is in force until revoked or past its expiry. */
export function grantStateOf(grant: Pick<EntitlementGrant, 'revokedAt' | 'expiresAt'>, now: Date): GrantState {
  if (grant.revokedAt) return 'revoked';
  if (grant.expiresAt && Date.parse(grant.expiresAt) <= now.getTime()) return 'ended';
  return 'active';
}

/** The local day `days` from today, as the date input holds it. */
export function presetDay(days: number, now: Date): string {
  return todayLocalISO(new Date(now.getTime() + days * DAY_MS));
}

/**
 * The expiry the server is sent for a chosen day: the end of that day where the operator is, so "until 26 Nov" covers
 * all of 26 Nov. Empty is no end. A day that isn't a real date is null (the drawer says so).
 */
export function grantExpiryOf(day: string): string | undefined | null {
  if (day === '') return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  // A date-time with no zone reads as local time; a day that doesn't exist (Feb 30) rolls over and no longer matches.
  const end = new Date(`${day}T23:59:59.999`);
  if (Number.isNaN(end.getTime()) || todayLocalISO(end) !== day) return null;
  return end.toISOString();
}

/** A chosen day today or earlier can't be an expiry: the grant would end before it began. */
export function isFutureDay(day: string, now: Date): boolean {
  return day > todayLocalISO(now);
}
