// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { ConfigEnv, PluginOption, UserConfig } from 'vite';
import { existsSync } from 'node:fs';
import configFn, {
  DEFAULT_PORTAL_URL,
  DEFAULT_PUBLIC_ORIGIN,
  hostedOfferUrl,
  termsUrl,
  PWA_INCLUDE_ASSETS,
  PWA_MANIFEST,
  PWA_WORKBOX,
  POSTHOG_CHUNK,
  POSTHOG_PRECACHE_IGNORES,
  appVersion,
  netlifyFormsHtml,
  netlifyRedirects,
  LEGACY_LANDING_PATHS,
  portalUrl,
  posthogKey,
  turnstileSiteKey,
  TURNSTILE_TEST_SITE_KEY,
  scopeServerBufferShim,
  sentryDsn,
  sentryEnvironment,
  sentryRelease,
  socialMetaTags,
  withPageMeta,
} from '../../vite.config';
import { readFileSync } from 'node:fs';
import {
  HONEYPOT_FIELD,
  HOSTED_REQUEST_FIELDS,
  HOSTED_REQUEST_FORM_NAME,
  NETLIFY_FORMS_PATH,
} from '../../src/pages/landing/hostedRequest';
import ar from '../../src/lib/i18n/translations/ar';
import tokens from '../../src/styles/brand/mutaba3a.tokens.json';
import pkg from '../../package.json';
import { repoPath } from '../../src/test/css/brandCss';
import { pngSize } from '../../src/test/pngSize';
import { HOSTS, parseHostsConfig, resolveHosts } from '../../config/hosts';
import { CIMD_CLIENT_ID } from '../../src/services/oauth/oauth-client';
import { SENTRY_INGEST_ORIGIN } from '../../server/src/observability/sentry-ingest';

/**
 * hosted-portal.md §8: the hosted build target is additive. The `web` and
 * `desktop` configs were snapshotted before the `hosted` branch existed, so any
 * change to them fails here first. MUT-102 masks the release version so a
 * release bump doesn't break it.
 */

type ConfigFactory = (env: ConfigEnv) => UserConfig;

function resolve(mode: string): UserConfig {
  return (configFn as unknown as ConfigFactory)({ mode, command: 'build', isSsrBuild: false, isPreview: false });
}

function pluginNames(plugins: PluginOption[] | undefined): string[] {
  const names: string[] = [];
  const walk = (p: PluginOption) => {
    if (!p) return;
    if (Array.isArray(p)) p.forEach(walk);
    else if (typeof p === 'object' && 'name' in p) names.push(p.name);
  };
  (plugins ?? []).forEach(walk);
  return names;
}

/** The portal origin comes from config/hosts.json (MUT-326), so picking the domain doesn't rewrite this snapshot. */
function maskPortalUrl(define: UserConfig['define']) {
  return define?.__PORTAL_URL__ === JSON.stringify(HOSTS.portalOrigin) ? { __PORTAL_URL__: '<config/hosts.json portalOrigin>' } : {};
}

function comparable(config: UserConfig) {
  return {
    ...config,
    define: { ...config.define, __APP_VERSION__: '<package.json version>', ...maskPortalUrl(config.define) },
    plugins: pluginNames(config.plugins),
  };
}


