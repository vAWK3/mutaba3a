/**
 * `npm run test:bundles` (MUT-43, hosted-portal.md §8): after building both
 * targets, prove the separation the brief promises instead of asserting
 * it. The website bundle carries no portal endpoint, cookie or header and
 * reach no new origin; the hosted bundle has no IndexedDB, Dexie or service
 * worker, no self-service account door in either language, and no new origin.
 *
 * Brand v2 (MUT-102): every dist ships the delivered Thmanyah files
 * byte-identical, bundles no retired face, preloads no font (ADR-058), and
 * every CSS url() resolves to a file inside that dist (no font silently
 * answered by the index.html fallback).
 *
 * Boot splash (MUT-207): every built entry HTML opens #root with the splash,
 * and its mark, dark mark and stylesheets resolve inside the dist (or are
 * data: URIs).
 *
 * Crash reports (MUT-149): the Sentry SDK is only in the portal's lazy chunk
 * and the landing's lazy chunks; no build carries the contract fixtures or an upload
 * token, and dist-hosted ships no source map.
 *
 * `--dist <dir>` checks one dist only: `deploy.sh` runs `--dist dist-hosted`
 * right after building the portal it ships (TD-084).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { HOSTS } from '../config/hosts';
import { SENTRY_INGEST_ORIGIN } from '../server/src/observability/sentry-ingest';
import {
  HOSTED_RULES,
  LOCAL_RULES,
  bootSplashProblems,
  extractOrigins,
  findForbidden,
  jszipInEntryGraph,
  localBackendInEntryGraph,
  indexedDbOutsideLocalBackend,
  fontProblems,
  newOrigins,
  originsNeedingReview,
  posthogInEntryGraph,
  sentryInEntryGraph,
  sentryOutsideLandingChunks,
  landingSentryChunks,
  sentrySecrets,
  sourceMaps,
  unresolvedUrls,
  type Rule,
} from './bundle-rules';

const DISTS = ['dist-web', 'dist-hosted'] as const;
const distFlag = process.argv.indexOf('--dist');
/** `test:bundles` builds web with the QA DSN: the landing's chunks must exist, or every Sentry check above ran on nothing (review D1). */
const expectLandingSentry = process.argv.includes('--expect-landing-sentry');
const only = distFlag === -1 ? null : process.argv[distFlag + 1];
if (only !== null && !(DISTS as readonly string[]).includes(only)) {
  console.error(`--dist must be one of ${DISTS.join(', ')}`);
  process.exit(2);
}
/** Whether this run checks `dir`: every dist, or the one `--dist` names. */
const wanted = (dir: string) => only === null || only === dir;

const TEXT_FILE = /\.(js|mjs|html|css|json|webmanifest)$/;
const FONT_FILE = /\.(otf|ttf|woff2?)$/;
const THMANYAH_PINS = 'src/assets/fonts/thmanyah.sha256.json';
const reviewed = JSON.parse(readFileSync('scripts/bundle-origins.json', 'utf8')) as { local: string[]; hosted: string[] };
// Our own hosts come from the one hosts config (MUT-326), new and legacy, so moving the domain needs no allowlist edit
// The portal's crash reports go to the one ingest host PORTAL_CSP names (MUT-149): the same constant, never a copy
const allowlist = { local: [...reviewed.local, ...HOSTS.allOrigins], hosted: [...reviewed.hosted, ...HOSTS.allOrigins, SENTRY_INGEST_ORIGIN] };

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

/** ADR-090: why PostHog must stay out of each build's entry graph: the landing loads it lazily; the portal only after consent. */
const POSTHOG_LAZY_ONLY: Record<string, string> = {
  'dist-web': 'so every website page would load it up front (ADR-090)',
  'dist-hosted': 'so the portal would load it before anyone turns sharing on (MUT-155, README rule 4)',
};

function checkPosthog(): string[] {
  const problems: string[] = [];
  for (const [dir, why] of Object.entries(POSTHOG_LAZY_ONLY)) {
    if (!wanted(dir) || !existsSync(dir)) continue;
    const read = (path: string) => (existsSync(join(dir, path)) ? readFileSync(join(dir, path), 'utf8') : '');
    for (const name of ENTRY_HTML[dir]) {
      for (const path of posthogInEntryGraph(read(name), read)) problems.push(`${dir}/${path}: PostHog is statically reachable from ${name}, ${why}`);
    }
  }
  return problems;
}

