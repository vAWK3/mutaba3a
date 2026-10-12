// @vitest-environment node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fontFaces, repoPath } from '../../test/css/brandCss';

/**
 * Brand v2 foundation (MUT-102): the contracts the token file and the fonts
 * keep. One `describe` per contract (eng review D2).
 */

/**
 * The delivered Thmanyah files, pinned by sha256. The licence forbids any
 * modification (no subsetting, no woff2), so a changed hash is a licence
 * problem, not a refresh. Re-pin only when Thmanyah's official files replace
 * these (the Serif Display provenance gap on MUT-102).
 */
const THMANYAH_SHA256: Record<string, string> = {
  'thmanyahsans-Regular.otf': 'f45a420632384b42a37ec9b24298ddc6502faa52d55d973144779262ebc023dc',
  'thmanyahsans-Medium.otf': 'f2762ffbe17351193e3d630dd10f0c3a965e6c873998dfdeda2bd0dcad7985c6',
  'thmanyahsans-Bold.otf': '72cc27021cc1a503e5c03b072df8b16d55c78983e5fd73a4cdf92b5a600af2f7',
  'thmanyah-serif-display-regular.otf': '1f5c735a6c05cce9fe9b2459d5aedb1d039541d50b726304bd617a69587bf112',
  'thmanyah-serif-display-bold.otf': 'ac2f056441891276792ab6d828d8ad9169ef44ecea60d6ccf126b25361f0ee9d',
};

const FONTS_DIR = repoPath('src/assets/fonts');
const FONTS_CSS = repoPath('src/styles/brand/fonts.css');

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

describe('fonts', () => {
  it.each(Object.entries(THMANYAH_SHA256))('bundles %s byte-identical to the delivered file', (name, hash) => {
    expect(sha256(`${FONTS_DIR}/${name}`)).toBe(hash);
  });

  it('keeps no Thmanyah copy in public/ (the portal cannot see it; one location only)', () => {
    expect(readdirSync(repoPath('public/fonts')).filter((name) => /thmanyah/i.test(name))).toEqual([]);
  });

  it('declares Thmanyah Sans 400/500/700 and Serif Display 400/700, all swap, all from the bundled files', () => {
    const faces = fontFaces(FONTS_CSS).map((face) => ({
      family: face.family,
      weight: face.weight,
      style: face.style,
      display: face.display,
      files: face.files.map((file) => basename(file)),
    }));
    expect(faces).toEqual([
      { family: 'Thmanyah Sans', weight: '400', style: 'normal', display: 'swap', files: ['thmanyahsans-Regular.otf'] },
      { family: 'Thmanyah Sans', weight: '500', style: 'normal', display: 'swap', files: ['thmanyahsans-Medium.otf'] },
      { family: 'Thmanyah Sans', weight: '700', style: 'normal', display: 'swap', files: ['thmanyahsans-Bold.otf'] },
      { family: 'Thmanyah Serif Display', weight: '400', style: 'normal', display: 'swap', files: ['thmanyah-serif-display-regular.otf'] },
      { family: 'Thmanyah Serif Display', weight: '700', style: 'normal', display: 'swap', files: ['thmanyah-serif-display-bold.otf'] },
    ]);
    for (const face of fontFaces(FONTS_CSS)) for (const file of face.files) expect(existsSync(file), file).toBe(true);
  });

  it('loads Plex Mono 400/500 from @fontsource (OFL woff2), not from a CDN', () => {
    const css = readFileSync(FONTS_CSS, 'utf8');
    const imports = [...css.matchAll(/@import\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(imports).toEqual(['@fontsource/ibm-plex-mono/400.css', '@fontsource/ibm-plex-mono/500.css']);
    expect(css).not.toMatch(/https?:\/\//);
  });
});
