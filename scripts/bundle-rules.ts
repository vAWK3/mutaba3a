/**
 * What the built bundles may and may not contain (hosted-portal.md §8,
 * MUT-43; brand fonts, MUT-102). Pure, so `check-bundles.test.ts` can prove
 * each rule fires; `check-bundles.ts` applies them to `dist-web`,
 * `dist-desktop` and `dist-hosted`.
 */
import { dirname, join, resolve, sep } from 'node:path';
import { CIMD_CLIENT_ID } from '../src/services/oauth/oauth-client';
import { SENTRY_INGEST_ORIGIN } from '../server/src/observability/sentry-ingest';

export interface Rule {
  name: string;
  pattern: RegExp;
}

export interface Finding {
  rule: string;
  match: string;
}

/**
 * The local builds (web, desktop) must carry nothing of the portal: no endpoint,
 * cookie or header. Nor anything of retired device sync (MUT-73, ADR-053): the
 * three exact strings below shipped with the bundle and pairing UI, and are
 * specific enough not to match a library's own "sync".
 */
export const LOCAL_RULES: Rule[] = [
  { name: 'profile header', pattern: /X-Mutaba3a-Profile/i },
  { name: 'identity endpoint', pattern: /\/v1\/me\b/ },
  { name: 'session endpoint', pattern: /\/v1\/sessions\b/ },
  { name: 'session cookie', pattern: /mut_session/ },
  { name: 'sync bundle extension', pattern: /\.msync\b/ },
  { name: 'sync server command', pattern: /start_sync_server/ },
  { name: 'sync bundle export', pattern: /Export Sync Bundle/ },
  // MUT-91: the portal's stylesheet and its after-save notice stay out of the local builds.
  { name: 'portal stylesheet', pattern: /\bhp-toast\b/ },
];

/**
 * The portal carries no Dexie or service worker, and no invite door in either language (invites wait for MUT-306).
 * `اشترك` is allowed since MUT-362 (ADR-170): a firm subscribes from Settings › Billing. Since MUT-368 (ADR-159) the
 * portal has its two self-service doors, /signup and /recover, so "sign up", "create an account", "forgot" and "reset
 * password" (and إنشاء حساب, نسيت, إعادة تعيين) are allowed on purpose; the server's no-self-registration test still pins
 * that those are the only two. IndexedDB is allowed since ADR-097, but only in the lazy local backend: see
 * `localBackendInEntryGraph`.
 */
export const HOSTED_RULES: Rule[] = [
  { name: 'Dexie', pattern: /\bDexie\b/ },
  { name: 'service worker', pattern: /serviceWorker/ },
  { name: 'invite', pattern: /\binvit(e|ation)/i },
  { name: 'ar: invite', pattern: /دعوة/ },
  // MUT-91: the portal imports the app's after-save store; nothing of the app's
  // profile store or its Show routes may come along with it.
  { name: 'app profile store', pattern: /mutaba3a-active-profile/ },
  { name: 'app saved-flash route', pattern: /\/clients\/\$clientId/ },
];

export function findForbidden(text: string, rules: Rule[]): Finding[] {
  const findings: Finding[] = [];
  for (const rule of rules) {
    const match = rule.pattern.exec(text);
    if (match) findings.push({ rule: rule.name, match: match[0] });
  }
  return findings;
}

/** A DSN's public key sits where userinfo goes (`https://<key>@host`, MUT-149): the origin is the host after it. */
const ORIGIN = /\b(https?:\/\/)(?:[a-z0-9]+@)?([a-z0-9.-]+(?::\d+)?)/gi;

export function extractOrigins(text: string): Set<string> {
  return new Set([...text.matchAll(ORIGIN)].map((m) => `${m[1]}${m[2]}`.toLowerCase()));
}

export function newOrigins(found: Set<string>, allowlist: string[]): string[] {
  const allowed = new Set(allowlist.map((o) => o.toLowerCase()));
  return [...found].filter((origin) => !allowed.has(origin)).sort();
}

