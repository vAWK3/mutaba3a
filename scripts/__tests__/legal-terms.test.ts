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

/**
 * Review fixes 2 and 3: web ships the terms text, the server names it, so web goes
 * first; and the check refuses before the version bump, commit and push, never after.
 */
describe('releasing the terms web first (MUT-324)', () => {
  const ROOT = join(__dirname, '../..');
  const makefile = readFileSync(join(ROOT, 'Makefile'), 'utf8');
  const preflight = readFileSync(join(ROOT, 'scripts/preflight.sh'), 'utf8');
  const deploySh = readFileSync(join(ROOT, 'server/scripts/deploy.sh'), 'utf8');
  const recipe = (target: string) => {
    const start = makefile.indexOf(`\n${target}:`);
    return makefile.slice(start, makefile.indexOf('\n\n', start + 1));
  };

  it('make release full releases web before the server', () => {
    expect(makefile).toMatch(/^release-full: release-web release-server$/m);
  });

  it('the server preflight checks the terms are live, so make release server refuses before bump-version', () => {
    const serverSection = preflight.slice(preflight.indexOf('if [[ "$MODE" == "server" ]]; then\n  head_'));
    expect(serverSection).toContain('terms:check-live');
    const release = recipe('release-server');
    expect(release.indexOf('preflight-server')).toBeGreaterThan(-1);
    expect(release.indexOf('preflight-server')).toBeLessThan(release.indexOf('bump-version.sh'));
  });

  it('deploy.sh checks again only when run on its own, not after make release server already did', () => {
    expect(recipe('release-server')).toContain('TERMS_CHECKED_BY_PREFLIGHT=1 ./scripts/deploy.sh');
    expect(deploySh).toMatch(/TERMS_CHECKED_BY_PREFLIGHT/);
    expect(deploySh).toContain('terms:check-live');
  });
});
