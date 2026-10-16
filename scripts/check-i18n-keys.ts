/**
 * `npm run i18n:check` (MUT-24): fails on a translation key the code asks for
 * that the dictionary lacks, or a key nothing in the code can reach. The same
 * check runs in `test:run` (scripts/__tests__/i18n-keys.test.ts); this is the
 * readable report. Rules: scripts/i18n-keys.ts.
 */
import { collectSources, findKeyProblems, formatProblems, loadDictionary, scanSources } from './i18n-keys';

const root = process.cwd();
const lines = formatProblems(findKeyProblems(loadDictionary(root), scanSources(collectSources(root))));

if (lines.length) {
  console.error(lines.join('\n'));
  console.error(`\n${lines.length} translation key problem(s). Add the missing keys to both languages; delete orphans from both.`);
  process.exit(1);
}
console.log('Every translation key the app uses exists, and every key is used.');