/**
 * Origins one shipped file may name and nothing else may (MUT-387), keyed by the file's path in
 * the dist. The Malafat OAuth client document names its own host: a fixed identity that must not
 * follow config/hosts.json, and must not open that host to the rest of the bundle either.
 */
export const FILE_SCOPED_ORIGINS: Readonly<Record<string, readonly string[]>> = {
  '.well-known/oauth-client.json': [new URL(CIMD_CLIENT_ID).origin],
};

/** The landing's lazy error-report chunks in dist-web (MUT-150): the SDK's own and the one that starts it. */
export const LANDING_SENTRY_CHUNK = /^assets\/(?:vendor-sentry|landingSentry)-[A-Za-z0-9_-]+\.js$/;

/**
 * Origins only files matching a pattern may name (MUT-150 eng O1). Hashed chunk
 * names can't be listed path by path. The landing's Sentry chunks send to the
 * org's ingest host and carry the SDK's docs link; the rest of dist-web, which
 * the local app shares, may name neither.
 */
export const PATTERN_SCOPED_ORIGINS: ReadonlyArray<{ pattern: RegExp; origins: readonly string[] }> = [
  { pattern: LANDING_SENTRY_CHUNK, origins: [SENTRY_INGEST_ORIGIN, 'https://docs.sentry.io'] },
];

/** The origins in `file` (a dist-relative path) that still need the bundle-wide allowlist. */
export function originsNeedingReview(
  file: string,
  origins: Iterable<string>,
  scoped: Readonly<Record<string, readonly string[]>> = FILE_SCOPED_ORIGINS,
  patterns: ReadonlyArray<{ pattern: RegExp; origins: readonly string[] }> = PATTERN_SCOPED_ORIGINS,
): string[] {
  const byPattern = patterns.filter((scope) => scope.pattern.test(file)).flatMap((scope) => scope.origins);
  const allowedHere = new Set([...(scoped[file] ?? []), ...byPattern].map((o) => o.toLowerCase()));
  return [...origins].filter((origin) => !allowedHere.has(origin.toLowerCase()));
}

