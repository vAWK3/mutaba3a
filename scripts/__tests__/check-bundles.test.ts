// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  HOSTED_RULES,
  LOCAL_RULES,
  POSTHOG_MARKER,
  bootSplashProblems,
  cssUrls,
  extractOrigins,
  findForbidden,
  fontProblems,
  newOrigins,
  posthogInEntryGraph,
  localBackendInEntryGraph,
  jszipInEntryGraph,
  indexedDbOutsideLocalBackend,
  posthogPrecached,
  precachedUrls,
  staticGraph,
  staticImports,
  unresolvedUrls,
  FILE_SCOPED_ORIGINS,
  originsNeedingReview,
} from '../bundle-rules';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import reviewed from '../bundle-origins.json';
import { CIMD_CLIENT_ID } from '../../src/services/oauth/oauth-client';

/** hosted-portal.md §8: the checks that keep the local builds and the portal apart. */

describe('local bundle rules', () => {
  it.each(['X-Mutaba3a-Profile', '/v1/me', 'mut_session', '__Host-mut_session', '/v1/sessions'])('flags the portal marker %s', (marker) => {
    expect(findForbidden(`fetch("${marker}")`, LOCAL_RULES).map((f) => f.rule)).not.toEqual([]);
  });

  it('passes ordinary app code', () => {
    expect(findForbidden('const db = new Dexie("mutaba3a"); indexedDB.open()', LOCAL_RULES)).toEqual([]);
  });

  // MUT-73: device sync is retired; its UI must not ship again.
  it.each(['backup.msync', 'invoke("start_sync_server")', 'Export Sync Bundle'])('flags the retired sync marker %s', (marker) => {
    expect(findForbidden(`x("${marker}")`, LOCAL_RULES).map((f) => f.rule)).not.toEqual([]);
  });

  it('refuses the portal stylesheet and its after-save notice (MUT-91)', () => {
    expect(findForbidden('.hp-toast{position:fixed}', LOCAL_RULES).map((f) => f.rule)).toEqual(['portal stylesheet']);
    expect(findForbidden('className:"hp-toast hp-toast-info"', LOCAL_RULES).map((f) => f.rule)).toEqual(['portal stylesheet']);
    expect(findForbidden('.toast-container{} .hp-toastish{}', LOCAL_RULES)).toEqual([]);
  });

  it('does not mistake ordinary sync words for the retired feature', () => {
    expect(findForbidden('async function f(){} useSyncExternalStore(); "Syncing state"; flushSync()', LOCAL_RULES)).toEqual([]);
  });
});

describe('hosted bundle rules', () => {
  it('allows IndexedDB itself: only the entry graph is checked for it (ADR-097, localBackendInEntryGraph)', () => {
    expect(findForbidden('indexedDB.open("mut-local")', HOSTED_RULES)).toEqual([]);
  });

  it.each(['new Dexie("db")', 'navigator.serviceWorker.register("/sw.js")'])('flags Dexie or offline machinery: %s', (code) => {
    expect(findForbidden(code, HOSTED_RULES)).not.toEqual([]);
  });

  it.each(['Sign up', 'sign-up', 'Create account', 'Forgot password?', 'Reset password', 'Invite a colleague', 'إنشاء حساب', 'نسيت كلمة المرور', 'إعادة تعيين', 'دعوة', 'اشترك الآن'])(
    'flags the self-service affordance "%s", case-insensitively',
    (copy) => {
      expect(findForbidden(`label:"${copy}"`, HOSTED_RULES)).not.toEqual([]);
    },
  );

  it('refuses the app\'s profile store and its after-save routes, which the shared flash store must not drag in (MUT-91)', () => {
    expect(findForbidden('persist(s,{name:"mutaba3a-active-profile"})', HOSTED_RULES).map((f) => f.rule)).toEqual(['app profile store']);
    expect(findForbidden('{to:"/clients/$clientId",params:p}', HOSTED_RULES).map((f) => f.rule)).toEqual(['app saved-flash route']);
    expect(findForbidden('{path:"/clients/$customerId"}', HOSTED_RULES)).toEqual([]);
  });

  it('does not mistake "sign in" for "sign up"', () => {
    expect(findForbidden('"Sign in","تسجيل الدخول","Signing in…"', HOSTED_RULES)).toEqual([]);
  });

  it('reports the matched text and the rule', () => {
    expect(findForbidden('xx Forgot password xx', HOSTED_RULES)).toEqual([{ rule: 'forgot', match: 'Forgot' }]);
  });
});

