import notes from '../../../release-notes.json';
import type { ReleaseNotes } from './releaseNotes';

/** The shipped release notes (release-notes.json at the repo root). */
export const RELEASE_NOTES: ReleaseNotes = notes;

export { compareVersions, notesSince, latestNotesUpTo, releaseNotesProblems } from './releaseNotes';
export type { ReleaseNotes, ReleaseEntry, VersionNotes } from './releaseNotes';
export { WHATS_NEW_SEEN_KEY, seedSeenVersion, pendingNotes, markWhatsNewSeen } from './whatsNewState';
export { useWhatsNewStore } from './whatsNewStore';