/** `url()`s in a stylesheet, without query or fragment; `data:` URIs and `#id` references skipped. */
export function cssUrls(css: string): string[] {
  return [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)]
    .map((m) => m[2].trim())
    .filter((url) => !url.startsWith('data:') && !url.startsWith('#'))
    .map((url) => url.replace(/[?#].*$/, ''));
}

/**
 * The `url()`s of a built stylesheet with no file inside its dist. Netlify's
 * `/* -> /index.html 200` fallback would answer those with HTML, and the
 * browser would quietly fall back to a system font, so the build fails instead.
 */
export function unresolvedUrls(cssPath: string, css: string, dist: string, exists: (path: string) => boolean): string[] {
  const root = resolve(dist);
  return cssUrls(css).filter((url) => {
    const path = url.startsWith('/') ? join(root, url) : resolve(dirname(cssPath), url);
    return !(path.startsWith(root + sep) && exists(path));
  });
}

export interface EmittedFile {
  /** Relative to the dist root, with `/` separators. */
  path: string;
  sha256: string;
}

export interface FontCheck {
  /** The font files in the dist. */
  files: EmittedFile[];
  /** Delivered Thmanyah file name → sha256. */
  sources: Record<string, string>;
  /** The entry HTML. */
  html: string;
}

/** Faces Brand v2 retired (MUT-102). The invoice PDFs' own .ttf copies in `fonts/` are not bundled assets. */
const RETIRED_FONT = /(^|\/)(inter|source-?serif|ibm-?plex-?sans-?arabic)[^/]*\.(woff2?|ttf|otf)$/i;

const PRELOAD_LINK = /<link\b[^>]*>/gi;

function preloadedFonts(html: string): string[] {
  return [...html.matchAll(PRELOAD_LINK)]
    .map((m) => m[0])
    .filter((tag) => /\brel=["']?preload\b/i.test(tag) && /\bas=["']?font\b/i.test(tag))
    .map((tag) => /\bhref=["']?([^"'\s>]+)/i.exec(tag)?.[1] ?? '');
}

/**
 * The Thmanyah files ship unmodified, no retired face is bundled, and the entry
 * preloads no font: a preload competed with the app code and cost ~700 ms of
 * landing LCP on a slow link, where swap paints text at once (ADR-058).
 */
export function fontProblems({ files, sources, html }: FontCheck): string[] {
  const problems: string[] = [];
  const bundled = files.filter((file) => file.path.startsWith('assets/'));
  for (const file of bundled) if (RETIRED_FONT.test(file.path)) problems.push(`retired font bundled: ${file.path}`);

  const delivered = new Set(Object.values(sources));
  for (const [name, sha256] of Object.entries(sources)) {
    if (!bundled.some((file) => file.sha256 === sha256)) problems.push(`${name} is not bundled byte-identical (sha256 ${sha256})`);
  }
  for (const file of bundled) {
    if (file.path.endsWith('.otf') && !delivered.has(file.sha256)) problems.push(`${file.path} matches no delivered Thmanyah file (modified?)`);
  }

  for (const href of preloadedFonts(html)) problems.push(`the entry HTML preloads a font (${href}); swap loads it without delaying first paint`);
  return problems;
}

export interface BootSplashCheck {
  /** The built entry HTML's path, and its text. */
  htmlPath: string;
  html: string;
  /** The dist root it belongs to. */
  dist: string;
  exists: (path: string) => boolean;
  read: (path: string) => string;
}

const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(tag)?.[1] ?? null;

/** A URL in a built entry HTML: `data:` is inline; anything else is a file inside the dist, or null when it isn't. */
function distFile(url: string, htmlPath: string, dist: string): string | null | 'inline' {
  if (url.startsWith('data:')) return 'inline';
  const root = resolve(dist);
  const clean = url.replace(/[?#].*$/, '');
  const path = clean.startsWith('/') ? join(root, clean) : resolve(dirname(htmlPath), clean);
  return path.startsWith(root + sep) ? path : null;
}

/**
 * The boot splash in a built entry HTML (MUT-207, ADR-080): `#root` opens with
 * `.boot-splash`, and its mark (`<img src>`), dark mark (`<source srcset>`) and
 * every linked stylesheet resolve to files inside the dist, or are `data:` URIs
 * (Vite inlines assets under 4 KB; eng review A2). One of those stylesheets
 * must carry the `.boot-splash` rules. Same shape as the CSS `url()` rule.
 */
export function bootSplashProblems({ htmlPath, html, dist, exists, read }: BootSplashCheck): string[] {
  const problems: string[] = [];
  const root = /<div\b[^>]*\bid="root"[^>]*>([\s\S]*?)<\/picture>/i.exec(html);
  if (!root || !/^\s*<div\b[^>]*\bclass="boot-splash"/i.test(root[1])) return ['#root does not open with the .boot-splash markup'];

  const urls: [string, string | null][] = [];
  const img = /<img\b[^>]*>/i.exec(root[1])?.[0];
  const source = /<source\b[^>]*>/i.exec(root[1])?.[0];
  urls.push(['the mark <img src>', img ? attr(img, 'src') : null]);
  urls.push(['the dark mark <source srcset>', source ? attr(source, 'srcset') : null]);
  const sheets = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).filter((tag) => /\brel="stylesheet"/i.test(tag));
  for (const sheet of sheets) urls.push(['a stylesheet <link href>', attr(sheet, 'href')]);
  if (sheets.length === 0) problems.push('the entry links no stylesheet, so the splash paints unstyled');

  let styled = false;
  for (const [what, url] of urls) {
    if (!url) {
      problems.push(`${what} is missing`);
      continue;
    }
    const file = distFile(url, htmlPath, dist);
    if (file === 'inline') continue;
    if (!file || !exists(file)) {
      problems.push(`${what} "${url}" has no file in ${dist}`);
      continue;
    }
    if (what.startsWith('a stylesheet') && /\.boot-splash\b/.test(read(file))) styled = true;
  }
  if (sheets.length > 0 && !styled) problems.push('no linked stylesheet carries the .boot-splash rules');
  return problems;
}

/**
 * Text that only PostHog's SDK or our PostHog wiring carries: an ingest or app
 * host, the SDK's persistence class, its cookieless sentinel, or its package
 * name (ADR-090). Matching `posthog.com` hosts, not the bare word, keeps
 * ordinary prose out.
 */
export const POSTHOG_MARKER = /\b(?:[a-z0-9-]+\.)*posthog\.com\b|PostHogPersistence|\$posthog_cookieless|posthog-js/i;

/** A static `import … from "x"`, `import "x"` or `export … from "x"`; `import(` (lazy) is never matched. */
const STATIC_IMPORT = /(?:^|[^\w$.])(?:import|export)\s*(?:[\w$*{}\s,]*?\bfrom\s*)?["']([^"']+)["']/g;

/** The module specifiers `js` imports statically, in source order. */
export function staticImports(js: string): string[] {
  return [...js.matchAll(STATIC_IMPORT)].map((m) => m[1]);
}

const ENTRY_SCRIPT = /<script\b[^>]*\btype=["']?module["']?[^>]*\bsrc=["']?\/?([^"'\s>]+)/gi;
const MODULE_PRELOAD = /<link\b[^>]*\brel=["']?modulepreload["']?[^>]*\bhref=["']?\/?([^"'\s>]+)/gi;

/**
 * Every JS file the entry HTML loads before any lazy import runs: its module
 * script, its modulepreloads, and everything they import statically, as paths
 * relative to the dist root. Lazy `import()` chunks are what the landing's
 * analytics hides in, so they are not followed.
 */
export function staticGraph(html: string, read: (path: string) => string): string[] {
  const roots = [...html.matchAll(ENTRY_SCRIPT), ...html.matchAll(MODULE_PRELOAD)].map((m) => m[1]);
  const seen: string[] = [];
  const queue = [...roots];
  while (queue.length > 0) {
    const path = queue.shift()!;
    if (seen.includes(path)) continue;
    seen.push(path);
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
    for (const specifier of staticImports(read(path))) {
      if (specifier.startsWith('./') || specifier.startsWith('../')) queue.push(new URL(specifier, `https://dist/${dir}`).pathname.slice(1));
    }
  }
  return seen;
}

/**
 * The statically loaded files of the web entry that mention PostHog: the
 * local app at /app shares that entry, so any hit means the SDK (or its host)
 * ships inside the local app (ADR-024, ADR-090). Empty when it is clean.
 */
export function posthogInEntryGraph(html: string, read: (path: string) => string): string[] {
  return staticGraph(html, read).filter((path) => POSTHOG_MARKER.test(read(path)));
}

/** What only the portal's local backend (ADR-097) does: open IndexedDB. */
export const LOCAL_BACKEND_MARKER = /indexedDB/i;

/**
 * The statically loaded portal files that touch IndexedDB. The local backend
 * is the portal's one IndexedDB user and a lazy chunk, loaded only signed out
 * (MUT-285 brief §2.7, §9): a hit means a signed-in page would download it, or
 * that something else in the portal stores data on the device. Empty when clean.
 */
export function localBackendInEntryGraph(html: string, read: (path: string) => string): string[] {
  return staticGraph(html, read).filter((path) => LOCAL_BACKEND_MARKER.test(read(path)));
}

/** jszip's own documentation link, inside its minified error messages: what marks its chunk. */
export const JSZIP_MARKER = /stuk\.github\.io\/jszip/;

/**
 * The statically loaded portal files that carry jszip. The portal loads it
 * only when someone presses Download or Restore in Your data (MUT-287, eng
 * review R2): a hit means every page load would download ~30 KB gzip for a
 * button almost nobody presses. Empty when clean.
 */
export function jszipInEntryGraph(html: string, read: (path: string) => string): string[] {
  return staticGraph(html, read).filter((path) => JSZIP_MARKER.test(read(path)));
}

/** The local backend's own database name (src/hosted/local/persistence.ts): what marks its chunk. */
export const LOCAL_BACKEND_DATABASE = 'mut-local';

/**
 * Built files that touch IndexedDB but are not the local backend: only the
 * chunk that opens its own `mut-local` database may (ADR-100). With
 * `localBackendInEntryGraph`, this holds the whole promise: IndexedDB in one
 * lazy chunk, and nowhere else in the portal. Empty when clean.
 */
export function indexedDbOutsideLocalBackend(paths: readonly string[], read: (path: string) => string): string[] {
  return paths.filter((path) => {
    const text = read(path);
    return LOCAL_BACKEND_MARKER.test(text) && !text.includes(LOCAL_BACKEND_DATABASE);
  });
}

/** The files a Workbox `sw.js` precaches, from its `{url:"…"}` entries (minified or JSON-quoted). */
export function precachedUrls(sw: string): string[] {
  return [...sw.matchAll(/\{\s*"?url"?\s*:\s*"([^"]+)"/g)].map((match) => match[1]);
}

/**
 * The precached files that mention PostHog: the service worker installs for
 * everyone who opens the local app, so a hit means the SDK would be stored on
 * their device even though it never runs there (MUT-154 review F1). Empty when clean.
 */
export function posthogPrecached(sw: string, read: (path: string) => string): string[] {
  return precachedUrls(sw).filter((path) => POSTHOG_MARKER.test(read(path)));
}

/**
 * What only the Sentry browser SDK or our DSN carries (MUT-149): its global
 * carrier, its SDK name, its auth query key, the EU ingest host. Not bare
 * `sentry.io`: posthog-js links to it (bundle-origins.json).
 */
export const SENTRY_MARKER = /__SENTRY__|sentry\.javascript|\bsentry_key\b|ingest\.de\.sentry\.io/;

/** True when a local build (web, desktop) file carries the SDK: only the portal and the landing's chunks may (AC1). */
export function sentryLeaks(text: string): boolean {
  return SENTRY_MARKER.test(text);
}

/**
 * dist-web files that carry the SDK outside the landing's lazy chunks (MUT-150):
 * the local app loads the rest of dist-web, and never the SDK (ADR-024). Empty when clean.
 */
export function sentryOutsideLandingChunks(paths: readonly string[], read: (path: string) => string): string[] {
  return paths.filter((path) => !LANDING_SENTRY_CHUNK.test(path) && sentryLeaks(read(path)));
}

/**
 * The precached files that carry the SDK (MUT-150): the service worker installs
 * for everyone who opens the local app, so a hit means Sentry would be stored on
 * their device. Empty when clean.
 */
export function sentryPrecached(sw: string, read: (path: string) => string): string[] {
  return precachedUrls(sw).filter((path) => SENTRY_MARKER.test(read(path)));
}

/**
 * The statically loaded portal files that carry the SDK. It is a lazy chunk,
 * loaded only signed in (ADR-097 §10): a hit means every page load, signed out
 * too, would download it. Empty when clean.
 */
export function sentryInEntryGraph(html: string, read: (path: string) => string): string[] {
  return staticGraph(html, read).filter((path) => SENTRY_MARKER.test(read(path)));
}

/** The synthetic-PII fixtures' own marker (docs/observability/sentry-fixtures.json): they must never ship (AC8). */
export const SENTRY_FIXTURE_MARKER = 'MUT147-SENTRY-FIXTURE-DO-NOT-BUNDLE';

const SENTRY_SECRETS: Rule[] = [
  { name: 'Sentry contract fixtures', pattern: new RegExp(SENTRY_FIXTURE_MARKER) },
  { name: 'Sentry auth token', pattern: /\bsntry[su]_[A-Za-z0-9]/ },
];

/** What must never be in any build: the fixtures, or an upload token (only `SENTRY_AUTH_TOKEN` at build time holds one). */
export function sentrySecrets(text: string): Finding[] {
  return findForbidden(text, SENTRY_SECRETS);
}

/** Source maps in a dist (paths relative to it): uploaded and deleted at build time, never shipped (AC4). */
export function sourceMaps(paths: readonly string[]): string[] {
  return paths.filter((path) => path.endsWith('.map'));
}
