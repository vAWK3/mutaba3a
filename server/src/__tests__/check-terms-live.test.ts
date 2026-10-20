import { describe, expect, it } from 'vitest';
import { checkTermsLive, termsLiveProblem } from '../scripts/check-terms-live.js';
import type { CurrentTerms } from '../legal.js';

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
