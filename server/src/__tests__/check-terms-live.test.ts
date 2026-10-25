import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkTermsCli,
  checkTermsLive,
  gitShow,
  LEGAL_PATH,
  parseCurrentTerms,
  publicOrigin,
  termsAtCommit,
  termsLiveProblem,
  type GitShow,
} from '../scripts/check-terms-live.js';
import { CURRENT_TERMS, type CurrentTerms } from '../legal.js';

/** MUT-324 (D11): the release refuses a terms version the public site does not list with the same text. */
const TERMS: CurrentTerms = { version: '2026-10-19', sha256: { en: 'e'.repeat(64), ar: 'a'.repeat(64) } };
const listed = (sha256 = TERMS.sha256) => ({ versions: [{ version: '2026-10-19', sha256 }] });

describe('termsLiveProblem', () => {
  it('passes when the site lists the version with the same fingerprints', () => {
    expect(termsLiveProblem(listed(), TERMS)).toBeNull();
  });

  it('refuses a version the site does not list yet (release web first)', () => {
    expect(termsLiveProblem({ versions: [] }, TERMS)).toMatch(/2026-10-19 is not live/);
  });

  it('refuses a version whose live text differs from the one this release fingerprints', () => {
    expect(termsLiveProblem(listed({ en: 'e'.repeat(64), ar: 'b'.repeat(64) }), TERMS)).toMatch(/ar text differs/);
  });

  it('refuses an answer that is not the manifest', () => {
    expect(termsLiveProblem('<html>', TERMS)).toMatch(/not a terms manifest/);
  });
});

/** Review fix 3: a failed fetch says what failed, not "release web first". */
describe('checkTermsLive', () => {
  const URL_ = 'https://site.example/legal/terms-versions.json';
  const answering = (res: Response | Error) => (async () => {
    if (res instanceof Error) throw res;
    return res;
  }) as typeof fetch;

  it('passes when the manifest lists the version', async () => {
    expect(await checkTermsLive(URL_, TERMS, answering(Response.json(listed())))).toBeNull();
  });

  it('reports the HTTP status the site answered with', async () => {
    const problem = await checkTermsLive(URL_, TERMS, answering(new Response('nope', { status: 503 })));
    expect(problem).toMatch(/HTTP 503/);
    expect(problem).not.toMatch(/release web first/);
  });

  it('reports the error when the site cannot be reached', async () => {
    const problem = await checkTermsLive(URL_, TERMS, answering(new TypeError('getaddrinfo ENOTFOUND site.example')));
    expect(problem).toMatch(/could not fetch .*ENOTFOUND/);
    expect(problem).not.toMatch(/release web first/);
  });

  it('reports an answer that is not JSON (the app shell)', async () => {
    const problem = await checkTermsLive(URL_, TERMS, answering(new Response('<html></html>', { status: 200 })));
    expect(problem).toMatch(/not JSON/);
  });

  it('still says to release web first when the site is up but lacks the version', async () => {
    expect(await checkTermsLive(URL_, TERMS, answering(Response.json({ versions: [] })))).toMatch(/release web first/);
  });
});

