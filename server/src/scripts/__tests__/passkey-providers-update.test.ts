import { describe, expect, it } from 'vitest';
import { buildProviderList, runPasskeyProvidersUpdate } from '../passkey-providers-update.js';

const SHA = 'a'.repeat(40);

describe('passkey-providers:update (MUT-115 DR8)', () => {
  it('maps the community list to lower-case AAGUID → name, sorted, with its source and date', () => {
    const list = buildProviderList({ 'FBFC3007-154E-4ECC-8C0B-6E020557D7BD': { name: 'iCloud Keychain', icon_dark: 'x' }, 'bada5566-a7aa-401f-bd96-45619a55120d': { name: ' 1Password ' } }, { commit: SHA, fetched: '2026-10-25' });
    expect(list.providers).toEqual({ 'bada5566-a7aa-401f-bd96-45619a55120d': '1Password', 'fbfc3007-154e-4ecc-8c0b-6e020557d7bd': 'iCloud Keychain' });
    expect(list.source).toContain(SHA);
    expect(list.updated).toBe('2026-10-25');
  });

  it('refuses a malformed upstream', () => {
    expect(() => buildProviderList({ 'not-a-uuid': { name: 'x' } }, { commit: SHA, fetched: 'd' })).toThrow(/AAGUID/);
    expect(() => buildProviderList({ 'fbfc3007-154e-4ecc-8c0b-6e020557d7bd': {} }, { commit: SHA, fetched: 'd' })).toThrow(/no name/);
  });

  it('needs a pinned commit and refuses redirects', async () => {
    const out: string[] = [];
    const io = { fetch: (async () => new Response('{}')) as unknown as typeof fetch, write: () => {}, out: (l: string) => void out.push(l), today: () => '2026-10-25' };
    expect(await runPasskeyProvidersUpdate([], io)).toBe(2);
    let init: RequestInit | undefined;
    const written: string[] = [];
    const code = await runPasskeyProvidersUpdate(['--commit', SHA], {
      ...io,
      fetch: (async (_url: string, i: RequestInit) => ((init = i), new Response(JSON.stringify({ 'fbfc3007-154e-4ecc-8c0b-6e020557d7bd': { name: 'iCloud Keychain' } })))) as unknown as typeof fetch,
      write: (t) => void written.push(t),
    });
    expect(code).toBe(0);
    expect(init?.redirect).toBe('error');
    expect(JSON.parse(written[0]!).providers).toEqual({ 'fbfc3007-154e-4ecc-8c0b-6e020557d7bd': 'iCloud Keychain' });
  });
});
