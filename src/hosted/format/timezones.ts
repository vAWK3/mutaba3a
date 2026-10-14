/**
 * Time zone choices for a new profile (MUT-183). The zone is set once, at
 * creation (MUT-181 decision 4), and decides which day "today" is for the
 * profile, so the default is the browser's own.
 */

const FALLBACK_ZONE = 'UTC';

export function browserTimezone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_ZONE;
}

let allZones: readonly string[] | null = null;

/** The engine's IANA list, read once per page load (about 420 entries). */
function engineZones(): readonly string[] {
  if (allZones === null) {
    const supported = (Intl as { supportedValuesOf?: (key: 'timeZone') => string[] }).supportedValuesOf;
    allZones = supported ? supported('timeZone') : [];
  }
  return allZones;
}

/**
 * Every zone to offer, always including `selected`: some engines leave out
 * `UTC` or the legacy alias the browser itself reports (`Asia/Calcutta`).
 */
export function timezoneOptions(selected: string, zones: readonly string[] = engineZones()): string[] {
  if (zones.includes(selected)) return [...zones];
  return [...zones, selected].sort();
}
