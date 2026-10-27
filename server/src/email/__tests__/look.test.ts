import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TEMPLATE_IDS } from '../ports.js';
import { ART_FILES, artFor, LOOK } from '../templates/look.js';

/**
 * MUT-468: every customer mail has a look, and every picture a look names ships in the portal build
 * (src/hosted/public/mail/v1, served at <PORTAL_ORIGIN>/mail/v1). A missing file would answer the SPA shell.
 */
const ART_DIR = fileURLToPath(new URL('../../../../src/hosted/public/mail/v1/', import.meta.url));
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
