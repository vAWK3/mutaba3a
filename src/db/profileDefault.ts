import type { Table } from 'dexie';
import type { BusinessProfile } from '../types';
import { DEMO_ID_PREFIX } from '../demo/constants';

/**
 * Exactly one default business (MUT-88, ADR-071).
 *
 * Every write that can change which profile is the default runs
 * `enforceSingleDefaultProfile` inside its own transaction: the repo's
 * create/update/setDefault/archive, the demo seed, a one-business import, a
 * full restore, and the Dexie v22 repair. One rule, so two Default badges
 * can't happen whatever path wrote the rows.
 */

const isActive = (p: BusinessProfile) => !p.archivedAt;
const isDemo = (p: BusinessProfile) => p.id.startsWith(DEMO_ID_PREFIX);

/** Real before sample, then the earliest created. */
function byRealThenOldest(a: BusinessProfile, b: BusinessProfile): number {
  if (isDemo(a) !== isDemo(b)) return isDemo(a) ? 1 : -1;
  return (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
}

/**
 * Which active profile should be the default.
 * 1. Exactly one active default → that one (nothing to repair).
 * 2. Otherwise `preferId`, if active: callers that make a default flag their
 *    row first and pass its id, so it wins the tie they just created.
 * 3. Otherwise, among the active defaults (or every active profile when none
 *    is default): a real profile before a `demo_` one, then the earliest.
 * Archived profiles never qualify.
 */
export function pickDefaultProfileId(profiles: BusinessProfile[], preferId?: string): string | undefined {
  const active = profiles.filter(isActive);
  const flagged = active.filter((p) => p.isDefault);
  if (flagged.length === 1) return flagged[0].id;
  if (preferId && active.some((p) => p.id === preferId)) return preferId;
  const pool = flagged.length > 0 ? flagged : active;
  return [...pool].sort(byRealThenOldest)[0]?.id;
}

/**
 * Make the table hold exactly one default (none only when no active profile
 * exists). Rows whose flag is already right are left untouched. Run it inside
 * the caller's transaction so the repair commits with the write that needed it.
 */
export async function enforceSingleDefaultProfile(
  table: Table<BusinessProfile, string>,
  preferId?: string
): Promise<void> {
  const profiles = await table.toArray();
  const winner = pickDefaultProfileId(profiles, preferId);
  for (const p of profiles) {
    const shouldBeDefault = p.id === winner;
    if (!!p.isDefault !== shouldBeDefault) {
      await table.update(p.id, { isDefault: shouldBeDefault });
    }
  }
}
