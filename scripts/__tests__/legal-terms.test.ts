// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { CURRENT_TERMS } from '../../server/src/legal';
import { DEFAULT_PUBLIC_ORIGIN as DEPLOY_CHECK_ORIGIN } from '../../server/src/scripts/check-terms-live';
import { DEFAULT_PUBLIC_ORIGIN } from '../../vite.config';
import { termsManifest } from '../../src/content/legal/termsManifest';
import { LATEST_TERMS_VERSION, TERMS_VERSIONS } from '../../src/content/legal/terms';

/**
 * MUT-324 (ADR-102): the server names the terms people accept and the sha256 of
 * their text; the landing serves that text. They ship in different deploys, so
 * this test keeps the two in step, and keeps released texts frozen.
 */
const DIR = join(__dirname, '../../src/content/legal/terms');
const manifest = termsManifest(readdirSync(DIR).map((name) => ({ name, bytes: readFileSync(join(DIR, name)) })));

describe('legal terms (MUT-324)', () => {
  it('the server’s current version is the landing’s latest, with the same text fingerprints', () => {
    expect(LATEST_TERMS_VERSION).toBe(CURRENT_TERMS.version);
    expect(manifest.versions[0]).toEqual({ version: CURRENT_TERMS.version, sha256: CURRENT_TERMS.sha256 });
  });

  it('the landing knows every version that has a text file', () => {
    expect([...TERMS_VERSIONS]).toEqual(manifest.versions.map((v) => v.version));
  });

  it('each text file names its own version', () => {
    for (const { version } of manifest.versions) {
      for (const locale of ['en', 'ar']) {
        expect(JSON.parse(readFileSync(join(DIR, `${version}.${locale}.json`), 'utf8')).version).toBe(version);
      }
    }
  });

  it('the deploy check reads the same public site the landing is built for', () => {
    expect(DEPLOY_CHECK_ORIGIN).toBe(DEFAULT_PUBLIC_ORIGIN);
  });
});
