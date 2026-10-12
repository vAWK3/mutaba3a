/**
 * Composable filter helpers for consistent query behavior across repositories.
 * Every repository should chain these into its .filter() calls to ensure
 * soft-deleted records are excluded and profile scoping is enforced.
 */

import type { ProfileScope } from '../types';

/**
 * Returns true if the record is NOT soft-deleted (safe to include in results).
 */
export function excludeDeleted(record: { deletedAt?: string | null }): boolean {
  return !record.deletedAt;
}

/**
 * Returns true if the record belongs to the given business, or to one of the
 * given businesses (or if no business filter is specified). A record with no
 * business never matches a list: All businesses is the switcher's businesses,
 * not every record (MUT-89, O3).
 */
export function scopeToProfile(record: { profileId?: string }, scope?: ProfileScope): boolean {
  if (typeof scope !== 'string') {
    return scope === undefined || (record.profileId !== undefined && scope.includes(record.profileId));
  }
  if (!scope) return true;
  return record.profileId === scope;
}
