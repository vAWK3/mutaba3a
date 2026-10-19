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

/**
 * Every released version's text fingerprints, frozen: a released file is never edited
 * (ADR-102). A new version adds a row; CURRENT_TERMS moves on, the old rows stay.
 */
const RELEASED_TERMS: Readonly<Record<string, { en: string; ar: string }>> = {
  '2026-10-19': {
    en: '2ed299dc133d011452175ef182ae3701ab126dc8a316d0c3befe49c4833c864c',
    ar: '7f997e6b13e6a7ed0259f71523c8c2e5b0a8ead0ed9a405be6851753b77272cc',
  },
};

describe('legal terms (MUT-324)', () => {
  it('every version has a frozen row, and its text still matches it', () => {
    expect(manifest.versions.map((v) => v.version).sort()).toEqual(Object.keys(RELEASED_TERMS).sort());
    for (const { version, sha256 } of manifest.versions) expect(sha256).toEqual(RELEASED_TERMS[version]);
  });

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

  it('deploy.sh always checks again: nothing tells it the preflight already did (review pass 2)', () => {
    expect(makefile).not.toMatch(/TERMS_CHECKED_BY_PREFLIGHT/);
    expect(deploySh).not.toMatch(/TERMS_CHECKED_BY_PREFLIGHT/);
    expect(deploySh).toContain('terms:check-live');
  });

  it('only SKIP_TERMS_CHECK skips the terms check; SKIP_REMOTE (offline for origin and GCP) never does', () => {
    const block = preflight.slice(preflight.indexOf('head_ "Terms of service"'));
    const terms = block.slice(0, block.indexOf('\n  fi\n'));
    expect(terms).toContain('SKIP_TERMS_CHECK');
    expect(terms).not.toContain('SKIP_REMOTE');
    expect(makefile).toMatch(/SKIP_TERMS_CHECK=1/);
  });
});

/** Review fix 5: the privacy policy promises only the recovery the database is configured for. */
describe('the privacy policy’s backup promise (MUT-324)', () => {
  const ROOT = join(__dirname, '../..');
  const terraform = readFileSync(join(ROOT, 'server/infrastructure/terraform/main.tf'), 'utf8');
  const setting = (name: string) => Number(new RegExp(`${name}\\s*=\\s*(\\d+)`).exec(terraform)?.[1]);
  const hosted = (language: 'en' | 'ar') =>
    (JSON.parse(readFileSync(join(ROOT, `src/lib/i18n/translations/${language}/landing.json`), 'utf8')) as {
      landing: { privacyPolicy: { hostedAccounts: { body: string } } };
    }).landing.privacyPolicy.hostedAccounts.body;

  it('names the daily backups’ retention and the shorter point-in-time window, in both languages', () => {
    const backups = setting('retained_backups');
    const pointInTime = setting('transaction_log_retention_days');
    expect([backups, pointInTime]).toEqual([14, 7]);
    expect(hosted('en')).toContain(`keep each backup for ${backups} days`);
    expect(hosted('en')).toContain(`any moment in the last ${pointInTime} days`);
    expect(hosted('en')).not.toMatch(/any point in that time/);
    expect(hosted('ar')).toContain(`آخر ${pointInTime} أيام`);
  });
});
