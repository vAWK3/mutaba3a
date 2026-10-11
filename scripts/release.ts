#!/usr/bin/env tsx
/**
 * Interactive Release Manager
 *
 * Thin TypeScript front-end over deploy.sh. It owns the parts deploy.sh's
 * bash menu does badly or not at all:
 *   - a real version-bump choice (deploy.sh always increments patch)
 *   - a working-tree check that says which files will actually land in the
 *     release commit, instead of implying everything dirty will, and flags
 *     changes already sitting in those files before the bump
 *   - a maintained post-release checklist (release-steps.ts)
 *
 * It does NOT reimplement signing, notarization, tagging, or publishing —
 * that logic is battle-tested in deploy.sh's build_and_release_mac and is
 * reused by sourcing the script and calling the function directly, with the
 * version already decided and written to disk.
 *
 * Usage:
 *   npm run release
 */

import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as readline from 'readline';
import { RELEASE_COMMIT_FILES, partitionDirtyFiles, type DirtyFiles } from './release-files';
import { getStepsForVersion, type ReleaseStep } from './release-steps';

// --- Console Colors ---

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function colorize(text: string, color: keyof typeof colors): string {
  return `${colors[color]}${text}${colors.reset}`;
}

// --- Prompts ---

function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function selectOption<T>(
  question: string,
  options: { key: string; label: string; value: T }[],
): Promise<T> {
  console.log(colorize(`\n${question}`, 'cyan'));
  options.forEach((opt) => console.log(`  ${colorize(opt.key, 'yellow')} - ${opt.label}`));

  while (true) {
    const answer = await promptUser(colorize('Your choice: ', 'bright'));
    const selected = options.find((opt) => opt.key === answer);
    if (selected) return selected.value;
    console.log(colorize('Invalid option. Please try again.', 'red'));
  }
}

async function confirmAction(question: string, defaultYes = false): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const answer = await promptUser(colorize(`${question} (${hint}): `, 'yellow'));
  if (answer === '') return defaultYes;
  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}

async function continueOrExit(): Promise<void> {
  if (await confirmAction('Continue anyway?')) return;
  console.log(colorize('Cancelled.', 'yellow'));
  process.exit(0);
}

function runCommandStreaming(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

// --- Paths ---

const ROOT = process.cwd();
const PACKAGE_JSON = join(ROOT, 'package.json');
const TAURI_CONF = join(ROOT, 'src-tauri', 'tauri.conf.json');
const CARGO_TOML = join(ROOT, 'src-tauri', 'Cargo.toml');
const DEPLOY_SH = join(ROOT, 'deploy.sh');

// --- Version ---

type VersionBump = 'patch' | 'minor' | 'major' | 'custom';

function getVersion(): string {
  return JSON.parse(readFileSync(PACKAGE_JSON, 'utf-8')).version;
}

function bumpVersion(current: string, bump: VersionBump, custom?: string): string {
  if (bump === 'custom') {
    if (!custom || !/^\d+\.\d+\.\d+$/.test(custom)) {
      throw new Error(`Invalid version format: "${custom}". Use X.Y.Z.`);
    }
    return custom;
  }
  const [major, minor, patch] = current.split('.').map(Number);
  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
  }
}

