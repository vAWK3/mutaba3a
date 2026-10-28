import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TEMPLATE_IDS } from '../ports.js';
import { ART_FILES, artFor, LOOK, MAIL_ART_PATH } from '../templates/look.js';
import V1_HASHES from './mail-art-v1.sha256.json' with { type: 'json' };
import { decodePng, pngHeader } from './png.js';

/**
 * MUT-468: every customer mail has a look, and every picture a look names ships in the portal build
 * (src/hosted/public<MAIL_ART_PATH>, served at <PORTAL_ORIGIN><MAIL_ART_PATH>). A missing file would answer the SPA shell.
 * MUT-484: the served art is transparent, so no pale square shows on a dark-mode band; v1 stays as sent. Its pale outline
 * in dark mode is the kit's halo, drawn on purpose (Basel's call), so edge colours are not checked.
 */
const PUBLIC_DIR = fileURLToPath(new URL('../../../../src/hosted/public/', import.meta.url));
const ART_DIR = PUBLIC_DIR + MAIL_ART_PATH.replace(/^\//, '');
const V1_DIR = PUBLIC_DIR + 'mail/v1/';
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_BYTES = 40_000;
const ARABIC = /[؀-ۿ]/;

describe('mail looks (MUT-468)', () => {
  it('give every customer mail a look, and the operator digest none', () => {
    const customer = TEMPLATE_IDS.filter((id) => id !== 'review-digest');
    expect(Object.keys(LOOK).sort()).toEqual([...customer].sort());
    expect('review-digest' in LOOK).toBe(false);
  });

  it('ship every file a look names', () => {
    const shipped = new Set(readdirSync(ART_DIR));
    for (const file of ART_FILES) expect(shipped.has(file), file).toBe(true);
  });

  // Every file in the folder, the art MUT-469 reserves included: all are served and cached for a year.
  it.each(readdirSync(ART_DIR))('ship %s as a PNG under 40 KB', (file) => {
    const path = ART_DIR + file;
    const bytes = readFileSync(path);
    expect([...bytes.subarray(0, PNG_SIGNATURE.length)]).toEqual(PNG_SIGNATURE);
    expect(statSync(path).size).toBeLessThan(MAX_BYTES);
  });

  it('name every picture in both languages', () => {
    for (const look of Object.values(LOOK)) {
      for (const locale of ['en', 'ar'] as const) {
        const { header, chip } = artFor(look, locale);
        for (const picture of [header, chip]) {
          expect(picture.alt.trim()).toBeTruthy();
          expect(ARABIC.test(picture.alt)).toBe(locale === 'ar');
        }
      }
    }
  });
});

describe('mail art is transparent and clean (MUT-484)', () => {
  it('serves a version other than v1', () => {
    expect(MAIL_ART_PATH).not.toBe('/mail/v1/');
  });

  it('reads alpha for real: the opaque v1 header is solid at its corner', () => {
    // A control for the checks below, so a reader that returned zeros could not pass them.
    const v1 = decodePng(readFileSync(V1_DIR + 'mail-header-hello-spot-email-2x.png'));
    expect(v1.data[3]).toBe(255);
  });

  // Every file in the served folder, the art MUT-469 reserves included.
  describe.each(readdirSync(ART_DIR))('%s', (file) => {
    const bytes = readFileSync(ART_DIR + file);
    const image = decodePng(bytes);
    const alphaAt = (x: number, y: number) => image.data[(y * image.width + x) * 4 + 3]!;
    const { width: w, height: h } = image;
    const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]] as const;
    const midEdges = [[w >> 1, 0], [w >> 1, h - 1], [0, h >> 1], [w - 1, h >> 1]] as const;

    it('is 8-bit RGBA, non-interlaced', () => {
      expect(pngHeader(bytes)).toMatchObject({ bitDepth: 8, colourType: 6, interlace: 0 });
    });

    it('is transparent at its corners, and a header at its mid-edges too', () => {
      for (const [x, y] of corners) expect(alphaAt(x, y), `corner ${x},${y}`).toBe(0);
      // A chip's round tile touches its mid-edges by design; a header's drawing never reaches its edge.
      if (file.startsWith('mail-header-')) for (const [x, y] of midEdges) expect(alphaAt(x, y), `mid-edge ${x},${y}`).toBe(0);
    });
  });

  it.each(Object.entries(V1_HASHES.files))('keeps v1 %s byte for byte (sent mails point at it)', (file, sha256) => {
    expect(createHash('sha256').update(readFileSync(V1_DIR + file)).digest('hex')).toBe(sha256);
  });

  it('keeps every v1 file, and no other', () => {
    expect(readdirSync(V1_DIR).sort()).toEqual(Object.keys(V1_HASHES.files).sort());
  });
});
