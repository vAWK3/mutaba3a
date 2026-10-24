import type { Me } from '../api/client';
import { getLocale } from '../../lib/i18n/core';
import type { Language } from '../../lib/i18n/types';

/**
 * MUT-333 (ADR-188): what closing the account does to each of the person's profiles, as the server's hard delete
 * decides it (server/src/accounts/purge-plan.ts), told before they confirm:
 *
 *   a profile they created, owned by them alone ─► deleted with everything in it
 *   a profile they created and share ────────────► passes to the co-owner(s)
 *   anything else (a firm, Malafat, a co-owned one they didn't create) ─► kept; their records stay, without their name
 */
export interface CloseAccountImpact {
  deletes: string[];
  passesOn: Array<{ profile: string; people: string[] }>;
  leaves: string[];
}

export function closeAccountImpactOf(me: Pick<Me, 'user' | 'profiles'>): CloseAccountImpact {
  const impact: CloseAccountImpact = { deletes: [], passesOn: [], leaves: [] };
  for (const profile of me.profiles) {
    const owners = profile.owners ?? [];
    const created = profile.isPersonalDefault || owners.some((o) => o.creator && o.userId === me.user.id);
    if (!profile.owned || !created) {
      impact.leaves.push(profile.name);
      continue;
    }
    const others = owners.filter((o) => o.userId !== me.user.id);
    if (!profile.isPersonalDefault && others.length > 0) impact.passesOn.push({ profile: profile.name, people: others.map((o) => o.name ?? o.email) });
    else impact.deletes.push(profile.name);
  }
  return impact;
}

/** The hourly job may run up to an hour after the deadline; the day shown allows for it, as the mail does. */
const PURGE_JOB_LAG_MS = 60 * 60 * 1000;

/** The deletion day, long form, in the person's personal-profile zone (the mail's rule), else the browser's. */
export function closingDayLabel(deleteAfter: string, language: Language, timeZone: string | null): string {
  const instant = new Date(new Date(deleteAfter).getTime() + PURGE_JOB_LAG_MS);
  const format = (zone: string | undefined) => new Intl.DateTimeFormat(getLocale(language), { dateStyle: 'long', ...(zone ? { timeZone: zone } : {}) }).format(instant);
  try {
    return format(timeZone ?? undefined);
  } catch {
    return format(undefined);
  }
}

export function personalTimeZoneOf(me: Pick<Me, 'profiles'>): string | null {
  return me.profiles.find((p) => p.isPersonalDefault)?.timezone ?? null;
}
