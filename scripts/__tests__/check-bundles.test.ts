// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { HOSTED_RULES, LOCAL_RULES, cssUrls, extractOrigins, findForbidden, fontProblems, newOrigins, unresolvedUrls } from '../bundle-rules';

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

  it('does not mistake ordinary sync words for the retired feature', () => {
    expect(findForbidden('async function f(){} useSyncExternalStore(); "Syncing state"; flushSync()', LOCAL_RULES)).toEqual([]);
  });
});

describe('hosted bundle rules', () => {
  it.each(['indexedDB.open("x")', 'new Dexie("db")', 'navigator.serviceWorker.register("/sw.js")'])('flags local storage or offline machinery: %s', (code) => {
    expect(findForbidden(code, HOSTED_RULES)).not.toEqual([]);
  });

  it.each(['Sign up', 'sign-up', 'Create account', 'Forgot password?', 'Reset password', 'Invite a colleague', 'إنشاء حساب', 'نسيت كلمة المرور', 'إعادة تعيين', 'دعوة', 'اشترك الآن'])(
    'flags the self-service affordance "%s", case-insensitively',
    (copy) => {
      expect(findForbidden(`label:"${copy}"`, HOSTED_RULES)).not.toEqual([]);
    },
  );

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