describe('origins', () => {
  it('extracts scheme + host and ignores paths, ports kept', () => {
    const text = 'a="https://api.frankfurter.app/latest?x=1";b=`http://localhost:8787/v1`;c="https://github.com/vAWK3/x"';
    expect([...extractOrigins(text)].sort()).toEqual(['http://localhost:8787', 'https://api.frankfurter.app', 'https://github.com']);
  });

  it('reports only origins that are not on the allowlist', () => {
    expect(newOrigins(new Set(['https://github.com', 'https://evil.example']), ['https://github.com'])).toEqual(['https://evil.example']);
  });

  describe('file-scoped origins (MUT-387)', () => {
    const scoped = { '.well-known/oauth-client.json': ['https://id.example'] };

    it('drops an origin only inside the one file it is scoped to', () => {
      expect(originsNeedingReview('.well-known/oauth-client.json', ['https://id.example', 'https://other.example'], scoped)).toEqual(['https://other.example']);
      expect(originsNeedingReview('assets/index-abc.js', ['https://id.example'], scoped)).toEqual(['https://id.example']);
    });

    it('scopes the OAuth client identity origin to the published document, which public/ ships at that path', () => {
      expect(FILE_SCOPED_ORIGINS['.well-known/oauth-client.json']).toEqual([new URL(CIMD_CLIENT_ID).origin]);
      expect(existsSync(resolve(process.cwd(), 'public/.well-known/oauth-client.json'))).toBe(true);
    });

    it('keeps the identity origin off the bundle-wide allowlist, so nothing else may quietly use it', () => {
      expect(reviewed.local).not.toContain(new URL(CIMD_CLIENT_ID).origin);
      expect(reviewed.hosted).not.toContain(new URL(CIMD_CLIENT_ID).origin);
    });
  });
});

/** MUT-102: Thmanyah ships byte-identical in every dist, every CSS url() resolves, and the body face is preloaded. */
describe('brand fonts', () => {
  describe('cssUrls', () => {
    it('reads quoted and unquoted url()s, dropping data: URIs, fragments and query strings', () => {
      const css = '@font-face{src:url(/assets/a-1.otf) format("opentype")}b{background:url("./b.png?v=2")}c{mask:url(\'data:image/svg+xml,x\')}d{filter:url(#f)}';
      expect(cssUrls(css)).toEqual(['/assets/a-1.otf', './b.png']);
    });
  });

  describe('unresolvedUrls', () => {
    const dist = '/d';
    const files = new Set(['/d/assets/a-1.otf', '/d/assets/b.woff2']);
    const exists = (path: string) => files.has(path);

    it('resolves absolute urls from the dist root and relative ones from the stylesheet', () => {
      expect(unresolvedUrls('/d/assets/index.css', 'x{src:url(/assets/a-1.otf)}y{src:url(./b.woff2)}', dist, exists)).toEqual([]);
    });

    it('reports a url with no file, which Netlify would answer with index.html', () => {
      expect(unresolvedUrls('/d/assets/index.css', 'x{src:url(/assets/gone-2.otf)}', dist, exists)).toEqual(['/assets/gone-2.otf']);
    });

    it('reports a url that escapes the dist', () => {
      expect(unresolvedUrls('/d/assets/index.css', 'x{src:url(../../outside.otf)}', dist, () => true)).toEqual(['../../outside.otf']);
    });
  });

  describe('fontProblems', () => {
    const sources = { 'thmanyahsans-Regular.otf': 'aaa', 'thmanyahsans-Bold.otf': 'bbb' };
    const files = [
      { path: 'assets/thmanyahsans-Regular-Xy12.otf', sha256: 'aaa' },
      { path: 'assets/thmanyahsans-Bold-Zz99.otf', sha256: 'bbb' },
      { path: 'assets/ibm-plex-mono-latin-400-normal-1.woff2', sha256: 'ccc' },
      { path: 'fonts/IBMPlexSansArabic-Regular.ttf', sha256: 'ddd' },
    ];
    const html = '<head><link rel="modulepreload" href="/assets/vendor-react-1.js"></head>';
    const check = (overrides: Partial<Parameters<typeof fontProblems>[0]> = {}) => fontProblems({ files, sources, html, ...overrides });

    it('passes a dist that ships every face unchanged (PDF fonts in fonts/ are not bundled)', () => {
      expect(check()).toEqual([]);
    });

    it.each(['assets/inter-latin-wght-normal-1.woff2', 'assets/source-serif-4-latin-2.woff2', 'assets/ibm-plex-sans-arabic-arabic-400-normal-3.woff2'])(
      'flags the retired face %s',
      (path) => {
        expect(check({ files: [...files, { path, sha256: 'eee' }] })).toEqual([`retired font bundled: ${path}`]);
      },
    );

    it('flags a missing face and an altered one', () => {
      const altered = files.map((file) => (file.sha256 === 'bbb' ? { ...file, sha256: 'b0b' } : file));
      expect(check({ files: altered })).toEqual([
        'thmanyahsans-Bold.otf is not bundled byte-identical (sha256 bbb)',
        'assets/thmanyahsans-Bold-Zz99.otf matches no delivered Thmanyah file (modified?)',
      ]);
    });

    it('flags an entry that preloads a font: it competed with the app code and cost 700 ms of LCP (ADR-058)', () => {
      const preload = '<head><link rel="preload" as="font" type="font/otf" href="/assets/thmanyahsans-Regular-Xy12.otf" crossorigin></head>';
      expect(check({ html: preload })).toEqual(['the entry HTML preloads a font (/assets/thmanyahsans-Regular-Xy12.otf); swap loads it without delaying first paint']);
    });
  });
});

