import { describe, expect, it } from 'vitest';
import { parseDomainList } from '../../email/domains/lists.js';
import { buildDisposableFile, runEmailDomainsUpdate, upstreamUrlFor } from '../email-domains-update.js';

/** MUT-367 (A5): the disposable list's refresh is reproducible: one commit, one file, byte for byte. */
const SHA = '0123456789abcdef0123456789abcdef01234567';
const UPSTREAM = '# comment\nYopmail.com\nmailinator.com\n\nmailinator.com\ngmail.com\nduck.com\n0-mail.com\n';

describe('email-domains:update (MUT-367)', () => {
  it('builds a sorted, de-duplicated, lower-cased file without webmail or relay domains, naming its source', () => {
    const text = buildDisposableFile(UPSTREAM, { commit: SHA, fetched: '2026-10-23', exclude: new Set(['gmail.com', 'duck.com']) });
    const parsed = parseDomainList(text);
    expect(parsed.domains).toEqual(['0-mail.com', 'mailinator.com', 'yopmail.com']);
    expect(parsed.header).toMatchObject({ source: upstreamUrlFor(SHA), commit: SHA, fetched: '2026-10-23', licence: 'CC0-1.0' });
    // The same input gives the same bytes.
    expect(buildDisposableFile(UPSTREAM, { commit: SHA, fetched: '2026-10-23', exclude: new Set(['gmail.com', 'duck.com']) })).toBe(text);
  });

  it('needs a full commit sha (a branch name would not be reproducible)', async () => {
    const out: string[] = [];
    const io = { fetch: (async () => new Response(UPSTREAM)) as typeof fetch, write: () => undefined, out: (l: string) => out.push(l), today: () => '2026-10-23' };
    expect(await runEmailDomainsUpdate(['--commit', 'main'], io)).toBe(2);
    expect(await runEmailDomainsUpdate([], io)).toBe(2);
  });

  it('fetches the pinned commit and writes the file', async () => {
    const fetched: string[] = [];
    let written = '';
    const io = {
      fetch: (async (url: string | URL) => (fetched.push(String(url)), new Response(UPSTREAM))) as typeof fetch,
      write: (text: string) => {
        written = text;
      },
      out: () => undefined,
      today: () => '2026-10-23',
    };
    expect(await runEmailDomainsUpdate(['--commit', SHA], io)).toBe(0);
    expect(fetched).toEqual([upstreamUrlFor(SHA)]);
    expect(parseDomainList(written).domains).toContain('mailinator.com');
    expect(parseDomainList(written).domains).not.toContain('gmail.com');
  });
});
