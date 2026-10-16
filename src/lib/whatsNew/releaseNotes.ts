/**
 * User-facing release notes (MUT-24, ADR-088). `release-notes.json` at the repo
 * root is the one place they are written: the app shows them in "What's new",
 * `make release-web` refuses a version without them, and the web tag carries
 * the English lines. Each version has the same lines in English and Arabic.
 */

export interface VersionNotes {
  en: string[];
  ar: string[];
}

export type ReleaseNotes = Record<string, VersionNotes>;

export interface ReleaseEntry extends VersionNotes {
  version: string;
}

const VERSION_SHAPE = /^\d+\.\d+\.\d+$/;

/** > 0 when `a` is newer than `b`, 0 when equal, < 0 when older. Missing or non-numeric parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split('.').map((p) => parseInt(p, 10) || 0);
  const [aMajor = 0, aMinor = 0, aPatch = 0] = parts(a);
  const [bMajor = 0, bMinor = 0, bPatch = 0] = parts(b);
  return aMajor - bMajor || aMinor - bMinor || aPatch - bPatch;
}

function entries(notes: ReleaseNotes): ReleaseEntry[] {
  return Object.entries(notes)
    .map(([version, lines]) => ({ version, ...lines }))
    .sort((a, b) => compareVersions(b.version, a.version));
}

/** Every version newer than `seen` and no newer than `current`, newest first. */
export function notesSince(notes: ReleaseNotes, seen: string, current: string): ReleaseEntry[] {
  return entries(notes).filter(
    ({ version }) => compareVersions(version, seen) > 0 && compareVersions(version, current) <= 0,
  );
}

/** The newest entry the running version includes, for Settings › About; null when there is none. */
export function latestNotesUpTo(notes: ReleaseNotes, current: string): ReleaseEntry | null {
  return entries(notes).find(({ version }) => compareVersions(version, current) <= 0) ?? null;
}

function entryProblems(version: string, { en, ar }: VersionNotes): string[] {
  if (!VERSION_SHAPE.test(version)) return [`${version}: version must be x.y.z`];
  if (en.length !== ar.length) return [`${version}: en has ${en.length} lines, ar has ${ar.length}`];
  if (en.length === 0) return [`${version}: no lines`];
  const blank = (lang: string, lines: string[]) =>
    lines.flatMap((line, i) => (line.trim() ? [] : [`${version}: ${lang} line ${i + 1} is empty`]));
  return [...blank('en', en), ...blank('ar', ar)];
}

/** Every problem with the notes; with `required`, also a missing entry for that version. */
export function releaseNotesProblems(notes: ReleaseNotes, required?: string): string[] {
  const problems = Object.entries(notes).flatMap(([version, lines]) => entryProblems(version, lines));
  if (required && !(required in notes)) problems.push(`${required}: no release notes; add them to release-notes.json`);
  return problems;
}