/** MUT-207: every built entry opens on the boot splash, and what it needs ships (eng review A2: or is inlined). */
describe('boot splash', () => {
  const dist = '/d';
  const files: Record<string, string> = {
    '/d/assets/index-Ab12.css': '.boot-splash{position:fixed}body{margin:0}',
    '/d/assets/mark-Cd34.svg': '<svg/>',
    '/d/assets/mark-dark-Ef56.svg': '<svg/>',
  };
  const exists = (path: string) => path in files;
  const read = (path: string) => files[path] ?? '';
  const page = ({
    css = '<link rel="stylesheet" crossorigin href="/assets/index-Ab12.css">',
    srcset = '/assets/mark-dark-Ef56.svg',
    src = '/assets/mark-Cd34.svg',
    root = true,
  } = {}) =>
    `<html><head>${css}</head><body>${
      root
        ? `<div id="root"><div class="boot-splash" aria-hidden="true"><picture><source srcset="${srcset}" media="(prefers-color-scheme: dark)"><img class="boot-splash-mark" src="${src}" width="80" height="80" alt=""></picture></div></div>`
        : '<div id="root"></div>'
    }</body></html>`;
  const check = (html: string, htmlPath = '/d/index.html') => bootSplashProblems({ htmlPath, html, dist, exists, read });

  it('passes a built entry whose splash, marks and stylesheet are all in the dist', () => {
    expect(check(page())).toEqual([]);
  });

  it('resolves the desktop build\'s relative URLs from the HTML file', () => {
    expect(check(page({ css: '<link rel="stylesheet" href="./assets/index-Ab12.css">', src: './assets/mark-Cd34.svg', srcset: './assets/mark-dark-Ef56.svg' }))).toEqual([]);
  });

  it('accepts marks Vite inlined as data: URIs', () => {
    expect(check(page({ src: 'data:image/svg+xml,%3Csvg/%3E', srcset: 'data:image/svg+xml,%3Csvg/%3E' }))).toEqual([]);
  });

  it('flags an entry with an empty #root', () => {
    expect(check(page({ root: false }))).toEqual(['#root does not open with the .boot-splash markup']);
  });

  it('flags a mark or stylesheet with no file in the dist', () => {
    expect(check(page({ src: '/assets/mark-gone.svg', css: '<link rel="stylesheet" href="/assets/gone.css"><link rel="stylesheet" href="/assets/index-Ab12.css">' }))).toEqual([
      'the mark <img src> "/assets/mark-gone.svg" has no file in /d',
      'a stylesheet <link href> "/assets/gone.css" has no file in /d',
    ]);
  });

  it('flags a URL that escapes the dist', () => {
    expect(check(page({ srcset: '../../outside.svg' }))).toEqual(['the dark mark <source srcset> "../../outside.svg" has no file in /d']);
  });

  it('flags an entry whose stylesheets carry no .boot-splash rule, or that links none', () => {
    files['/d/assets/other.css'] = 'body{margin:0}';
    expect(check(page({ css: '<link rel="stylesheet" href="/assets/other.css">' }))).toEqual(['no linked stylesheet carries the .boot-splash rules']);
    expect(check(page({ css: '' }))).toEqual(['the entry links no stylesheet, so the splash paints unstyled']);
  });
});

