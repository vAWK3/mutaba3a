/**
 * `npm run test:bundles` (MUT-43, hosted-portal.md §8): after building all
 * three targets, prove the separation the brief promises instead of asserting
 * it. The web and desktop bundles carry no portal endpoint, cookie or header and
 * reach no new origin; the hosted bundle has no IndexedDB, Dexie or service
 * worker, no self-service account door in either language, and no new origin.
 *
 * Brand v2 (MUT-102): every dist ships the delivered Thmanyah files
 * byte-identical, bundles no retired face, preloads no font (ADR-058), and
 * every CSS url() resolves to a file inside that dist (offline proof for
 * desktop; for web, no font silently answered by the index.html fallback).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { HOSTED_RULES, LOCAL_RULES, extractOrigins, findForbidden, fontProblems, newOrigins, unresolvedUrls, type Rule } from './bundle-rules';

const TEXT_FILE = /\.(js|mjs|html|css|json|webmanifest)$/;
const FONT_FILE = /\.(otf|ttf|woff2?)$/;
const THMANYAH_PINS = 'src/assets/fonts/thmanyah.sha256.json';
const allowlist = JSON.parse(readFileSync('scripts/bundle-origins.json', 'utf8')) as { local: string[]; hosted: string[] };

function allFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? allFiles(path) : [path];
  });
}

function files(dir: string): string[] {
  return allFiles(dir).filter((path) => TEXT_FILE.test(path));
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** The delivered bytes, pinned (brand.test.ts checks src/assets/fonts holds exactly these). */
const thmanyah = (JSON.parse(readFileSync(THMANYAH_PINS, 'utf8')) as { files: Record<string, string> }).files;

function checkBrandFonts(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const all = allFiles(dir);
  const problems = fontProblems({
    files: all.filter((path) => FONT_FILE.test(path)).map((path) => ({ path: relative(dir, path).split(sep).join('/'), sha256: sha256(path) })),
    sources: thmanyah,
    html: readFileSync(join(dir, 'index.html'), 'utf8'),
  }).map((problem) => `${dir}: ${problem}`);
  for (const css of all.filter((path) => path.endsWith('.css'))) {
    for (const url of unresolvedUrls(css, readFileSync(css, 'utf8'), dir, existsSync)) problems.push(`${css}: url(${url}) has no file in ${dir}`);
  }
  return problems;
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
  ...['dist-web', 'dist-desktop', 'dist-hosted'].flatMap(checkBrandFonts),
];

if (problems.length > 0) {
  console.error(`Bundle check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(
  'Bundle check passed: dist-web and dist-desktop carry no portal code; dist-hosted carries no local storage and no self-service account door; every dist ships Thmanyah unmodified, preloads no font, and resolves every CSS url().',
);
