/**
 * What the built bundles may and may not contain (hosted-portal.md §8,
 * MUT-43; brand fonts, MUT-102). Pure, so `check-bundles.test.ts` can prove
 * each rule fires; `check-bundles.ts` applies them to `dist-web`,
 * `dist-desktop` and `dist-hosted`.
 */
import { dirname, join, resolve, sep } from 'node:path';

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
 * The portal must hold no figure on the device (no IndexedDB, no Dexie, no
 * service worker) and offer no self-service account door, in either language.
 * `تسجيل` alone is allowed: `تسجيل الدخول` is "sign in".
 */
export const HOSTED_RULES: Rule[] = [
  { name: 'indexedDB', pattern: /indexedDB/i },
  { name: 'Dexie', pattern: /\bDexie\b/ },
  { name: 'service worker', pattern: /serviceWorker/ },
  { name: 'sign up', pattern: /\bsign[\s-]?up\b/i },
  { name: 'create account', pattern: /create (an )?account/i },
  { name: 'forgot', pattern: /\bforgot/i },
  { name: 'reset password', pattern: /reset (your )?password/i },
  { name: 'invite', pattern: /\binvit(e|ation)/i },
  { name: 'ar: create account', pattern: /إنشاء حساب/ },
  { name: 'ar: forgot', pattern: /نسيت/ },
  { name: 'ar: reset', pattern: /إعادة تعيين/ },
  { name: 'ar: invite', pattern: /دعوة/ },
  { name: 'ar: subscribe', pattern: /اشترك/ },
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

const ORIGIN = /\bhttps?:\/\/[a-z0-9.-]+(?::\d+)?/gi;

export function extractOrigins(text: string): Set<string> {
  return new Set([...text.matchAll(ORIGIN)].map((m) => m[0].toLowerCase()));
}

export function newOrigins(found: Set<string>, allowlist: string[]): string[] {
  const allowed = new Set(allowlist.map((o) => o.toLowerCase()));
  return [...found].filter((origin) => !allowed.has(origin)).sort();
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
