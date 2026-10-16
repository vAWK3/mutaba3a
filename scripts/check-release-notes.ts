/**
 * `npm run release:notes -- <version>` (MUT-24): `make release-web` runs it
 * right after the bump and stops when release-notes.json has no well-formed
 * entry for the version. The same notes become the app's "What's new" and the
 * web tag's message, so this is the one place they are written.
 */
import { readFileSync } from 'node:fs';
import { releaseNotesProblems, type ReleaseNotes } from '../src/lib/whatsNew/releaseNotes';

const version = process.argv[2];
if (!version) {
  console.error('usage: npm run release:notes -- <version>');
  process.exit(2);
}

const notes = JSON.parse(readFileSync('release-notes.json', 'utf8')) as ReleaseNotes;
const problems = releaseNotesProblems(notes, version);

if (problems.length) {
  console.error(problems.map((p) => `release-notes.json: ${p}`).join('\n'));
  process.exit(1);
}
console.log(`✓ release notes for v${version}: ${notes[version].en.length} line(s) in en and ar`);