/** MUT-347: a rollback checks the terms the commit it rolls back to names, not the working tree's. */
describe('termsAtCommit', () => {
  const legalAt = (version: string, en: string, ar: string) => `import type { SessionKind } from './auth/sessions.js';

export const TERMS_LOCALES = ['en', 'ar'] as const;

export const CURRENT_TERMS: CurrentTerms = {
  version: '${version}',
  sha256: {
    en: '${en}',
    ar: '${ar}',
  },
};
`;
  const showing = (files: Record<string, string | null>): GitShow => (commit, path) => {
    if (!(commit in files)) throw new Error(`${commit} is not in this clone (git fetch --tags origin?)`);
    expect(path).toBe(LEGAL_PATH);
    return files[commit] ?? null;
  };

  it('reads the version and fingerprints from the commit’s legal.ts', () => {
    const gitShow = showing({ abc1234: legalAt('2026-11-01', '1'.repeat(64), '2'.repeat(64)) });
    expect(termsAtCommit('abc1234', gitShow)).toEqual({ version: '2026-11-01', sha256: { en: '1'.repeat(64), ar: '2'.repeat(64) } });
  });

  it('is null for a commit from before MUT-324 (no legal.ts, or one without CURRENT_TERMS)', () => {
    expect(termsAtCommit('old1', showing({ old1: null }))).toBeNull();
    expect(termsAtCommit('old2', showing({ old2: "export const TERMS_LOCALES = ['en', 'ar'] as const;\n" }))).toBeNull();
  });

  it('throws when the commit is not in this clone', () => {
    expect(() => termsAtCommit('deadbee', showing({}))).toThrow(/not in this clone/);
  });

  it('throws when CURRENT_TERMS no longer has the literal shape it parses, rather than guess', () => {
    const computed = legalAt('2026-11-01', '1'.repeat(64), '2'.repeat(64)).replace(/version: '[^']+'/, 'version: LATEST');
    expect(() => termsAtCommit('new1', showing({ new1: computed }))).toThrow(/literal shape/);
    const shortHash = legalAt('2026-11-01', '1'.repeat(63), '2'.repeat(64));
    expect(() => termsAtCommit('new2', showing({ new2: shortHash }))).toThrow(/literal shape/);
  });

  it('parses this checkout’s own legal.ts to CURRENT_TERMS, so a shape change fails here first', () => {
    expect(parseCurrentTerms(readFileSync(resolve(process.cwd(), 'src/legal.ts'), 'utf8'))).toEqual(CURRENT_TERMS);
  });

  it('git: reads HEAD, is null for a path HEAD lacks, and throws for a commit the clone lacks', () => {
    expect(termsAtCommit('HEAD')).toEqual(CURRENT_TERMS);
    expect(gitShow('HEAD', 'server/src/no-such-file.ts')).toBeNull();
    expect(() => gitShow('0000000000000000000000000000000000000001', LEGAL_PATH)).toThrow(/not in this clone/);
  });
});

describe('the --commit check (rollback)', () => {
  const live = { MUTABA3A_PUBLIC_ORIGIN: 'https://site.example' };
  const manifest = (terms: CurrentTerms) => (async () => Response.json(listed(terms.sha256))) as typeof fetch;

  it('checks the commit’s terms against the site', async () => {
    const lines: string[] = [];
    const code = await checkTermsCli(['--commit', 'abc1234'], live, { fetchImpl: manifest(TERMS), termsAt: () => TERMS, log: (s) => lines.push(s) });
    expect(code).toBe(0);
    expect(lines.join('\n')).toMatch(/2026-10-19 \(named by abc1234\) is live at https:\/\/site.example/);
  });

  it('refuses a commit from before the terms, and says why and how to go on', async () => {
    const lines: string[] = [];
    const code = await checkTermsCli(['--commit', 'old1'], live, { fetchImpl: manifest(TERMS), termsAt: () => null, log: (s) => lines.push(s) });
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/old1 names no terms .*before MUT-324.*SKIP_TERMS_CHECK=1/);
  });

  it('refuses a commit it cannot read, with the reason', async () => {
    const lines: string[] = [];
    const termsAt = () => {
      throw new Error('deadbee is not in this clone');
    };
    const code = await checkTermsCli(['--commit', 'deadbee'], live, { fetchImpl: manifest(TERMS), termsAt, log: (s) => lines.push(s) });
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/deadbee is not in this clone/);
  });
});

describe('publicOrigin (MUT-326: no default; the npm script fills it from config/hosts.json)', () => {
  it('takes MUTABA3A_PUBLIC_ORIGIN without its trailing slash', () => {
    expect(publicOrigin({ MUTABA3A_PUBLIC_ORIGIN: 'https://landing.example/' })).toBe('https://landing.example');
  });
  it.each([undefined, '', '   '])('is null for %j, so the check refuses instead of guessing a site', (value) => {
    expect(publicOrigin(value === undefined ? {} : { MUTABA3A_PUBLIC_ORIGIN: value })).toBeNull();
  });
});
