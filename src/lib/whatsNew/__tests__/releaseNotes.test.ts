import { describe, it, expect } from 'vitest';
import { compareVersions, notesSince, latestNotesUpTo, releaseNotesProblems, type ReleaseNotes } from '../releaseNotes';
import shipped from '../../../../release-notes.json';

const NOTES: ReleaseNotes = {
  '0.1.5': { en: ['Five'], ar: ['خمسة'] },
  '0.1.7': { en: ['Seven a', 'Seven b'], ar: ['سبعة أ', 'سبعة ب'] },
  '0.1.10': { en: ['Ten'], ar: ['عشرة'] },
};

describe('compareVersions', () => {
  it('orders by major, minor, then patch, numerically', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('0.2.0', '0.1.99')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1.6', '0.1.6')).toBe(0);
    expect(compareVersions('0.1.6', '0.1.7')).toBeLessThan(0);
  });

  it('treats missing or non-numeric parts as 0', () => {
    expect(compareVersions('1', '1.0.0')).toBe(0);
    expect(compareVersions('1.x.2', '1.0.2')).toBe(0);
  });
});

describe('notesSince', () => {
  it('returns every version after `seen` up to and including `current`, newest first', () => {
    expect(notesSince(NOTES, '0.1.4', '0.1.10').map((n) => n.version)).toEqual(['0.1.10', '0.1.7', '0.1.5']);
  });

  it('excludes the seen version and anything newer than the running one', () => {
    expect(notesSince(NOTES, '0.1.5', '0.1.7').map((n) => n.version)).toEqual(['0.1.7']);
  });

  it('is empty when the seen version is the running one', () => {
    expect(notesSince(NOTES, '0.1.7', '0.1.7')).toEqual([]);
  });

  it('is empty when nothing user-facing shipped in the range', () => {
    expect(notesSince(NOTES, '0.1.7', '0.1.9')).toEqual([]);
  });

  it('carries both languages for each version', () => {
    expect(notesSince(NOTES, '0.1.6', '0.1.7')).toEqual([
      { version: '0.1.7', en: ['Seven a', 'Seven b'], ar: ['سبعة أ', 'سبعة ب'] },
    ]);
  });
});

describe('latestNotesUpTo', () => {
  it('is the newest entry at or below the running version', () => {
    expect(latestNotesUpTo(NOTES, '0.1.9')?.version).toBe('0.1.7');
    expect(latestNotesUpTo(NOTES, '0.1.10')?.version).toBe('0.1.10');
  });

  it('is null when no entry is that old', () => {
    expect(latestNotesUpTo(NOTES, '0.1.0')).toBeNull();
  });
});

describe('releaseNotesProblems', () => {
  it('accepts notes with x.y.z versions and the same number of non-empty lines per language', () => {
    expect(releaseNotesProblems(NOTES)).toEqual([]);
  });

  it('names each problem', () => {
    expect(
      releaseNotesProblems({
        'v1.0': { en: ['a'], ar: ['أ'] },
        '0.1.1': { en: ['a', 'b'], ar: ['أ'] },
        '0.1.2': { en: [], ar: [] },
        '0.1.3': { en: ['a'], ar: ['  '] },
      } as ReleaseNotes),
    ).toEqual([
      'v1.0: version must be x.y.z',
      '0.1.1: en has 2 lines, ar has 1',
      '0.1.2: no lines',
      '0.1.3: ar line 1 is empty',
    ]);
  });

  it('requires an entry for a version when asked (the web release gate)', () => {
    expect(releaseNotesProblems(NOTES, '0.1.8')).toEqual(['0.1.8: no release notes; add them to release-notes.json']);
    expect(releaseNotesProblems(NOTES, '0.1.7')).toEqual([]);
  });
});

describe('release-notes.json (MUT-24)', () => {
  it('is well formed', () => {
    expect(releaseNotesProblems(shipped as ReleaseNotes)).toEqual([]);
  });
});
