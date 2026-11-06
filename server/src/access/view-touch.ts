/**
 * MUT-560: the "last viewed" throttle, one rule for every read-only viewer of a profile: an accountant's grant (MUT-559,
 * auth/middleware.ts) and a share link's viewer (share-links/access.ts). Kept free of Node-only imports: the memory
 * store and the middleware import what imports this.
 */

/** A "last viewed" stamp is written at most this often, as sessions.touch is throttled. */
export const VIEW_TOUCH_MS = 3_600_000;

const utcDay = (at: Date) => at.toISOString().slice(0, 10);

/**
 * Whether a view stamps `lastViewedAt` (at most once an hour) and whether it is the first stamp of its UTC day (an
 * accountant's grant writes an `accountant.viewed` audit row then, at most one a day).
 */
export function viewTouch(lastViewedAt: Date | null, now: Date): { touch: boolean; firstOfDay: boolean } {
  if (lastViewedAt && now.getTime() - lastViewedAt.getTime() < VIEW_TOUCH_MS) return { touch: false, firstOfDay: false };
  return { touch: true, firstOfDay: !lastViewedAt || utcDay(lastViewedAt) !== utcDay(now) };
}
