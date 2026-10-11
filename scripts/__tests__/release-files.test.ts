import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RELEASE_COMMIT_FILES, partitionDirtyFiles } from '../release-files';

/**
 * Guards what lands in the release commit, and therefore in the tag the
 * Windows CI build checks out.
 *
 * v0.0.65's Windows build failed because its tag held a Cargo.toml requiring
 * tauri 2.12.1 beside a Cargo.lock still pinning 2.11.2: deploy.sh staged the
 * manifest but never the lockfile the mac build had just rewritten, and the
 * Tauri CLI's npm-vs-crate version check read the stale lock. These tests pin
 * "every manifest travels with its lockfile", and keep release.ts's account of
 * the release commit identical to what deploy.sh actually stages.
 */

const DEPLOY_SH = resolve(process.cwd(), 'deploy.sh');

/** The paths `tag_and_push` in deploy.sh passes to `git add`, $VARS resolved. */
function stagedByDeploySh(): string[] {
  const script = readFileSync(DEPLOY_SH, 'utf-8');
  const tagAndPush = script.slice(script.indexOf('tag_and_push() {'));
  const addLine = tagAndPush.split('\n').find((line) => /^\s*git add /.test(line));
  if (!addLine) throw new Error('deploy.sh: no `git add` line in tag_and_push');

  return [...addLine.matchAll(/"\$([A-Z_]+)"/g)].map(([, name]) => {
    const assignment = script.match(new RegExp(`^${name}="([^"]+)"$`, 'm'));
    if (!assignment) throw new Error(`deploy.sh stages $${name} but never defines it`);
    return assignment[1];
  });
}

describe('RELEASE_COMMIT_FILES', () => {
  it('stages each manifest together with its lockfile', () => {
    expect(RELEASE_COMMIT_FILES).toEqual(
      expect.arrayContaining([
        'package.json',
        'package-lock.json',
        'src-tauri/Cargo.toml',
        'src-tauri/Cargo.lock',
      ]),
    );
  });

  it('is exactly what deploy.sh tag_and_push stages', () => {
    expect([...stagedByDeploySh()].sort()).toEqual([...RELEASE_COMMIT_FILES].sort());
  });
});

describe('partitionDirtyFiles', () => {
  it('separates files that ride along in the release commit from files left out', () => {
    const porcelain = [
      ' M src-tauri/Cargo.toml',
      ' M src-tauri/Cargo.lock',
      ' M src/App.tsx',
      '?? notes.md',
      '',
    ].join('\n');

    expect(partitionDirtyFiles(porcelain)).toEqual({
      inReleaseCommit: ['src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'],
      leftOut: ['src/App.tsx', 'notes.md'],
    });
  });

  it('reads staged, unstaged and both-column changes alike', () => {
    const porcelain = 'M  package.json\nMM package-lock.json\nA  src/new.ts\n';

    expect(partitionDirtyFiles(porcelain)).toEqual({
      inReleaseCommit: ['package.json', 'package-lock.json'],
      leftOut: ['src/new.ts'],
    });
  });

  it('takes the destination path of a rename', () => {
    expect(partitionDirtyFiles('R  src/old.ts -> src/new.ts\n')).toEqual({
      inReleaseCommit: [],
      leftOut: ['src/new.ts'],
    });
  });

  it('keeps the first path intact when the output starts with a space status', () => {
    // `git status --porcelain` starts " M path" for an unstaged change; trimming
    // the whole output first would shift the first line and eat a character.
    expect(partitionDirtyFiles(' M src-tauri/Cargo.lock')).toEqual({
      inReleaseCommit: ['src-tauri/Cargo.lock'],
      leftOut: [],
    });
  });

  it('reports nothing for a clean tree', () => {
    expect(partitionDirtyFiles('')).toEqual({ inReleaseCommit: [], leftOut: [] });
  });
});
