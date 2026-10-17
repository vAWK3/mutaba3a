/**
 * `npm run release:notes -- <version>` (MUT-24): `make release-web` runs it
 * right after the bump. If release-notes.json has no well-formed entry for
 * the version yet, and a terminal is attached, it asks for one English line
 * and one Arabic line summarizing the whole release and writes them in —
 * rather than just failing. The same notes become the app's "What's new"
 * and the web tag's message, so this is the one place they are written.
 */
import { createReadStream, openSync, readFileSync, writeFileSync } from 'node:fs';
import * as readline from 'node:readline/promises';
import {
  releaseNotesProblems,
  type ReleaseNotes,
  type VersionNotes,
} from '../src/lib/whatsNew/releaseNotes';

const RELEASE_NOTES_PATH = 'release-notes.json';

const version = process.argv[2];
if (!version) {
  console.error('usage: npm run release:notes -- <version>');
  process.exit(2);
}

const notes = JSON.parse(readFileSync(RELEASE_NOTES_PATH, 'utf8')) as ReleaseNotes;

// Problems in *existing* entries are data corruption, not a missing version —
// never guess a fix for those, just report and stop.
const existingProblems = releaseNotesProblems(notes);
if (existingProblems.length) {
  console.error(existingProblems.map((p) => `${RELEASE_NOTES_PATH}: ${p}`).join('\n'));
  process.exit(1);
}

let entry = notes[version];
if (!entry) {
  const written = await promptForEntry(version);
  if (!written) process.exit(1);
  entry = written;
  // Newest first, matching the existing file's convention.
  const reordered: ReleaseNotes = { [version]: entry, ...notes };
  writeFileSync(RELEASE_NOTES_PATH, `${JSON.stringify(reordered, null, 2)}\n`);
  console.log(`\n✓ wrote release notes for v${version} to ${RELEASE_NOTES_PATH}`);
}

console.log(`✓ release notes for v${version}: ${entry.en.length} line(s) in en and ar`);

/** Null when there is no terminal to ask on (CI, piped input) — caller should fail as before. */
async function promptForEntry(forVersion: string): Promise<VersionNotes | null> {
  // Prefer the controlling terminal so this still works when stdin is a pipe
  // (`make` recipes, `npm run`). /dev/tty can exist and still refuse to open
  // (ENXIO, no controlling terminal), so probe by opening it rather than by
  // testing the path — same trick as scripts/bump-version.sh.
  let ttyFd: number | null = null;
  try {
    ttyFd = openSync('/dev/tty', 'r');
  } catch {
    ttyFd = null;
  }

  if (ttyFd === null && !process.stdin.isTTY) {
    console.error(
      `${RELEASE_NOTES_PATH}: no entry for ${forVersion}, and no terminal to ask on.\n` +
        `Add it by hand (en + ar, same line count) and re-run.`,
    );
    return null;
  }

  const input = ttyFd !== null ? createReadStream('', { fd: ttyFd }) : process.stdin;
  const rl = readline.createInterface({ input, output: process.stderr });

  console.error(`\nNo release notes for v${forVersion} yet — let's write them now.`);
  console.error('One note summarizing all the changes in this release, in plain language for users.\n');

  const line = (await rl.question('  en: ')).trim();
  const translated = line ? (await rl.question('  ar: ')).trim() : '';
  rl.close();
  if (input !== process.stdin) input.destroy();

  if (!line || !translated) {
    console.error(`${RELEASE_NOTES_PATH}: no note entered, nothing written.`);
    return null;
  }

  const en = [line];
  const ar = [translated];

  const entry: VersionNotes = { en, ar };
  const problems = releaseNotesProblems({ [forVersion]: entry });
  if (problems.length) {
    console.error(problems.map((p) => `${RELEASE_NOTES_PATH}: ${p}`).join('\n'));
    return null;
  }
  return entry;
}
