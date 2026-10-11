/**
 * `npm run test:bundles` (MUT-43, hosted-portal.md §8): after building all
 * three targets, prove the separation the brief promises instead of asserting
 * it. The web and desktop bundles carry no portal endpoint, cookie or header and
 * reach no new origin; the hosted bundle has no IndexedDB, Dexie or service
 * worker, no self-service account door in either language, and no new origin.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { HOSTED_RULES, LOCAL_RULES, extractOrigins, findForbidden, newOrigins, type Rule } from './bundle-rules';

const TEXT_FILE = /\.(js|mjs|html|css|json|webmanifest)$/;
const allowlist = JSON.parse(readFileSync('scripts/bundle-origins.json', 'utf8')) as { local: string[]; hosted: string[] };

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : TEXT_FILE.test(path) ? [path] : [];
  });
}

function check(dir: string, rules: Rule[], origins: string[]): string[] {
  if (!existsSync(dir)) return [`${dir} is missing: build it first`];
  const problems: string[] = [];
  const found = new Set<string>();
  for (const file of files(dir)) {
    const text = readFileSync(file, 'utf8');
    for (const finding of findForbidden(text, rules)) problems.push(`${file}: ${finding.rule} ("${finding.match}")`);
    for (const origin of extractOrigins(text)) found.add(origin);
  }
  for (const origin of newOrigins(found, origins)) problems.push(`${dir}: new origin ${origin} (review, then add to scripts/bundle-origins.json)`);
  return problems;
}

const problems = [
  ...check('dist-web', LOCAL_RULES, allowlist.local),
  ...check('dist-desktop', LOCAL_RULES, allowlist.local),
  ...check('dist-hosted', HOSTED_RULES, allowlist.hosted),
];

if (problems.length > 0) {
  console.error(`Bundle check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('Bundle check passed: dist-web and dist-desktop carry no portal code; dist-hosted carries no local storage and no self-service account door.');
