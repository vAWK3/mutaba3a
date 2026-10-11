/**
 * The comparison key for an expense category name (MUT-42): trimmed, NFKC,
 * lower-cased. Stored as `nameKey` with a unique index per organization, so
 * "Rent" and " rent " are the same category and summaries never fragment.
 */
export function categoryNameKey(name: string): string {
  return name.trim().normalize('NFKC').toLowerCase();
}
