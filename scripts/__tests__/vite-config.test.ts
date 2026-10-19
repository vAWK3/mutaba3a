// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { ConfigEnv, PluginOption, UserConfig } from 'vite';
import { existsSync } from 'node:fs';
import configFn, {
  DEFAULT_PORTAL_URL,
  DEFAULT_PUBLIC_ORIGIN,
  HOSTED_OFFER_FILE,
  HOSTED_OFFER_PAGE,
  HOSTED_OFFER_TITLE,
  hostedOfferUrl,
  PWA_INCLUDE_ASSETS,
  PWA_MANIFEST,
  PWA_WORKBOX,
  POSTHOG_CHUNK,
  POSTHOG_PRECACHE_IGNORES,
  appVersion,
  netlifyFormsHtml,
  portalUrl,
  posthogKey,
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

function comparable(config: UserConfig) {
  return { ...config, define: { ...config.define, __APP_VERSION__: '<package.json version>' }, plugins: pluginNames(config.plugins) };
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

  describe('social preview (MUT-104)', () => {
    const tags = (origin = 'https://mutaba3a.app') =>
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
      expect(meta['og:url']).toBe('https://mutaba3a.app/');
      expect(meta['og:image']).toBe('https://mutaba3a.app/og-card-ar-1200x630.png');
      expect(meta['twitter:image']).toBe(meta['og:image']);
      expect(meta['twitter:card']).toBe('summary_large_image');
      const file = repoPath('public/og-card-ar-1200x630.png');
      expect(pngSize(file)).toEqual([Number(meta['og:image:width']), Number(meta['og:image:height'])]);
      expect(meta['og:image:alt']).toContain('متابعة');
    });

    it('drops a trailing slash from the configured origin', () => {
      expect(tags('https://staging.mutaba3a.app/')['og:image']).toBe('https://staging.mutaba3a.app/og-card-ar-1200x630.png');
    });

    it.each(['http://mutaba3a.app', 'mutaba3a.app', '', 'https://'])('refuses %j as an origin, failing the build', (origin) => {
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
        const dangerousTags = mockedSocialMetaTags('https://mutaba3a.app');
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

    it('defaults to the Cloud Run service that serves the portal', () => {
      expect(portalUrl(undefined)).toBe(DEFAULT_PORTAL_URL);
      expect(DEFAULT_PORTAL_URL).toMatch(/^https:\/\/[^/]+\.run\.app$/);
    });

    it('takes MUTABA3A_PORTAL_URL over the default and drops a trailing slash', () => {
      expect(portalUrl('https://portal.mutaba3a.app/')).toBe('https://portal.mutaba3a.app');
    });

    it.each(['http://portal.mutaba3a.app', 'portal.mutaba3a.app', '', 'https://', 'https://portal.mutaba3a.app/sign-in'])(
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

    it('defaults to the Netlify origin until the custom domain has DNS (MUT-112)', () => {
      expect(hostedOfferUrl(undefined)).toBe(`${DEFAULT_PUBLIC_ORIGIN}/hosted`);
      expect(DEFAULT_PUBLIC_ORIGIN).toMatch(/^https:\/\/[^/]+\.netlify\.app$/);
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

  describe('/hosted link preview (MUT-186 review, F7)', () => {
    const meta = (tags: ReturnType<typeof socialMetaTags>) =>
      Object.fromEntries(tags.map(({ attrs }) => [String(attrs?.property ?? attrs?.name), String(attrs?.content)]));

    it('builds the /hosted card from the Arabic /hosted hero, pointing at /hosted', () => {
      const tags = meta(socialMetaTags('https://mutaba3a.app', HOSTED_OFFER_PAGE));
      expect(tags['og:url']).toBe('https://mutaba3a.app/hosted');
      expect(tags['og:title']).toBe(ar.landing.hostedOffer.hero.title);
      expect(tags['og:description']).toBe(ar.landing.hostedOffer.hero.sub);
      expect(tags['twitter:title']).toBe(tags['og:title']);
      expect(tags['og:image']).toBe('https://mutaba3a.app/og-card-ar-1200x630.png');
    });

    it('keeps the home card as it was when no page is given', () => {
      expect(meta(socialMetaTags('https://mutaba3a.app'))['og:url']).toBe('https://mutaba3a.app/');
    });

    const INDEX = [
      '<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>متابعة</title>',
      '<meta property="og:url" content="https://mutaba3a.app/">',
      '<meta property="og:title" content="home">',
      '<meta name="twitter:title" content="home">',
      '<script type="module" src="/assets/index-abc.js"></script></head><body><div id="root"></div></body></html>',
    ].join('\n');

    it('swaps every link-preview tag and the title, and keeps the app\'s scripts', () => {
      const html = withPageMeta(INDEX, socialMetaTags('https://mutaba3a.app', HOSTED_OFFER_PAGE), HOSTED_OFFER_TITLE, 'https://mutaba3a.app/hosted');
      expect(html).not.toContain('content="home"');
      expect(html).not.toContain('content="https://mutaba3a.app/"');
      expect(html).toContain('<meta property="og:url" content="https://mutaba3a.app/hosted">');
      expect(html).toContain(`<title>${HOSTED_OFFER_TITLE}</title>`);
      expect(html).toContain('<link rel="canonical" href="https://mutaba3a.app/hosted">');
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

    it('describes the share image for what it shows (the home card), on every page', () => {
      const alt = meta(socialMetaTags('https://mutaba3a.app', HOSTED_OFFER_PAGE))['og:image:alt'];
      expect(alt).toBe(meta(socialMetaTags('https://mutaba3a.app'))['og:image:alt']);
      expect(alt).toContain(ar.landing.hero.headlineLine1);
    });

    it('emits the page as hosted-offer.html beside index.html, in the web build only', () => {
      const found = (resolve('web').plugins ?? []).flat().find((p) => p && typeof p === 'object' && 'name' in p && p.name === 'mutaba3a:hosted-offer-html');
      if (!found) throw new Error('hosted-offer-html plugin missing from the web build');
      const emitFile = vi.fn();
      const bundle = { 'index.html': { type: 'asset', fileName: 'index.html', source: INDEX } };
      (found as { generateBundle: (this: unknown, o: unknown, b: unknown) => void }).generateBundle.call({ emitFile }, {}, bundle);
      expect(emitFile).toHaveBeenCalledWith(expect.objectContaining({ type: 'asset', fileName: HOSTED_OFFER_FILE }));
      expect(String(emitFile.mock.calls[0][0].source)).toContain(`content="${DEFAULT_PUBLIC_ORIGIN}/hosted"`);
      expect(pluginNames(resolve('desktop').plugins)).not.toContain('mutaba3a:hosted-offer-html');
      expect(pluginNames(resolve('hosted').plugins)).not.toContain('mutaba3a:hosted-offer-html');
    });

    // MUT-207: /hosted is a copy of the built index.html, so it opens on the same boot splash.
    it('keeps the boot splash and its stylesheet in the /hosted copy', () => {
      const found = (resolve('web').plugins ?? []).flat().find((p) => p && typeof p === 'object' && 'name' in p && p.name === 'mutaba3a:hosted-offer-html');
      const emitFile = vi.fn();
      const splash = '<div id="root"><div class="boot-splash" aria-hidden="true"><picture><source srcset="/assets/mark-dark-x.svg" media="(prefers-color-scheme: dark)"><img class="boot-splash-mark" src="/assets/mark-x.svg" width="80" height="80" alt=""></picture></div></div>';
      const index = INDEX.replace('<div id="root"></div>', splash).replace('</head>', '<link rel="stylesheet" crossorigin href="/assets/index-x.css"></head>');
      const bundle = { 'index.html': { type: 'asset', fileName: 'index.html', source: index } };
      (found as { generateBundle: (this: unknown, o: unknown, b: unknown) => void }).generateBundle.call({ emitFile }, {}, bundle);
      const copy = String(emitFile.mock.calls[0][0].source);
      expect(copy).toContain(splash);
      expect(copy).toContain('<link rel="stylesheet" crossorigin href="/assets/index-x.css">');
    });

    it('is served at /hosted by Netlify, ahead of the SPA catch-all, and never precached', () => {
      const toml = readFileSync(repoPath('netlify.toml'), 'utf8');
      const hostedRule = toml.indexOf(`from = "/hosted"\n  to = "/${HOSTED_OFFER_FILE}"\n  status = 200`);
      expect(hostedRule).toBeGreaterThan(-1);
      expect(hostedRule).toBeLessThan(toml.indexOf('from = "/*"'));
      expect(PWA_WORKBOX?.globIgnores).toContain(HOSTED_OFFER_FILE);
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
});
