/**
 * The free web app's "Go hosted" call to action (MUT-187): the sidebar card's
 * 30-day snooze, where its dismissal is kept, and the build-time gates.
 *
 * The dismissal is a per-browser UI preference, like the sidebar's collapsed
 * state: it lives in localStorage, never in the database, so it doesn't travel
 * in backups. Nothing here reaches the network (ADR-024).
 */

/** How long the sidebar card stays hidden after the person dismisses it. */
export const GO_HOSTED_SNOOZE_DAYS = 30;

export const GO_HOSTED_DISMISSED_KEY = 'mutaba3a-go-hosted-dismissed-at';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether the card should show: never dismissed, or dismissed at least the
 * snooze period ago. A dismissal in the future (a clock set back, a hand-edited
 * value) counts as due, so no stored value can hide the card for good.
 */
export function isGoHostedCardDue(dismissedAt: number | null, now: number): boolean {
  if (dismissedAt === null || dismissedAt > now) return true;
  return now - dismissedAt >= GO_HOSTED_SNOOZE_DAYS * DAY_MS;
}

/** When the card was last dismissed, or null if never, unreadable, or storage is blocked. */
export function readDismissedAt(): number | null {
  try {
    const raw = localStorage.getItem(GO_HOSTED_DISMISSED_KEY);
    if (!raw) return null;
    const at = Number(raw);
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

/** Remembers the dismissal; a storage that refuses it leaves the card hidden for this tab only. */
export function writeDismissedAt(at: number): void {
  try {
    localStorage.setItem(GO_HOSTED_DISMISSED_KEY, String(at));
  } catch {
    // Private mode or blocked site data: the caller's state still hides the card
  }
}

/**
 * The CTA ships in the web build only (desktop is retired until v2). Read at
 * render time, and guarded with typeof: the test runner defines no build mode,
 * so every existing test sees the UI without the CTA.
 */
export function goHostedEnabled(): boolean {
  return typeof __BUILD_MODE__ !== 'undefined' && __BUILD_MODE__ === 'web';
}

/** The portal origin the sign-in link opens (MUTABA3A_PORTAL_URL), or "" where the build set none. */
export function hostedPortalUrl(): string {
  return typeof __PORTAL_URL__ !== 'undefined' ? __PORTAL_URL__ : '';
}