function writeVersionFiles(newVersion: string): void {
  // package.json plus package-lock.json's own version (top level and root
  // entry), leaving every dependency's "version" alone.
  execSync(`npm version ${newVersion} --no-git-tag-version --allow-same-version --ignore-scripts`, {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  const tauriConf = JSON.parse(readFileSync(TAURI_CONF, 'utf-8'));
  tauriConf.version = newVersion;
  writeFileSync(TAURI_CONF, JSON.stringify(tauriConf, null, 2) + '\n');

  const cargoToml = readFileSync(CARGO_TOML, 'utf-8');
  const updatedCargoToml = cargoToml.replace(
    /^version = "[^"]*"/m,
    `version = "${newVersion}"`,
  );
  if (updatedCargoToml === cargoToml) {
    throw new Error(`Could not find a "version = ..." line to update in ${CARGO_TOML}`);
  }
  writeFileSync(CARGO_TOML, updatedCargoToml);

  console.log(
    colorize(
      `✓ Updated version to ${newVersion} in package.json, package-lock.json, tauri.conf.json, Cargo.toml`,
      'green',
    ),
  );
}

// --- Working tree check ---

/**
 * deploy.sh's release commit only ever stages RELEASE_COMMIT_FILES
 * (`tag_and_push`'s `git add`). Any other uncommitted change is silently left
 * out of the release commit and stays dirty on disk — not lost, but easy to
 * mistake for "will be committed" if you only read deploy.sh's own
 * working-tree warning. The opposite trap is a change already sitting in one
 * of those files: it rides into the release silently. That is how v0.0.65's
 * tauri bump in Cargo.toml shipped in its release commit.
 */
function checkWorkingTree(): DirtyFiles {
  return partitionDirtyFiles(execSync('git status --porcelain', { encoding: 'utf-8' }));
}

function printFileList(files: string[]): void {
  files.forEach((f) => console.log(colorize(`    ${f}`, 'dim')));
}

// --- Post-release checklist ---

function displayPostReleaseChecklist(version: string): ReleaseStep[] {
  const versionSteps = getStepsForVersion(version);
  if (!versionSteps || versionSteps.steps.length === 0) return [];

  console.log(colorize('\n═══════════════════════════════════════', 'magenta'));
  console.log(colorize('  Post-Release Checklist', 'magenta'));
  console.log(colorize('═══════════════════════════════════════\n', 'magenta'));

  if (versionSteps.summary) {
    console.log(colorize(`  ${versionSteps.summary}\n`, 'dim'));
  }

  const orderCritical = versionSteps.steps.filter((s) => s.orderCritical);
  if (orderCritical.length > 0) {
    console.log(colorize('  ⚠  ORDER-SENSITIVE — CHECKING THESE TOO EARLY LOOKS LIKE A FAILURE', 'red'));
    console.log(colorize('     Read the note on each before running it.\n', 'red'));
  }

  versionSteps.steps.forEach((step, i) => {
    const marker = step.required ? colorize('[REQUIRED]', 'red') : colorize('[optional]', 'dim');
    const order = step.orderCritical ? colorize(' [ORDER MATTERS]', 'red') : '';
    const platform = step.platform ? colorize(` (${step.platform})`, 'cyan') : '';

    console.log(`  ${i + 1}. ${marker}${order}${platform} ${step.title}`);
    if (step.command) console.log(colorize(`     $ ${step.command}`, 'cyan'));
    if (step.note) console.log(colorize(`     ${step.note}`, 'dim'));
    console.log('');
  });

  const requiredCount = versionSteps.steps.filter((s) => s.required).length;
  if (requiredCount > 0) {
    console.log(colorize(`  Complete the ${requiredCount} required step(s) above.\n`, 'yellow'));
  }
  console.log(colorize('═══════════════════════════════════════', 'magenta'));

  return versionSteps.steps;
}

async function offerToRunSteps(steps: ReleaseStep[]): Promise<void> {
  const runnable = steps.filter((s) => s.runnable && s.command);
  if (runnable.length === 0) return;

  console.log(
    colorize(
      `\n  ${runnable.length} step(s) above are read-only checks this script can run for you.` +
      '\n  Each is a separate prompt — saying no just leaves it on your list.\n',
      'dim',
    ),
  );

  const wanted = await confirmAction('Step through them now?');
  if (!wanted) {
    console.log(colorize('\n  Skipped — the checklist above is your record.\n', 'dim'));
    return;
  }

  for (const step of runnable) {
    console.log(colorize(`\n${'─'.repeat(50)}`, 'dim'));
    console.log(step.title);
    console.log(colorize(`  $ ${step.command}`, 'cyan'));

    const run = await confirmAction('  Run it?');
    if (!run) {
      console.log(colorize('  Skipped.', 'dim'));
      continue;
    }

    console.log('');
    const ok = await runCommandStreaming('sh', ['-c', step.command!]);
    console.log(ok ? colorize('✓ Done.', 'green') : colorize('✗ Command failed — check the output above.', 'red'));
  }
}

// --- Main ---

async function main() {
  console.log(colorize('\n═══════════════════════════════════════', 'blue'));
  console.log(colorize('       Mutaba3a Release Manager', 'blue'));
  console.log(colorize('═══════════════════════════════════════\n', 'blue'));

  if (!existsSync(DEPLOY_SH)) {
    console.log(colorize(`Error: ${DEPLOY_SH} not found.`, 'red'));
    process.exit(1);
  }

  if (!existsSync(join(ROOT, 'release.env'))) {
    console.log(
      colorize(
        '⚠ No release.env found. The mac build will fail at notarization.\n' +
        '  Fix: cp release.env.example release.env, then fill in Apple + signing values.\n',
        'yellow',
      ),
    );
    await continueOrExit();
  }

  const { inReleaseCommit, leftOut } = checkWorkingTree();
  if (inReleaseCommit.length > 0) {
    console.log(colorize('\n⚠ Already-modified files that WILL be in the release commit:', 'yellow'));
    printFileList(inReleaseCommit);
    console.log(
      colorize(
        '  Whatever is in them now ships with the version bump — a dependency change\n' +
        '  in Cargo.toml or package.json included. Review before continuing:\n' +
        `    git diff -- ${inReleaseCommit.join(' ')}\n`,
        'dim',
      ),
    );
    await continueOrExit();
  }

  if (leftOut.length > 0) {
    console.log(colorize('\n⚠ Uncommitted changes outside the release commit:', 'yellow'));
    printFileList(leftOut);
    console.log(
      colorize(
        '  These will NOT be included in the release commit — deploy.sh only stages\n' +
        `  ${RELEASE_COMMIT_FILES.join(', ')}.\n` +
        '  They will stay uncommitted on disk after the release is pushed.\n',
        'dim',
      ),
    );
    await continueOrExit();
  }

  const currentVersion = getVersion();
  console.log(colorize(`\nCurrent version: ${currentVersion}`, 'bright'));

  const bump = await selectOption<VersionBump>('Version bump:', [
    { key: '1', label: 'patch', value: 'patch' },
    { key: '2', label: 'minor', value: 'minor' },
    { key: '3', label: 'major', value: 'major' },
    { key: '4', label: 'custom', value: 'custom' },
  ]);

  let customVersion: string | undefined;
  if (bump === 'custom') {
    customVersion = await promptUser(colorize('Enter version (X.Y.Z): ', 'cyan'));
  }

  let newVersion: string;
  try {
    newVersion = bumpVersion(currentVersion, bump, customVersion);
  } catch (err) {
    console.log(colorize(`Error: ${err instanceof Error ? err.message : String(err)}`, 'red'));
    process.exit(1);
  }

  console.log(colorize(`\n${currentVersion} → ${newVersion}`, 'bright'));
  const confirmed = await confirmAction(`Build and release v${newVersion}? This takes 5-15 minutes.`);
  if (!confirmed) {
    console.log(colorize('Cancelled. Nothing was changed.', 'yellow'));
    process.exit(0);
  }

  writeVersionFiles(newVersion);

  console.log(colorize('\nHanding off to deploy.sh (build, sign, notarize, tag, publish)...\n', 'blue'));

  // Source deploy.sh and call build_and_release_mac directly, skipping its
  // interactive menu (guarded off when the script is sourced rather than
  // executed — see the bottom of deploy.sh).
  const ok = await runCommandStreaming('bash', [
    '-c',
    `source "${DEPLOY_SH}" && build_and_release_mac "${newVersion}"`,
  ]);

  if (!ok) {
    console.log(colorize('\n✗ Release failed — see output above.', 'red'));
    process.exit(1);
  }

  const steps = displayPostReleaseChecklist(newVersion);
  await offerToRunSteps(steps);

  console.log(colorize(`\n✓ Release v${newVersion} complete.\n`, 'green'));
}

main().catch((err: unknown) => {
  console.error(colorize(`\nUnexpected error: ${err instanceof Error ? err.message : String(err)}`, 'red'));
  process.exit(1);
});
