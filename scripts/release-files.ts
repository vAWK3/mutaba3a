/**
 * What deploy.sh's release commit contains, and how the release manager reads
 * the working tree against it. Kept out of release.ts, which runs on import,
 * so it can be tested (scripts/__tests__/release-files.test.ts).
 */

/**
 * Every file `tag_and_push` in deploy.sh passes to `git add`. The release
 * commit, and so the tag, holds these and nothing else.
 *
 * Each manifest travels with its lockfile. The mac build rewrites
 * src-tauri/Cargo.lock whenever Cargo.toml's version or dependencies change,
 * and the Windows CI build checks out the tag and reads that lockfile.
 * v0.0.65 tagged a Cargo.toml requiring tauri 2.12.1 beside a Cargo.lock still
 * pinning 2.11.2, and the Windows build failed the Tauri CLI's npm-vs-crate
 * version check. The test keeps this list identical to deploy.sh's.
 */
export const RELEASE_COMMIT_FILES: readonly string[] = [
  'package.json',
  'package-lock.json',
  'src-tauri/tauri.conf.json',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
];

export interface DirtyFiles {
  /** Already modified before the version bump; they ride along in the release commit. */
  inReleaseCommit: string[];
  /** Modified but never staged by deploy.sh; they stay uncommitted after the release. */
  leftOut: string[];
}

const RENAME_ARROW = ' -> ';

/** "XY path", or "XY from -> to" for a rename or copy, where the path is the destination. */
function pathOfStatusLine(line: string): string {
  const path = line.slice(3).trim();
  const arrow = path.indexOf(RENAME_ARROW);
  return arrow === -1 ? path : path.slice(arrow + RENAME_ARROW.length);
}

/** Splits untrimmed `git status --porcelain` output by whether deploy.sh stages each path. */
export function partitionDirtyFiles(porcelain: string): DirtyFiles {
  const releaseFiles = new Set(RELEASE_COMMIT_FILES);
  const paths = porcelain.split('\n').map(pathOfStatusLine).filter(Boolean);
  return {
    inReleaseCommit: paths.filter((path) => releaseFiles.has(path)),
    leftOut: paths.filter((path) => !releaseFiles.has(path)),
  };
}