describe('vite.config', () => {
  it.each(['web', 'desktop'])('leaves the %s build exactly as it was', (mode) => {
    // deploy.env/the shell may export a real MUTABA3A_POSTHOG_KEY (Makefile line 51, MUT-155)
    // for an actual release build; pin it so the snapshot never depends on that ambient state.
    vi.stubEnv('MUTABA3A_POSTHOG_KEY', '');
    try {
      expect(comparable(resolve(mode))).toMatchSnapshot();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  describe('brand fonts (MUT-102)', () => {
    it.each(['web', 'desktop', 'hosted'])('the %s build preloads no font: swap paints text first (ADR-058)', (mode) => {
      expect(pluginNames(resolve(mode).plugins).filter((name) => /preload/.test(name))).toEqual([]);
    });

    it('caches fonts on first use instead of precaching ~1.2 MB of .otf on every install (PD10)', () => {
      const { globPatterns, runtimeCaching } = PWA_WORKBOX;
      expect(globPatterns?.join()).not.toMatch(/otf/);
      const isFont = (rule: (typeof runtimeCaching & object)[number], destination: string) =>
        typeof rule.urlPattern === 'function' && rule.urlPattern({ request: { destination } } as never) === true;
      const fontRule = runtimeCaching?.find((rule) => isFont(rule, 'font'));
      expect(fontRule).toMatchObject({ handler: 'CacheFirst', options: { cacheName: 'fonts', expiration: { maxEntries: 12 } } });
      expect(isFont(fontRule!, 'script')).toBe(false);
    });
  });

  describe('PWA manifest (MUT-104)', () => {
    it('paints the splash and title bar with the brand canvas from the token file', () => {
      expect(PWA_MANIFEST.theme_color).toBe(tokens.color.canvas.hex);
      expect(PWA_MANIFEST.background_color).toBe(tokens.color.canvas.hex);
    });

    it.each(PWA_MANIFEST.icons ?? [])('ships $src at its declared $sizes', ({ src, sizes }) => {
      const file = repoPath(`public${src}`);
      expect(existsSync(file), file).toBe(true);
      expect(pngSize(file).join('x')).toBe(sizes);
    });

    it('keeps one maskable icon for Android launchers', () => {
      expect((PWA_MANIFEST.icons ?? []).filter((icon) => icon.purpose === 'maskable')).toHaveLength(1);
    });

    it('includes the favicons and the apple-touch icon, and each exists in public/', () => {
      expect(PWA_INCLUDE_ASSETS).toEqual(
        expect.arrayContaining(['favicon.svg', 'favicon-32.png', 'favicon-16.png', 'apple-touch-icon.png']),
      );
      for (const asset of PWA_INCLUDE_ASSETS) expect(existsSync(repoPath(`public/${asset}`)), asset).toBe(true);
    });
  });

  describe('Netlify domain-move redirects (MUT-326, ADR-155 D5)', () => {
    const LEGACY = { landing: 'https://old.netlify.example', portal: 'https://old-portal.run.example' };
    const hosts = (env: Record<string, unknown>) =>
      resolveHosts(parseHostsConfig({ production: { domain: null, portalSubdomain: 'app', stage: 'legacy', legacy: LEGACY, ...env } }));
    const lines = (stage: string) => netlifyRedirects(hosts({ domain: 'placeholder.example', stage })).trim().split('\n');

    it('emits nothing before the domain is live', () => {
      expect(netlifyRedirects(hosts({}))).toBe('');
      expect(netlifyRedirects(hosts({ domain: 'placeholder.example', stage: 'proxy' }))).toBe('');
    });

    it('live: the apex sends /app back to the old host, where the free web app\'s data is', () => {
      expect(lines('live')).toEqual([
        'https://placeholder.example/app https://old.netlify.example/app 302!',
        'https://placeholder.example/app/* https://old.netlify.example/app/:splat 302!',
      ]);
    });

    it('redirect: also sends the old host\'s landing pages, and only those, on to the apex', () => {
      expect(lines('redirect').slice(2)).toEqual([
        'https://old.netlify.example/ https://placeholder.example/ 302!',
        'https://old.netlify.example/download https://placeholder.example/download 302!',
        'https://old.netlify.example/privacy https://placeholder.example/privacy 302!',
        'https://old.netlify.example/terms https://placeholder.example/terms 302!',
        'https://old.netlify.example/terms/* https://placeholder.example/terms/:splat 302!',
      ]);
    });

    it('never sends the old host\'s free web app, assets or service worker anywhere (their data lives there until MUT-291)', () => {
      for (const line of lines('redirect')) expect(line).not.toMatch(/^https:\/\/old\.netlify\.example\/(app|assets|sw\.js|workbox|manifest)/);
      for (const path of LEGACY_LANDING_PATHS) expect(path).not.toMatch(/^\/(app|assets)/);
    });

    it('builds the checked-in config\'s rules into the web build only', () => {
      expect(pluginNames(resolve('web').plugins)).toContain('mutaba3a:domain-move-redirects');
      expect(pluginNames(resolve('desktop').plugins)).not.toContain('mutaba3a:domain-move-redirects');
      expect(pluginNames(resolve('hosted').plugins)).not.toContain('mutaba3a:domain-move-redirects');
      expect(netlifyRedirects(HOSTS)).toEqual(HOSTS.stage === 'legacy' || HOSTS.stage === 'proxy' ? '' : expect.stringContaining('/app'));
    });

    /**
     * MUT-387: Malafat fetches our OAuth client document from CIMD_CLIENT_ID and refuses a 3xx
     * (cimd-fetcher.ts), so no rule may ever sit in front of it. Keyed on the identity's own
     * origin, not the config apex: the identity stays put when the apex moves, and may then be
     * the legacy landing host whose pages stage "redirect" sends on.
     */
    describe('never redirects the Malafat OAuth client document (MUT-387)', () => {
      const cimd = new URL(CIMD_CLIENT_ID);
      const target = `${cimd.origin}${cimd.pathname}`;
      const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      /** A Netlify `from` (a path on this site or a full URL; `*` splats the rest, `:name` is one segment) covering the document. */
      const matches = (from: string) => {
        const absolute = /^https?:\/\//.test(from) ? from : `${cimd.origin}${from}`;
        const pattern = absolute
          .split('/')
          .map((segment) => (segment === '*' ? '.*' : segment.startsWith(':') ? '[^/]+' : escapeRegExp(segment)))
          .join('/');
        return new RegExp(`^${pattern}$`).test(target);
      };
      const cases = {
        'the identity host is the apex': { domain: cimd.hostname },
        'the identity host is the legacy landing after an apex move': { domain: 'placeholder.example', legacy: { ...LEGACY, landing: cimd.origin } },
      };

      it('recognises every Netlify `from` shape that would cover the document', () => {
        for (const from of [`${cimd.origin}/*`, '/*', '/.well-known/*', `${cimd.origin}/.well-known/:file`, '/:dir/oauth-client.json', cimd.pathname]) {
          expect(matches(from), from).toBe(true);
        }
        for (const from of ['/download/mac', '/app/*', `${cimd.origin}/app`, 'https://placeholder.example/*', '/.well-known/apple-app-site-association']) {
          expect(matches(from), from).toBe(false);
        }
      });

      for (const [name, env] of Object.entries(cases)) {
        it(`emits no _redirects rule for it at any stage when ${name}`, () => {
          // "legacy" has no domain and emits nothing (above).
          for (const stage of ['proxy', 'live', 'redirect']) {
            const froms = netlifyRedirects(hosts({ ...env, stage })).split('\n').filter(Boolean).map((line) => line.split(' ')[0]);
            expect(froms.filter(matches), stage).toEqual([]);
          }
        });
      }

      it('has no forced netlify.toml rule over its path (an unforced rule never shadows a published file)', () => {
        const rules = readFileSync(repoPath('netlify.toml'), 'utf8').split('[[redirects]]').slice(1);
        const forced = rules.filter((rule) => /^\s*force\s*=\s*true/m.test(rule));
        const froms = forced.map((rule) => /^\s*from\s*=\s*"([^"]+)"/m.exec(rule)?.[1] ?? '');
        expect(froms.filter(matches)).toEqual([]);
      });
    });
  });

  describe('social preview (MUT-104)', () => {
    const tags = (origin = 'https://example.com') =>
      Object.fromEntries(
        socialMetaTags(origin).map(({ attrs }) => [String(attrs?.property ?? attrs?.name), String(attrs?.content)]),
      );

    it('builds the card from the Arabic landing hero, so the preview says what the page says (D4, D9)', () => {
      const meta = tags();
      expect(meta['og:title']).toBe(`${ar.landing.hero.headlineLine1} ${ar.landing.hero.headlineLine2}`);
      expect(meta['og:description']).toBe(ar.landing.hero.subheadline);
      expect(meta['og:site_name']).toBe('متابعة');
      expect(meta['og:locale']).toBe('ar_AR');
      expect(meta['og:locale:alternate']).toBe('en_US');
      expect(meta['twitter:title']).toBe(meta['og:title']);
      expect(meta['twitter:description']).toBe(meta['og:description']);
    });

    it('points at the wide Arabic card by absolute URL, at its real size', () => {
      const meta = tags();
      expect(meta['og:url']).toBe('https://example.com/');
      expect(meta['og:image']).toBe('https://example.com/og-card-ar-1200x630.png');
      expect(meta['twitter:image']).toBe(meta['og:image']);
      expect(meta['twitter:card']).toBe('summary_large_image');
      const file = repoPath('public/og-card-ar-1200x630.png');
      expect(pngSize(file)).toEqual([Number(meta['og:image:width']), Number(meta['og:image:height'])]);
      expect(meta['og:image:alt']).toContain('متابعة');
    });

    it('drops a trailing slash from the configured origin', () => {
      expect(tags('https://staging.example.com/')['og:image']).toBe('https://staging.example.com/og-card-ar-1200x630.png');
    });

    it.each(['http://example.com', 'example.com', '', 'https://'])('refuses %j as an origin, failing the build', (origin) => {
      expect(() => socialMetaTags(origin)).toThrow(/MUTABA3A_PUBLIC_ORIGIN/);
    });

    it('adds the tags to the web build only: desktop has no public URL and the portal is noindex', () => {
      expect(pluginNames(resolve('web').plugins)).toContain('mutaba3a:social-meta');
      expect(pluginNames(resolve('desktop').plugins)).not.toContain('mutaba3a:social-meta');
      expect(pluginNames(resolve('hosted').plugins)).not.toContain('mutaba3a:social-meta');
    });

    it('keeps the share cards out of the service worker precache', () => {
      expect(PWA_WORKBOX?.globIgnores).toContain('og-*.png');
    });

    it('hands Vite structured meta attrs (never raw HTML), so <, " and & in the copy get escaped at serialization, not double-escaped here', async () => {
      vi.resetModules();
      vi.doMock('../../src/lib/i18n/translations/ar', () => ({
        default: {
          landing: {
            hero: {
              headlineLine1: '<script>alert(1)</script>',
              headlineLine2: '"quoted" & ampersand',
              subheadline: 'sub & "quoted" <b>bold</b>',
            },
            hostedOffer: { hero: { title: 'h', sub: 's' }, meta: { title: 'm' } },
          },
          common: { pageTitle: '{page}' },
        },
      }));
      try {
        const { socialMetaTags: mockedSocialMetaTags } = await import('../../vite.config');
        const dangerousTags = mockedSocialMetaTags('https://example.com');
        // Every tag is a plain {tag, attrs} descriptor: Vite's serializeTags() HTML-escapes
        // each attrs value (escape-html) when it renders the tag, so the raw string here is correct.
        for (const tag of dangerousTags) {
          expect(tag.tag).toBe('meta');
          expect(tag.attrs).toBeTypeOf('object');
          expect(tag).not.toHaveProperty('html');
          expect(tag).not.toHaveProperty('children');
        }
        const byKey = Object.fromEntries(
          dangerousTags.map(({ attrs }) => [String(attrs?.property ?? attrs?.name), String(attrs?.content)]),
        );
        expect(byKey['og:title']).toBe('<script>alert(1)</script> "quoted" & ampersand');
        expect(byKey['og:description']).toBe('sub & "quoted" <b>bold</b>');
      } finally {
        vi.doUnmock('../../src/lib/i18n/translations/ar');
        vi.resetModules();
      }
    });
  });

  describe('app version (MUT-24)', () => {
    it('is package.json\'s version unless MUTABA3A_APP_VERSION says otherwise', () => {
      expect(appVersion(undefined)).toBe(pkg.version);
      expect(appVersion('0.1.7')).toBe('0.1.7');
      expect(resolve('web').define?.__APP_VERSION__).toBe(JSON.stringify(pkg.version));
    });

    it.each(['v0.1.7', '0.1', '0.1.7-beta', ''])('refuses %j, failing the build', (value) => {
      expect(() => appVersion(value)).toThrow(/MUTABA3A_APP_VERSION/);
    });
  });

  describe('portal sign-in link (MUT-187)', () => {
    it('defines the portal URL for the web build and leaves the desktop build without one', () => {
      expect(resolve('web').define?.__PORTAL_URL__).toBe(JSON.stringify(DEFAULT_PORTAL_URL));
      expect(resolve('desktop').define?.__PORTAL_URL__).toBe(JSON.stringify(''));
    });

    it('defaults to the portal origin config/hosts.json names (MUT-326)', () => {
      expect(portalUrl(undefined)).toBe(DEFAULT_PORTAL_URL);
      expect(DEFAULT_PORTAL_URL).toBe(HOSTS.portalOrigin);
    });

    it('takes MUTABA3A_PORTAL_URL over the default and drops a trailing slash', () => {
      expect(portalUrl('https://portal.example.com/')).toBe('https://portal.example.com');
    });

    it.each(['http://portal.example.com', 'portal.example.com', '', 'https://', 'https://portal.example.com/sign-in'])(
      'refuses %j as the portal URL, failing the build',
      (value) => {
        expect(() => portalUrl(value)).toThrow(/MUTABA3A_PORTAL_URL/);
      },
    );
  });

  describe('portal request link (MUT-188)', () => {
    it('gives the hosted build the public /hosted address, and the local builds none', () => {
      expect(resolve('hosted').define?.__HOSTED_OFFER_URL__).toBe(JSON.stringify(`${DEFAULT_PUBLIC_ORIGIN}/hosted`));
      expect(resolve('web').define).not.toHaveProperty('__HOSTED_OFFER_URL__');
      expect(resolve('desktop').define).not.toHaveProperty('__HOSTED_OFFER_URL__');
    });

    it('links the portal to the landing terms, in the hosted build only (MUT-324)', () => {
      expect(resolve('hosted').define?.__TERMS_URL__).toBe(JSON.stringify(`${DEFAULT_PUBLIC_ORIGIN}/terms`));
      expect(resolve('web').define).not.toHaveProperty('__TERMS_URL__');
      expect(termsUrl('https://staging.example/')).toBe('https://staging.example/terms');
      expect(() => termsUrl('http://x.example')).toThrow();
    });

    it('defaults to the landing origin config/hosts.json names (MUT-326)', () => {
      expect(hostedOfferUrl(undefined)).toBe(`${DEFAULT_PUBLIC_ORIGIN}/hosted`);
      expect(DEFAULT_PUBLIC_ORIGIN).toBe(HOSTS.landingOrigin);
      expect(DEFAULT_PORTAL_URL).toBe(HOSTS.portalOrigin);
    });

    it('takes MUTABA3A_PUBLIC_ORIGIN over the default and drops a trailing slash', () => {
      expect(hostedOfferUrl('https://staging.example/')).toBe('https://staging.example/hosted');
    });

    it.each(['http://x.example', 'x.example', '', 'https://', 'https://x.example/hosted'])(
      'refuses %j as the public origin, failing the hosted build',
      (value) => {
        expect(() => hostedOfferUrl(value)).toThrow(/MUTABA3A_PUBLIC_ORIGIN/);
      },
    );
  });

  describe('Turnstile site key (MUT-368, D6)', () => {
    it('is Cloudflare\'s always-pass test key when MUTABA3A_TURNSTILE_SITE_KEY is unset, so dev, tests and QA need nothing', () => {
      expect(TURNSTILE_TEST_SITE_KEY).toBe('1x00000000000000000000AA');
      expect(turnstileSiteKey(undefined)).toBe(TURNSTILE_TEST_SITE_KEY);
      expect(turnstileSiteKey('')).toBe(TURNSTILE_TEST_SITE_KEY);
    });

    it('takes a real site key, and Cloudflare\'s other test keys', () => {
      expect(turnstileSiteKey('0x4AAAAAAAB1cDeFgHiJkLmN')).toBe('0x4AAAAAAAB1cDeFgHiJkLmN');
      expect(turnstileSiteKey('2x00000000000000000000AB')).toBe('2x00000000000000000000AB');
    });

    it.each(['0x4AAAAAAA', 'sk_live_whatever_0123456789abcdef', '0x4AAAAAAA" + alert(1) + "', '1x0000000000000000000000000000000AA_secret'])(
      'refuses %j, failing the build (a secret or a broken key must never ship)',
      (value) => {
        expect(() => turnstileSiteKey(value)).toThrow(/MUTABA3A_TURNSTILE_SITE_KEY/);
      },
    );

    it('is defined for the portal build only', () => {
      expect(resolve('hosted').define?.__TURNSTILE_SITE_KEY__).toBe(JSON.stringify(TURNSTILE_TEST_SITE_KEY));
      expect(resolve('web').define).not.toHaveProperty('__TURNSTILE_SITE_KEY__');
    });
  });

  describe('PostHog key (MUT-154, ADR-090)', () => {
    const KEY = 'phc_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';

    it('is empty when MUTABA3A_POSTHOG_KEY is unset, so the SDK never starts', () => {
      expect(posthogKey(undefined)).toBe('');
      expect(posthogKey('')).toBe('');
    });

    it('takes a project ingest key', () => {
      expect(posthogKey(KEY)).toBe(KEY);
    });

    it.each(['phx_personal_api_key_0123456789abcdef', 'phc_short', 'phc_has spaces in it 0123456789', 'AbCdEfGhIjKlMnOpQrStUvWxYz'])(
      'refuses %j, failing the build (a personal API key must never ship)',
      (value) => {
        expect(() => posthogKey(value)).toThrow(/MUTABA3A_POSTHOG_KEY/);
      },
    );

    it('keeps the SDK and the guard out of the service worker precache, so the local app never stores them (review F1)', () => {
      expect(PWA_WORKBOX?.globIgnores).toEqual(expect.arrayContaining(POSTHOG_PRECACHE_IGNORES));
      expect(POSTHOG_PRECACHE_IGNORES).toEqual([`assets/${POSTHOG_CHUNK}-*.js`, 'assets/posthogConfig-*.js']);
    });

    it('names the SDK chunk in the web build only; desktop never imports it', () => {
      const chunks = (mode: string) => {
        const output = resolve(mode).build?.rollupOptions?.output;
        return (Array.isArray(output) ? output[0] : output)?.manualChunks as Record<string, string[]>;
      };
      expect(chunks('web')[POSTHOG_CHUNK]).toEqual(['posthog-js']);
      expect(chunks('desktop')).not.toHaveProperty(POSTHOG_CHUNK);
    });

    it('gives the web and hosted builds the key and the desktop build none', () => {
      vi.stubEnv('MUTABA3A_POSTHOG_KEY', KEY);
      try {
        expect(resolve('web').define?.__POSTHOG_KEY__).toBe(JSON.stringify(KEY));
        expect(resolve('hosted').define?.__POSTHOG_KEY__).toBe(JSON.stringify(KEY));
        expect(resolve('desktop').define?.__POSTHOG_KEY__).toBe(JSON.stringify(''));
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  describe('Sentry (MUT-149, ADR-091 am.11)', () => {
    const HOST = new URL(SENTRY_INGEST_ORIGIN).host;
    const DSN = `https://0123456789abcdef0123456789abcdef@${HOST}/4512250374062160`;
    const withEnv = <T,>(env: Record<string, string>, run: () => T): T => {
      for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
      try {
        return run();
      } finally {
        vi.unstubAllEnvs();
      }
    };
    const QUIET = { MUTABA3A_SENTRY_DSN: '', SENTRY_AUTH_TOKEN: '', MUTABA3A_SENTRY_RELEASE: '', MUTABA3A_SENTRY_ENVIRONMENT: '' };

    it('pins the org ingest host on the EU region (D7)', () => {
      expect(SENTRY_INGEST_ORIGIN).toMatch(/^https:\/\/o\d+\.ingest\.de\.sentry\.io$/);
    });

    it('is empty when MUTABA3A_SENTRY_DSN is unset, so the portal reports nothing', () => {
      expect(sentryDsn(undefined)).toBe('');
      expect(sentryDsn('')).toBe('');
    });

    it("takes a DSN on the org's EU ingest host", () => {
      expect(sentryDsn(DSN)).toBe(DSN);
    });

    it.each([
      ['the US region', DSN.replace('.de.', '.')],
      ['another org', DSN.replace(HOST, 'o1.ingest.de.sentry.io')],
      ['sentry.io itself', 'https://0123456789abcdef0123456789abcdef@sentry.io/1'],
      ['plain http', DSN.replace('https:', 'http:')],
      ['not a DSN', 'phc_AbCdEf'],
    ])('refuses %s, failing the build (CSP and DSN must not drift)', (_name, value) => {
      expect(() => sentryDsn(value)).toThrow(/MUTABA3A_SENTRY_DSN/);
    });

    it('names the release after the portal, from deploy.sh or the app version', () => {
      expect(sentryRelease(undefined)).toBe(`mutaba3a-portal@${pkg.version}`);
      expect(sentryRelease('mutaba3a-portal@1.52.0+abc1234')).toBe('mutaba3a-portal@1.52.0+abc1234');
      expect(() => sentryRelease('api@1.0.0')).toThrow(/MUTABA3A_SENTRY_RELEASE/);
    });

    it('takes the environment from deploy.sh, development otherwise', () => {
      expect(sentryEnvironment(undefined)).toBe('development');
      expect(sentryEnvironment('production')).toBe('production');
      expect(() => sentryEnvironment('Prod Env')).toThrow(/MUTABA3A_SENTRY_ENVIRONMENT/);
    });

    it('turns the gate on in the hosted build only when a DSN is set', () => {
      withEnv({ ...QUIET, MUTABA3A_SENTRY_DSN: DSN }, () => {
        const define = resolve('hosted').define;
        expect(define?.__SENTRY_ENABLED__).toBe('true');
        expect(define?.__SENTRY_DSN__).toBe(JSON.stringify(DSN));
      });
      withEnv(QUIET, () => {
        expect(resolve('hosted').define?.__SENTRY_ENABLED__).toBe('false');
        expect(resolve('hosted').define?.__SENTRY_DSN__).toBe(JSON.stringify(''));
      });
    });

    it.each(['web', 'desktop'])('gives the %s build no Sentry define at all (AC1)', (mode) => {
      withEnv({ ...QUIET, MUTABA3A_SENTRY_DSN: DSN, SENTRY_AUTH_TOKEN: 'sntrys_test' }, () => {
        expect(Object.keys(resolve(mode).define ?? {}).filter((key) => key.includes('SENTRY'))).toEqual([]);
        expect(pluginNames(resolve(mode).plugins)).not.toContain('sentry-vite-plugin');
      });
    });

    it('uploads hidden source maps only with a DSN and an upload token (AC4, D6)', () => {
      withEnv({ ...QUIET, MUTABA3A_SENTRY_DSN: DSN, SENTRY_AUTH_TOKEN: 'sntrys_test' }, () => {
        const config = resolve('hosted');
        expect(config.build?.sourcemap).toBe('hidden');
        expect(pluginNames(config.plugins)).toContain('sentry-vite-plugin');
      });
      for (const env of [QUIET, { ...QUIET, MUTABA3A_SENTRY_DSN: DSN }, { ...QUIET, SENTRY_AUTH_TOKEN: 'sntrys_test' }]) {
        withEnv(env, () => {
          const config = resolve('hosted');
          expect(config.build?.sourcemap ?? false).toBe(false);
          expect(pluginNames(config.plugins)).not.toContain('sentry-vite-plugin');
        });
      }
    });
  });

  describe('Netlify form twin (MUT-186)', () => {
    const plugin = () => {
      const found = (resolve('web').plugins ?? []).flat().find((p) => p && typeof p === 'object' && 'name' in p && p.name === 'mutaba3a:netlify-forms');
      if (!found) throw new Error('netlify-forms plugin missing from the web build');
      return found as { generateBundle: (this: { emitFile: (file: unknown) => void }) => void };
    };
    const html = () => netlifyFormsHtml();
    const formTag = () => html().match(/<form\b[^>]*>/)?.[0] ?? '';
    const formBody = () => html().match(/<form\b[^>]*>([\s\S]*?)<\/form>/)?.[1] ?? '';

    it('declares the request form for Netlify, hidden, with its honeypot', () => {
      expect(formTag()).toContain(`name="${HOSTED_REQUEST_FORM_NAME}"`);
      expect(formTag()).toContain('data-netlify="true"');
      expect(formTag()).toContain(`netlify-honeypot="${HONEYPOT_FIELD}"`);
      expect(formTag()).toMatch(/\bhidden\b/);
    });

    it('names exactly the fields the page posts, so Netlify keeps every one', () => {
      const names = [...formBody().matchAll(/\bname="([^"]+)"/g)].map((m) => m[1]);
      expect(names).toEqual([...HOSTED_REQUEST_FIELDS]);
    });

    it('asks search engines not to index the bare form page (D2)', () => {
      expect(html()).toContain('<meta name="robots" content="noindex">');
    });

    it('emits the twin as __forms.html, the path the page posts to', () => {
      const emitFile = vi.fn();
      plugin().generateBundle.call({ emitFile });
      expect(emitFile).toHaveBeenCalledWith({ type: 'asset', fileName: NETLIFY_FORMS_PATH.slice(1), source: netlifyFormsHtml() });
    });

    it('runs in the web build only: desktop and the portal are not served by Netlify', () => {
      expect(pluginNames(resolve('desktop').plugins)).not.toContain('mutaba3a:netlify-forms');
      expect(pluginNames(resolve('hosted').plugins)).not.toContain('mutaba3a:netlify-forms');
    });

    it('serves the app shell for /hosted in dev, not the portal entry hosted.html beside it', () => {
      const found = (resolve('web').plugins ?? []).flat().find((p) => p && typeof p === 'object' && 'name' in p && p.name === 'mutaba3a:hosted-offer-dev-route');
      if (!found) throw new Error('hosted-offer-dev-route plugin missing from the web build');
      let handler: ((req: { url?: string }, res: unknown, next: () => void) => void) | undefined;
      (found as { configureServer: (server: unknown) => void }).configureServer({ middlewares: { use: (fn: typeof handler) => (handler = fn) } });
      const route = (url: string) => {
        const req = { url };
        handler!(req, {}, () => {});
        return req.url;
      };
      expect(route('/hosted')).toBe('/index.html');
      expect(route('/hosted?x=1')).toBe('/index.html?x=1');
      expect(route('/hosted.html')).toBe('/hosted.html');
      expect(route('/app/hosted')).toBe('/app/hosted');
      expect(pluginNames(resolve('desktop').plugins)).not.toContain('mutaba3a:hosted-offer-dev-route');
      expect(pluginNames(resolve('hosted').plugins)).not.toContain('mutaba3a:hosted-offer-dev-route');
    });

    it('keeps the twin out of the service worker precache (D2)', () => {
      expect(PWA_WORKBOX?.globIgnores).toContain(NETLIFY_FORMS_PATH.slice(1));
    });
  });

  describe('link preview (MUT-104)', () => {
    const meta = (tags: ReturnType<typeof socialMetaTags>) =>
      Object.fromEntries(tags.map(({ attrs }) => [String(attrs?.property ?? attrs?.name), String(attrs?.content)]));

    it('keeps the home card as it was when no page is given', () => {
      expect(meta(socialMetaTags('https://example.com'))['og:url']).toBe('https://example.com/');
    });

    const INDEX = [
      '<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>متابعة</title>',
      '<meta property="og:url" content="https://example.com/">',
      '<meta property="og:title" content="home">',
      '<meta name="twitter:title" content="home">',
      '<script type="module" src="/assets/index-abc.js"></script></head><body><div id="root"></div></body></html>',
    ].join('\n');

    it('swaps every link-preview tag and the title, and keeps the app\'s scripts', () => {
      const html = withPageMeta(INDEX, socialMetaTags('https://example.com'), 'متابعة', 'https://example.com/');
      expect(html).toContain('<meta property="og:url" content="https://example.com/">');
      expect(html).toContain('<title>متابعة</title>');
      expect(html).toContain('<link rel="canonical" href="https://example.com/">');
      expect(html).toContain('<script type="module" src="/assets/index-abc.js"></script>');
      expect(html.match(/property="og:title"/g)).toHaveLength(1);
    });

    it('escapes what it writes into attributes and the title', () => {
      const html = withPageMeta(INDEX, [{ tag: 'meta', attrs: { property: 'og:title', content: '"<b>&' } }], 'a<b>&"', 'https://x.test/');
      expect(html).toContain('content="&quot;&lt;b&gt;&amp;"');
      expect(html).toContain('<title>a&lt;b&gt;&amp;&quot;</title>');
    });

    it('writes a $ in copy literally, never as a replacement pattern', () => {
      const html = withPageMeta(INDEX, [{ tag: 'meta', attrs: { property: 'og:title', content: "$& $` $' $1" } }], 'from $&', 'https://x.test/');
      expect(html).toContain("content=\"$&amp; $` $' $1\"");
      expect(html).toContain('<title>from $&amp;</title>');
      expect(html.match(/<\/head>/g)).toHaveLength(1);
    });

    // /hosted (the free-vs-hosted comparison) is retired: hosted is the only plan, and
    // its request form lives inline on the home page now (landing rewrite, MUT-186 superseded).
    it('redirects /hosted straight to the homepage, ahead of the SPA catch-all', () => {
      const toml = readFileSync(repoPath('netlify.toml'), 'utf8');
      const hostedRule = toml.indexOf(`from = "/hosted"\n  to = "/"\n  status = 301`);
      expect(hostedRule).toBeGreaterThan(-1);
      expect(hostedRule).toBeLessThan(toml.indexOf('from = "/*"'));
      expect(pluginNames(resolve('web').plugins)).not.toContain('mutaba3a:hosted-offer-html');
    });
  });

  describe('hosted', () => {
    const config = resolve('hosted');

    it('builds to dist-hosted from hosted.html, with its own public dir', () => {
      expect(config.build?.outDir).toBe('dist-hosted');
      expect(String(config.build?.rollupOptions?.input)).toMatch(/hosted\.html$/);
      expect(config.publicDir).toBe('src/hosted/public');
      expect(config.base).toBe('/');
      expect(config.define?.__BUILD_MODE__).toBe(JSON.stringify('hosted'));
    });

    it('loads no PWA plugin (no service worker, no cache) and emits the entry as index.html', () => {
      const names = pluginNames(config.plugins);
      expect(names.some((n) => n.startsWith('vite-plugin-pwa'))).toBe(false);
      expect(names).toContain('mutaba3a:hosted-index');
    });

    it('proxies /v1 to the API in dev so the session cookie stays same-origin', () => {
      const proxy = config.server?.proxy as Record<string, { target: string }>;
      expect(proxy['/v1'].target).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(config.server?.port).not.toBe(5173);
    });
  });

  describe('server modules get their Buffer per module in the hosted build (MUT-287)', () => {
    type Transform = (code: string, id: string) => { code: string; map: null } | null;
    const transform = scopeServerBufferShim().transform as unknown as Transform;

    it('binds Buffer in a server module that uses it, at the end so nothing else moves', () => {
      const code = "export const encode = (s) => Buffer.from(s, 'utf8').toString('base64url');";
      const out = transform(code, '/repo/server/src/expenses/cursor.ts');
      expect(out?.code.startsWith(code)).toBe(true);
      expect(out?.code).toMatch(/\nimport \{ bufferShim as Buffer \} from ".*src\/hosted\/local\/platform\/buffer-shim\.ts";\n$/);
      expect(out?.map).toBeNull();
    });

    it('leaves dependencies, non-server modules and code without Buffer alone', () => {
      expect(transform('Buffer.from(x)', '/repo/node_modules/hono/server/src/a.js')).toBeNull();
      expect(transform('Buffer.from(x)', '/repo/src/hosted/api/client.ts')).toBeNull();
      expect(transform('export const view = new Uint8Array(new ArrayBuffer(4));', '/repo/server/src/a.ts')).toBeNull();
    });

    it('is in the hosted build and in no other', () => {
      expect(pluginNames(resolve('hosted').plugins)).toContain('mut-scope-server-buffer-shim');
      expect(pluginNames(resolve('web').plugins)).not.toContain('mut-scope-server-buffer-shim');
      expect(pluginNames(resolve('desktop').plugins)).not.toContain('mut-scope-server-buffer-shim');
    });
  });
});
