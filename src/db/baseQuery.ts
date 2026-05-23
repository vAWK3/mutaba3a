/**
 * Composable filter helpers for consistent query behavior across repositories.
 * Every repository should chain these into its .filter() calls to ensure
 * soft-deleted records are excluded and profile scoping is enforced.
 */

/**
 * Returns true if the record is NOT soft-deleted (safe to include in results).
 */
export function excludeDeleted(record: { deletedAt?: string | null }): boolean {
  return !record.deletedAt;
}

/**
 * Returns true if the record belongs to the given profile (or if no profile filter is specified).
 */
export function scopeToProfile(record: { profileId?: string }, profileId?: string): boolean {
  if (!profileId) return true;
  return record.profileId === profileId;
}
