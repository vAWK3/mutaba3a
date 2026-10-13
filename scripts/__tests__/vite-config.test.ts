// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { ConfigEnv, PluginOption, UserConfig } from 'vite';
import { existsSync } from 'node:fs';
import configFn, { PWA_INCLUDE_ASSETS, PWA_MANIFEST, PWA_WORKBOX } from '../../vite.config';
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
