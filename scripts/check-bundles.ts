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
 *
 * Boot splash (MUT-207): every built entry HTML opens #root with the splash,
 * and its mark, dark mark and stylesheets resolve inside the dist (or are
 * data: URIs).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  HOSTED_RULES,
  LOCAL_RULES,
  POSTHOG_MARKER,
  bootSplashProblems,
  extractOrigins,
  findForbidden,
  jszipInEntryGraph,
  localBackendInEntryGraph,
  indexedDbOutsideLocalBackend,
  fontProblems,
  newOrigins,
  posthogInEntryGraph,
  posthogPrecached,
  unresolvedUrls,
  type Rule,
} from './bundle-rules';

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

/** The entry HTML files each dist serves. */
const ENTRY_HTML: Record<string, string[]> = {
  'dist-web': ['index.html'],
  'dist-desktop': ['index.html'],
  'dist-hosted': ['index.html'],
};

function checkBootSplash(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return ENTRY_HTML[dir].flatMap((name) => {
    const htmlPath = join(dir, name);
    if (!existsSync(htmlPath)) return [`${htmlPath} is missing`];
    const read = (path: string) => readFileSync(path, 'utf8');
    return bootSplashProblems({ htmlPath, html: read(htmlPath), dist: dir, exists: existsSync, read }).map((problem) => `${htmlPath}: ${problem}`);
  });
}

/**
 * ADR-090: PostHog is loaded lazily by the landing pages only. In dist-web no
 * file the entry loads statically may mention it (the local app shares that
 * entry); dist-desktop must not mention it at all.
 */
/** Why PostHog must stay out of each build's entry graph: the local app never counts; the portal loads it only after consent. */
const POSTHOG_LAZY_ONLY: Record<string, string> = {
  'dist-web': 'so it would ship inside the local app (ADR-090)',
  'dist-hosted': 'so the portal would load it before anyone turns sharing on (MUT-155, README rule 4)',
};

function checkPosthog(): string[] {
  const problems: string[] = [];
  for (const [dir, why] of Object.entries(POSTHOG_LAZY_ONLY)) {
    if (!existsSync(dir)) continue;
    const read = (path: string) => (existsSync(join(dir, path)) ? readFileSync(join(dir, path), 'utf8') : '');
    for (const name of ENTRY_HTML[dir]) {
      for (const path of posthogInEntryGraph(read(name), read)) problems.push(`${dir}/${path}: PostHog is statically reachable from ${name}, ${why}`);
    }
  }
  if (existsSync('dist-web/sw.js')) {
    const read = (path: string) => (existsSync(join('dist-web', path)) ? readFileSync(join('dist-web', path), 'utf8') : '');
    for (const path of posthogPrecached(read('sw.js'), read)) {
      problems.push(`dist-web/${path}: the service worker precaches PostHog, so it would be stored on every local-app device (add it to PWA_WORKBOX.globIgnores)`);
    }
  }
  if (existsSync('dist-desktop')) {
    for (const file of files('dist-desktop')) {
      if (POSTHOG_MARKER.test(readFileSync(file, 'utf8'))) problems.push(`${file}: the desktop build must never carry PostHog (ADR-024, ADR-090)`);
    }
  }
  return problems;
}

/** ADR-097: the local backend stays a lazy chunk, out of every page a signed-in person loads. */
function checkLocalBackendLazy(): string[] {
  const dir = 'dist-hosted';
  if (!existsSync(dir)) return [];
  const read = (path: string) => (existsSync(join(dir, path)) ? readFileSync(join(dir, path), 'utf8') : '');
  const outside = indexedDbOutsideLocalBackend(
    files(dir).filter((file) => file.endsWith('.js')).map((file) => file.slice(dir.length + 1)),
    read,
  ).map((path) => `${dir}/${path}: touches IndexedDB but is not the local backend (no mut-local database); only it may (ADR-100)`);
  return [
    ...ENTRY_HTML[dir].flatMap((name) =>
      localBackendInEntryGraph(read(name), read).map((path) => `${dir}/${path}: IndexedDB is statically reachable from ${name}; only the lazy local backend may open it (ADR-097)`),
    ),
    ...ENTRY_HTML[dir].flatMap((name) =>
      jszipInEntryGraph(read(name), read).map((path) => `${dir}/${path}: jszip is statically reachable from ${name}; only Your data's Download/Restore may load it (MUT-287)`),
    ),
    ...outside,
  ];
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
  ...['dist-web', 'dist-desktop', 'dist-hosted'].flatMap(checkBootSplash),
  ...checkPosthog(),
  ...checkLocalBackendLazy(),
];

if (problems.length > 0) {
  console.error(`Bundle check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(
  'Bundle check passed: dist-web and dist-desktop carry no portal code; PostHog is unreachable from the local app (lazy landing chunks only, never precached), lazy in the portal, and absent from desktop; dist-hosted opens IndexedDB only from its lazy local backend, loads jszip only on demand, and carries no self-service account door; every dist ships Thmanyah unmodified, preloads no font, resolves every CSS url(), and opens on a boot splash whose assets resolve.',
);