describe('PostHog stays out of the local app (ADR-090, MUT-154)', () => {
  const files: Record<string, string> = {
    'index.html':
      '<script type="module" crossorigin src="/assets/index-a1.js"></script><link rel="modulepreload" crossorigin href="/assets/vendor-react-b2.js">',
    'assets/index-a1.js':
      'import{j as r}from"./vendor-react-b2.js";import"./app-shell-c3.js";export*from"./util-d4.js";const L=()=>__vitePreload(()=>import("./LandingPage-e5.js"),__vite__mapDeps([0]));',
    'assets/vendor-react-b2.js': 'export const j=1;',
    'assets/app-shell-c3.js': 'import {x} from "./vendor-react-b2.js"; export const y = x;',
    'assets/util-d4.js': 'export const z = 1;',
    'assets/LandingPage-e5.js': 'const p=()=>import("./module-f6.js");const h="https://eu.i.posthog.com";',
    'assets/module-f6.js': 'class PostHogPersistence{} const d="$posthog_cookieless";',
  };
  const reader = (all: Record<string, string>) => (path: string) => all[path] ?? '';

  it('finds static imports in minified and spaced forms, and skips dynamic import()', () => {
    expect(staticImports(files['assets/index-a1.js'])).toEqual(['./vendor-react-b2.js', './app-shell-c3.js', './util-d4.js']);
    expect(staticImports(files['assets/app-shell-c3.js'])).toEqual(['./vendor-react-b2.js']);
    expect(staticImports(files['assets/LandingPage-e5.js'])).toEqual([]);
  });

  it('walks the entry script, its modulepreloads and their static imports, never a lazy chunk', () => {
    expect(staticGraph(files['index.html'], reader(files))).toEqual([
      'assets/index-a1.js',
      'assets/vendor-react-b2.js',
      'assets/app-shell-c3.js',
      'assets/util-d4.js',
    ]);
  });

  it('passes when PostHog lives only in lazily loaded chunks', () => {
    expect(posthogInEntryGraph(files['index.html'], reader(files))).toEqual([]);
  });

  it('fails when a statically reachable chunk mentions PostHog', () => {
    const leaky = { ...files, 'assets/util-d4.js': 'const h="https://eu.i.posthog.com";' };
    expect(posthogInEntryGraph(leaky['index.html'], reader(leaky))).toEqual(['assets/util-d4.js']);
  });

  describe('the portal\'s local backend stays lazy (ADR-097, MUT-286)', () => {
    it('passes when IndexedDB is opened only from a lazily loaded chunk', () => {
      const lazy = { ...files, 'assets/LandingPage-e5.js': 'const r=indexedDB.open("mut-local",1);' };
      expect(localBackendInEntryGraph(lazy['index.html'], reader(lazy))).toEqual([]);
    });

    it('fails when any other lazy chunk opens IndexedDB: only the local backend (its mut-local database) may (review)', () => {
      const files = { 'assets/local-a1.js': 'indexedDB.open("mut-local",1)', 'assets/other-b2.js': 'indexedDB.open("cache",1)', 'assets/plain-c3.js': 'x' };
      expect(indexedDbOutsideLocalBackend(Object.keys(files), (path) => files[path as keyof typeof files])).toEqual(['assets/other-b2.js']);
    });

    it('fails when a statically loaded file opens IndexedDB', () => {
      const leaky = { ...files, 'assets/app-shell-c3.js': 'const r=indexedDB.open("mut-local",1);' };
      expect(localBackendInEntryGraph(leaky['index.html'], reader(leaky))).toEqual(['assets/app-shell-c3.js']);
    });
  });

  describe('the records zip library stays lazy (MUT-287)', () => {
    it('passes when jszip lives only in a lazily loaded chunk', () => {
      const lazy = { ...files, 'assets/jszip.min-f6.js': 'throw new Error("see https://stuk.github.io/jszip/documentation/howto/read_zip.html")' };
      expect(jszipInEntryGraph(lazy['index.html'], reader(lazy))).toEqual([]);
    });

    it('fails when a statically loaded file carries jszip', () => {
      const leaky = { ...files, 'assets/util-d4.js': 'var e="https://stuk.github.io/jszip/documentation/howto/read_zip.html";' };
      expect(jszipInEntryGraph(leaky['index.html'], reader(leaky))).toEqual(['assets/util-d4.js']);
    });
  });

  it.each(['https://eu.i.posthog.com', 'https://us.i.posthog.com/e/', 'PostHogPersistence', '$posthog_cookieless', 'posthog-js'])(
    'treats %s as a PostHog marker',
    (marker) => {
      expect(POSTHOG_MARKER.test(`x ${marker} y`)).toBe(true);
    },
  );

  it('does not mistake ordinary text for PostHog', () => {
    expect(POSTHOG_MARKER.test('the post hog went to market; postal code; $pageview')).toBe(false);
  });

  describe('the service worker never stores PostHog on a local-app device (MUT-154 review F1)', () => {
    const sw = 'define(["./workbox-1"],function(s){s.precacheAndRoute([{url:"index.html",revision:"1"},{url:"assets/index-a1.js",revision:null},{"url":"assets/LandingPage-e5.js","revision":null}],{})});';

    it('reads the precache list in both quoting styles', () => {
      expect(precachedUrls(sw)).toEqual(['index.html', 'assets/index-a1.js', 'assets/LandingPage-e5.js']);
    });

    it('passes when no precached file mentions PostHog', () => {
      const clean = { ...files, 'assets/LandingPage-e5.js': 'const p=()=>import("./vendor-posthog-f6.js");' };
      expect(posthogPrecached(sw, reader(clean))).toEqual([]);
    });

    it('names each precached file that carries PostHog', () => {
      expect(posthogPrecached(sw, reader(files))).toEqual(['assets/LandingPage-e5.js']);
    });
  });
});
