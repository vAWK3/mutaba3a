// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import tokens from '../../src/styles/brand/mutaba3a.tokens.json';
import { repoPath } from '../../src/test/css/brandCss';
import { pngSize } from '../../src/test/pngSize';

/**
 * Brand v2 browser chrome (MUT-104): the icons and colours both entry HTML
 * files hand to the browser, and the favicon they point at.
 */

const LIGHT_CANVAS = tokens.color.canvas.hex;
const DARK_CANVAS = tokens.colorDark.canvas.hex;

function head(file: string): Document {
  return new JSDOM(readFileSync(repoPath(file), 'utf8')).window.document;
}

/**
 * The web app serves `public/` at the root; the portal's publicDir is
 * `src/hosted/public`, so `hosted.html` links `./public/…` and Vite bundles
 * those files into hashed `/assets/*`, the only path the portal caches (D3).
 */
const ENTRIES = [
  { file: 'index.html', resolve: (href: string) => repoPath(`public${href}`) },
  { file: 'hosted.html', resolve: (href: string) => repoPath(href) },
] as const;

const ICONS = [
  { rel: 'icon', type: 'image/svg+xml', name: 'favicon.svg' },
  { rel: 'icon', type: 'image/png', name: 'favicon-32.png', sizes: '32x32' },
  { rel: 'icon', type: 'image/png', name: 'favicon-16.png', sizes: '16x16' },
  { rel: 'apple-touch-icon', name: 'apple-touch-icon.png', sizes: '180x180' },
] as const;

describe.each(ENTRIES)('$file head (MUT-104)', ({ file, resolve }) => {
  const doc = head(file);

  it.each(ICONS)('links $name as $rel, and the file exists at that size', (icon) => {
    const link = [...doc.querySelectorAll<HTMLLinkElement>(`link[rel="${icon.rel}"]`)].find((l) =>
      l.getAttribute('href')?.endsWith(`/${icon.name}`),
    );
    expect(link, `${file} has no ${icon.rel} link to ${icon.name}`).toBeDefined();
    const path = resolve(link!.getAttribute('href')!);
    expect(existsSync(path), path).toBe(true);
    if ('type' in icon) expect(link!.getAttribute('type')).toBe(icon.type);
    if ('sizes' in icon) {
      expect(link!.getAttribute('sizes')).toBe(icon.sizes);
      expect(pngSize(path).join('x')).toBe(icon.sizes);
    }
  });

  it('sets theme-color to the light and dark canvas from the token file', () => {
    const metas = [...doc.querySelectorAll('meta[name="theme-color"]')].map((m) => [
      m.getAttribute('media'),
      m.getAttribute('content'),
    ]);
    expect(metas).toEqual([
      ['(prefers-color-scheme: light)', LIGHT_CANVAS],
      ['(prefers-color-scheme: dark)', DARK_CANVAS],
    ]);
  });

  it('declares no manifest by hand (VitePWA injects it in the web build; desktop and portal have none)', () => {
    expect(doc.querySelector('link[rel="manifest"]')).toBeNull();
  });
});

describe('hosted.html (MUT-104, D3)', () => {
  it('links the shared public/ copies, so the portal keeps no duplicate favicon', () => {
    const hrefs = [...head('hosted.html').querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')].map(
      (l) => l.getAttribute('href'),
    );
    expect(hrefs.every((href) => href?.startsWith('./public/'))).toBe(true);
    expect(existsSync(repoPath('src/hosted/public/favicon.svg'))).toBe(false);
  });
});

describe('hosted.html referrer (MUT-188)', () => {
  it('sends no referrer across origins, so the sign-in page can link out without leaking ?next= paths', () => {
    expect(head('hosted.html').querySelector('meta[name="referrer"]')?.getAttribute('content')).toBe('same-origin');
  });
});

describe('favicon.svg (MUT-104)', () => {
  const svg = readFileSync(repoPath('public/favicon.svg'), 'utf8');
  const style = /<style>([\s\S]*?)<\/style>/.exec(svg)?.[1] ?? '';

  it('styles every class it uses, so no shape falls back to black (the delivered tile did)', () => {
    const classes = [...svg.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/));
    expect(classes.length).toBeGreaterThan(0);
    for (const name of classes) expect(style, `.${name} has no rule`).toMatch(new RegExp(`\\.${name}\\b[^{]*\\{`));
  });

  it('repaints the tile for a dark browser theme', () => {
    const dark = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([\s\S]*)\}/.exec(style)?.[1] ?? '';
    expect(dark).toMatch(/\.t\s*\{[^}]*fill:\s*#221B2D/i);
  });

  it('ships no provenance blob (an edited file would carry a stale C2PA claim)', () => {
    expect(svg).not.toMatch(/c2pa|<metadata/i);
  });
});

describe('desktop icons (MUT-104, D2)', () => {
  const conf = JSON.parse(readFileSync(repoPath('src-tauri/tauri.conf.json'), 'utf8')) as { bundle: { icon: string[] } };
  const scripts = (JSON.parse(readFileSync(repoPath('package.json'), 'utf8')) as { scripts: Record<string, string> })
    .scripts;

  it.each(conf.bundle.icon)('ships %s, at the size its name promises', (icon) => {
    const file = repoPath(`src-tauri/${icon}`);
    expect(existsSync(file), file).toBe(true);
    const size = /(\d+)x(\d+)(@2x)?\.png$/.exec(icon);
    if (size) {
      const scale = size[3] ? 2 : 1;
      expect(pngSize(file)).toEqual([Number(size[1]) * scale, Number(size[2]) * scale]);
    }
  });

  it('regenerates every desktop icon from the delivered full-bleed Brand v2 art', () => {
    expect(scripts['icons:desktop']).toMatch(/^tauri icon public\/icons\/icon-1024\.png\b/);
  });

  it('keeps no mobile or stale icons: there is no Tauri mobile target and the phone app is Flutter', () => {
    for (const leftover of ['android', 'ios', 'icon-1024.png']) {
      expect(existsSync(repoPath(`src-tauri/icons/${leftover}`)), leftover).toBe(false);
    }
  });
});
