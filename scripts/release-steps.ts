/**
 * Post-Release Steps
 *
 * Maintain this file alongside each release. Add steps under "unreleased"
 * during development. When you run `npm run release`, release.ts shows these
 * steps after the GitHub release is published so nothing gets forgotten.
 *
 * After releasing and completing steps, move the "unreleased" entry to a
 * version key (e.g. "0.0.64") for audit trail, or just clear it.
 *
 * Usage in release.ts:
 *   import { getStepsForVersion } from './release-steps';
 *   const steps = getStepsForVersion('0.0.64'); // falls back to "unreleased"
 */

export type Platform = 'mac' | 'windows';

export interface ReleaseStep {
  /** Human-readable title */
  title: string;
  /** Command to run. Only executed if `runnable` is also set — see below. */
  command?: string;
  /** Free-text note if no single command covers it */
  note?: string;
  /** If true, the checklist highlights this as required */
  required: boolean;
  /** Which platform this step applies to (omit = both) */
  platform?: Platform;
  /**
   * Opt in to `npm run release` OFFERING to run `command` for you, one prompt
   * per step, default no.
   *
   * Deliberately opt-in rather than default. Most of these steps are either
   * interactive, need human judgement (does the update actually apply?), or
   * exist so a human reads the output. Only set this where an unattended run
   * is safe and the exit code means something.
   */
  runnable?: boolean;
  /**
   * Marks a step whose POSITION matters, not just its content — checking it
   * too early reads as a failure that isn't one.
   *
   * The case that earned this flag: build-windows.yml only starts once the
   * GitHub release is published (it listens for `release: types: [published]`),
   * takes 5-10 minutes, and is what adds the windows-x86_64 entry to
   * latest.json. Checking latest.json before it finishes shows a mac-only
   * manifest that looks broken but is actually just incomplete.
   */
  orderCritical?: boolean;
}

export interface VersionSteps {
  /** Short summary of what this release includes */
  summary: string;
  /** Ordered list of post-release steps */
  steps: ReleaseStep[];
}

/**
 * Post-release steps keyed by version.
 *
 * Special keys:
 *   "unreleased" — steps for the next release (shown when no version match)
 *
 * Version keys (e.g. "0.0.64") — steps for a specific past release.
 * Remove old version entries once they've been reviewed.
 */
export const RELEASE_STEPS: Record<string, VersionSteps> = {
  unreleased: {
    summary:
      'Standing checklist — nothing release-specific recorded yet. Fill in a summary of ' +
      'what this release ships, then move this entry to a version key after releasing.',
    steps: [
      {
        title: 'Wait for the Windows build to finish, then check it succeeded',
        command: 'gh run list --workflow=build-windows.yml --limit 1',
        note: [
          'build-windows.yml triggers on `release: published` and takes ~5-10 minutes. It also',
          'runs updater-config.test.ts (MUT-49, ADR-031) before building — that test asserts the',
          'compiled-in minisign public key in src-tauri/tauri.conf.json matches what deploy.sh',
          'signs with, so a mismatched key fails CI loudly instead of shipping a build every',
          'existing install silently rejects.',
        ].join('\n'),
        required: true,
        platform: 'windows',
        orderCritical: true,
        runnable: true,
      },
      {
        title: 'Confirm latest.json advertises both platforms',
        command:
          'gh release download "$(git describe --tags --abbrev=0)" --pattern latest.json -O - | jq .platforms',
        note: [
          'Expect both darwin-aarch64 and windows-x86_64 keys, each with a non-empty signature',
          'and a url pointing at this release\'s tag. deploy.sh publishes a mac-only manifest;',
          'build-windows.yml patches in the windows-x86_64 entry afterward — run this only after',
          'the Windows build step above is green.',
        ].join('\n'),
        required: true,
        orderCritical: true,
        runnable: true,
      },
      {
        title: 'Smoke-test the auto-updater from the previously installed build',
        note: [
          'Open a machine (or VM) still running the prior version and let it check for updates,',
          'or trigger it manually. Confirm it finds this release and actually applies it — a',
          'green CI run proves the artifacts exist and are signed, not that an in-place update',
          'from an older binary succeeds end to end.',
        ].join('\n'),
        required: true,
      },
      {
        title: 'If a platform entry in latest.json is wrong, patch it rather than re-running deploy.sh',
        command: 'scripts/patch-latest-json.sh',
        note: [
          'This is the tool v0.0.57 needed when latest.json advertised darwin-universal and',
          'darwin-x86_64 entries pointing at the arm64-only tarball, breaking update checks on',
          'Intel Macs and Windows. It keeps only platforms with a real, correctly-signed artifact.',
          'Only run this if something above looks wrong — not a routine step.',
        ].join('\n'),
        required: false,
      },
      {
        title: 'Mirror TAURI_SIGNING_* secrets to GitHub Actions — only if the key was rotated',
        note: [
          'release.env.example has the exact `gh secret set` one-liners. The Windows workflow',
          'signs its own updater bundle with these repo secrets, independent of local release.env.',
          'Rotating the key invalidates auto-update for every already-installed copy — this step',
          'is a no-op on a normal release and only matters right after a rotation.',
        ].join('\n'),
        required: false,
      },
      {
        title: 'Check TODOS.md and Jira epic MUT-48 for anything release-blocking',
        note:
          'MUT-50..54 track open desktop-updater follow-ups. Skim before publishing in case one ' +
          'of them turned out to be release-blocking rather than a later cleanup.',
        required: false,
      },
      {
        title: 'Confirm the download page picked up the new version',
        note: [
          'deploy.sh rewrites src/content/download-config.ts and pushes main. If the marketing',
          'site deploys separately (see netlify.toml), check that deploy went out and the site',
          'now links to this version\'s DMG/MSI rather than a stale fallbackVersion.',
        ].join('\n'),
        required: true,
      },
    ],
  },
};

export function getStepsForVersion(version: string): VersionSteps | null {
  return RELEASE_STEPS[version] ?? RELEASE_STEPS['unreleased'] ?? null;
}
