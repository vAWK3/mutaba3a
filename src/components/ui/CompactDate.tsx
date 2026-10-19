import { formatDateCompact } from '../../lib/utils';

/**
 * A compact table's date (dd/mm/yyyy) in the figure face: Plex Mono with tabular
 * digits (`.num`). Thmanyah's digits are proportional, so a date column set in it
 * changed width with the date (MUT-250); in the figure face every date is one width.
 */
export function CompactDate({ iso }: { iso: string }) {
  return <span className="num">{formatDateCompact(iso)}</span>;
}