/** ADR-097: the local backend stays a lazy chunk, out of every page a signed-in person loads. */
function checkLocalBackendLazy(): string[] {
  const dir = 'dist-hosted';
  if (!wanted(dir) || !existsSync(dir)) return [];
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
    const inDist = relative(dir, file).split(sep).join('/');
    for (const origin of originsNeedingReview(inDist, extractOrigins(text))) found.add(origin);
  }
  for (const origin of newOrigins(found, origins)) problems.push(`${dir}: new origin ${origin} (review, then add to scripts/bundle-origins.json)`);
  return problems;
}

/** Why each dist may load the Sentry SDK only lazily: the portal signed in only (MUT-149), the landing on website pages only (MUT-150). */
const SENTRY_LAZY_ONLY: Record<string, string> = {
  'dist-hosted': 'it loads lazily, signed in only (ADR-097 §10)',
  'dist-web': 'it loads lazily, on website pages only (ADR-091)',
};

/** MUT-149/150 (ADR-091): the Sentry SDK, its fixtures, upload tokens and source maps. */
function checkSentry(): string[] {
  const problems: string[] = [];
  for (const dir of DISTS.filter((d) => wanted(d) && existsSync(d))) {
    for (const file of files(dir)) {
      const text = readFileSync(file, 'utf8');
      for (const finding of sentrySecrets(text)) problems.push(`${file}: ${finding.rule} ("${finding.match.slice(0, 12)}…") must never ship (MUT-149 AC8)`);
    }
  }
  for (const [dir, why] of Object.entries(SENTRY_LAZY_ONLY)) {
    if (!wanted(dir) || !existsSync(dir)) continue;
    const read = (path: string) => (existsSync(join(dir, path)) ? readFileSync(join(dir, path), 'utf8') : '');
    for (const name of ENTRY_HTML[dir]) {
      for (const path of sentryInEntryGraph(read(name), read)) problems.push(`${dir}/${path}: the Sentry SDK is statically reachable from ${name}; ${why}`);
    }
    for (const path of sourceMaps(allFiles(dir).map((file) => relative(dir, file).split(sep).join('/')))) {
      problems.push(`${dir}/${path}: a source map would ship; the Sentry plugin uploads and deletes them (MUT-149 AC4, MUT-150 AC5)`);
    }
  }
  const web = 'dist-web';
  if (wanted(web) && existsSync(web)) {
    const read = (path: string) => (existsSync(join(web, path)) ? readFileSync(join(web, path), 'utf8') : '');
    // Every text file, not only .js: an SDK marker inlined into index.html must fail too (MUT-150 review)
    const shipped = files(web).map((file) => relative(web, file).split(sep).join('/'));
    if (expectLandingSentry && landingSentryChunks(shipped).length === 0) {
      problems.push(`${web}: no landing Sentry chunk, though this build was made with a landing DSN (--expect-landing-sentry); the checks above proved nothing`);
    }
    for (const path of sentryOutsideLandingChunks(shipped, read)) problems.push(`${web}/${path}: the Sentry SDK is outside the landing's lazy chunks (ADR-091)`);
  }
  return problems;
}

const problems = [
  ...(wanted('dist-web') ? check('dist-web', LOCAL_RULES, allowlist.local) : []),
  ...(wanted('dist-hosted') ? check('dist-hosted', HOSTED_RULES, allowlist.hosted) : []),
  ...DISTS.filter(wanted).flatMap(checkBrandFonts),
  ...DISTS.filter(wanted).flatMap(checkBootSplash),
  ...checkPosthog(),
  ...checkLocalBackendLazy(),
  ...checkSentry(),
];

if (problems.length > 0) {
  console.error(`Bundle check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
if (only !== null) console.log(`Bundle check passed for ${only}.`);
else
  console.log(
    'Bundle check passed: dist-web carries no portal code; PostHog is lazy on the website and in the portal; dist-hosted opens IndexedDB only from its lazy local backend, loads jszip only on demand, and carries no self-service account door; every dist ships Thmanyah unmodified, preloads no font, resolves every CSS url(), and opens on a boot splash whose assets resolve; Sentry is only in the portal\'s lazy chunk and the landing\'s lazy chunks, with no fixtures, token or source map anywhere.',
  );
