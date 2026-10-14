import type { MalafatMoment, MalafatSuggestionsChange, MalafatSuggestionsRecord } from './repositories/ports.js';

/** The moments in their fixed order (MUT-189). */
export const MALAFAT_MOMENTS: readonly MalafatMoment[] = ['business-profile', 'client-threshold', 'second-business'];

/** What a person who never changed anything gets: on, nothing dismissed. */
export const DEFAULT_MALAFAT_SUGGESTIONS: MalafatSuggestionsRecord = { off: false, dismissed: [] };

/** The stored value, tolerant of NULL and of anything malformed. */
export function resolveMalafatSuggestions(stored: unknown): MalafatSuggestionsRecord {
  if (!stored || typeof stored !== 'object') return { ...DEFAULT_MALAFAT_SUGGESTIONS, dismissed: [] };
  const value = stored as { off?: unknown; dismissed?: unknown };
  const dismissed = Array.isArray(value.dismissed) ? value.dismissed : [];
  return { off: value.off === true, dismissed: MALAFAT_MOMENTS.filter((m) => dismissed.includes(m)) };
}

/** One change applied to what is stored: `off` replaces, `dismiss` is unioned. */
export function applyMalafatChange(stored: unknown, change: MalafatSuggestionsChange): MalafatSuggestionsRecord {
  const current = resolveMalafatSuggestions(stored);
  const dismissed = new Set<MalafatMoment>([...current.dismissed, ...(change.dismiss ?? [])]);
  return { off: change.off ?? current.off, dismissed: MALAFAT_MOMENTS.filter((m) => dismissed.has(m)) };
}
