import { addDays, daysBetween, type IsoDate } from '../dates.js';
import { FUZZY_SUGGESTION_FLOOR, scoreVendorName, vendorNameKey } from '../vendors/keys.js';

/**
 * MUT-435 (AC2, epic MUT-432 decision 4): the one rule for "this is probably the same purchase" — same currency, same
 * amount, dated within MATCH_DATE_WINDOW_DAYS either side, and a similar vendor ranking it higher. A missing vendor on
 * either side never excludes a candidate (a receipt or a statement line often has none); it only ranks lower.
 * `find_similar_expenses` and, since MUT-437, every agent expense write (`findLookAlikes`) use it; nothing redefines it.
 */
export const MATCH_DATE_WINDOW_DAYS = 3;

export interface MatchProbe {
  amountMinor: bigint;
  currency: string;
  occurredOn: IsoDate;
  vendor?: string | null | undefined;
}

export interface MatchCandidate {
  amountMinor: bigint;
  currency: string;
  occurredOn: IsoDate;
  vendor: string | null;
}

export type MatchReason = 'currency' | 'amount' | 'date' | 'vendor';
/** MUT-437 (D2): how the two vendors compare. Reported only: a different vendor never excludes a match. */
export type VendorMatch = 'similar' | 'different' | 'unknown';

export interface MatchResult {
  matches: boolean;
  /** Higher is a better match: a similar vendor first, then the nearest date. Meaningless when `matches` is false. */
  score: number;
  daysApart: number;
  reasons: MatchReason[];
  vendorMatch: VendorMatch;
}

/** The inclusive date range a candidate must fall in: the store's `from`/`to` filter for a probe. */
export function dateWindow(occurredOn: IsoDate): { from: IsoDate; to: IsoDate } {
  return { from: addDays(occurredOn, -MATCH_DATE_WINDOW_DAYS), to: addDays(occurredOn, MATCH_DATE_WINDOW_DAYS) };
}

/** Below this, a prefix or a substring says nothing ("a" starts "amazon"): only the same name counts. */
export const MIN_VENDOR_KEY_FOR_PARTIAL = 3;

/** Typeahead scoring is one-directional (query prefix of a name); a match reads both ways. Null when either side has none. */
function vendorSimilarity(a: string | null | undefined, b: string | null | undefined): number | null {
  const ka = a ? vendorNameKey(a) : '';
  const kb = b ? vendorNameKey(b) : '';
  if (!ka || !kb) return null;
  if (ka === kb) return 1;
  if (Math.min([...ka].length, [...kb].length) < MIN_VENDOR_KEY_FOR_PARTIAL) return 0;
  return Math.max(scoreVendorName(ka, kb), scoreVendorName(kb, ka));
}

export function matchScore(probe: MatchProbe, candidate: MatchCandidate): MatchResult {
  const daysApart = Math.abs(daysBetween(probe.occurredOn, candidate.occurredOn));
  const matches = probe.currency === candidate.currency && probe.amountMinor === candidate.amountMinor && daysApart <= MATCH_DATE_WINDOW_DAYS;
  const vendor = vendorSimilarity(probe.vendor, candidate.vendor);
  const similar = vendor !== null && vendor >= FUZZY_SUGGESTION_FLOOR;
  const reasons: MatchReason[] = ['currency', 'amount', 'date'];
  if (similar) reasons.push('vendor');
  // Vendor similarity dominates; a nearer date breaks ties (0..1 over the window).
  const score = (similar ? 1 + vendor : 0) + (MATCH_DATE_WINDOW_DAYS + 1 - daysApart) / (MATCH_DATE_WINDOW_DAYS + 1);
  const vendorMatch: VendorMatch = vendor === null ? 'unknown' : similar ? 'similar' : 'different';
  return { matches, score, daysApart, reasons: matches ? reasons : [], vendorMatch };
}

/** The candidates that match, best first. */
export function rankMatches<T extends MatchCandidate>(probe: MatchProbe, candidates: readonly T[]): Array<{ item: T; match: MatchResult }> {
  return candidates
    .map((item) => ({ item, match: matchScore(probe, item) }))
    .filter((r) => r.match.matches)
    .sort((a, b) => b.match.score - a.match.score);
}
