// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { ConfigEnv, PluginOption, UserConfig } from 'vite';
import type { OutputAsset, OutputBundle, OutputChunk } from 'rollup';
import configFn, { BRAND_PRELOAD_FONT, PWA_WORKBOX, findEmittedAsset, fontPreloadTag } from '../../vite.config';

/**
 * hosted-portal.md §8: the hosted build target is additive. The `web` and
 * `desktop` configs were snapshotted before the `hosted` branch existed, so any
 * change to them fails here first. Updated on purpose by MUT-102 (font preload
 * plugin, PWA font runtime cache); the release version is masked so a release
 * bump doesn't break it.
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

function asset(fileName: string, originalFileNames: string[]): OutputAsset {
  return { type: 'asset', fileName, originalFileNames, names: [], originalFileName: originalFileNames[0] ?? null, name: undefined, needsCodeReference: false, source: '' };
}

describe('vite.config', () => {
  it.each(['web', 'desktop'])('leaves the %s build exactly as it was', (mode) => {
    expect(comparable(resolve(mode))).toMatchSnapshot();
  });

  describe('brand fonts (MUT-102)', () => {
    it.each(['web', 'desktop', 'hosted'])('the %s build preloads the body face', (mode) => {
      expect(pluginNames(resolve(mode).plugins)).toContain('mutaba3a:brand-font-preload');
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

    it('finds the emitted font by its source path', () => {
      const bundle = {
        'assets/index-abc.js': { type: 'chunk', fileName: 'assets/index-abc.js' } as OutputChunk,
        'assets/thmanyahsans-Bold-x1.otf': asset('assets/thmanyahsans-Bold-x1.otf', ['src/assets/fonts/thmanyahsans-Bold.otf']),
        'assets/thmanyahsans-Regular-Ab12.otf': asset('assets/thmanyahsans-Regular-Ab12.otf', [BRAND_PRELOAD_FONT]),
      } as OutputBundle;
      expect(findEmittedAsset(bundle, BRAND_PRELOAD_FONT)).toBe('assets/thmanyahsans-Regular-Ab12.otf');
    });

    it('fails the build when the preloaded font was not emitted', () => {
      expect(() => findEmittedAsset({} as OutputBundle, BRAND_PRELOAD_FONT)).toThrow(BRAND_PRELOAD_FONT);
    });

    it('builds a crossorigin font preload with the build base', () => {
      expect(fontPreloadTag('./', 'assets/a.otf')).toEqual({
        tag: 'link',
        attrs: { rel: 'preload', as: 'font', type: 'font/otf', href: './assets/a.otf', crossorigin: true },
        injectTo: 'head',
      });
      expect(fontPreloadTag('/', 'assets/a.otf').attrs?.href).toBe('/assets/a.otf');
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
