import { notesSince, type ReleaseEntry, type ReleaseNotes } from './releaseNotes';

/**
 * The newest version whose "What's new" this browser has dismissed (MUT-24).
 * The app shows notes for every version after it, up to the running one. That
 * survives a tab closed without dismissing; `app-last-known-version` would not,
 * because `handleVersionChange` rewrites it on every start.
 */
export const WHATS_NEW_SEEN_KEY = 'whats-new-seen-version';

function read(): string | null {
  try {
    return localStorage.getItem(WHATS_NEW_SEEN_KEY);
  } catch {
    return null;
  }
}

function write(version: string): void {
  try {
    localStorage.setItem(WHATS_NEW_SEEN_KEY, version);
  } catch {
    // Without storage the notes cannot be remembered; nothing shows instead
  }
}

/**
 * Called once at start with `handleVersionChange`'s result. A fresh install
 * (no previous version) starts at the running version, so it never sees notes.
 * An upgrade from before What's new existed starts at the version it came from.
 */
export function seedSeenVersion(previous: string | null, current: string): void {
  if (read() === null) write(previous ?? current);
}

/** The notes this browser has not dismissed yet, newest first; empty when storage is unreadable. */
export function pendingNotes(notes: ReleaseNotes, current: string): ReleaseEntry[] {
  const seen = read();
  return seen === null ? [] : notesSince(notes, seen, current);
}

export function markWhatsNewSeen(current: string): void {
  write(current);
}
