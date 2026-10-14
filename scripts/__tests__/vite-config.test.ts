// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { ConfigEnv, PluginOption, UserConfig } from 'vite';
import { existsSync } from 'node:fs';
import configFn, { PWA_INCLUDE_ASSETS, PWA_MANIFEST, PWA_WORKBOX, netlifyFormsHtml, socialMetaTags } from '../../vite.config';
import {
  HONEYPOT_FIELD,
  HOSTED_REQUEST_FIELDS,
  HOSTED_REQUEST_FORM_NAME,
  NETLIFY_FORMS_PATH,
} from '../../src/pages/landing/hostedRequest';
import ar from '../../src/lib/i18n/translations/ar.json';
import tokens from '../../src/styles/brand/mutaba3a.tokens.json';
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
    expect(comparable(resolve(mode))).toMatchSnapshot();
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
      vi.doMock('../../src/lib/i18n/translations/ar.json', () => ({
        default: {
          landing: {
            hero: {
              headlineLine1: '<script>alert(1)</script>',
              headlineLine2: '"quoted" & ampersand',
              subheadline: 'sub & "quoted" <b>bold</b>',
            },
          },
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
        vi.doUnmock('../../src/lib/i18n/translations/ar.json');
        vi.resetModules();
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

    it('keeps the twin out of the service worker precache (D2)', () => {
      expect(PWA_WORKBOX?.globIgnores).toContain(NETLIFY_FORMS_PATH.slice(1));
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
