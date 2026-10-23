import { describe, expect, it, vi } from 'vitest';
import { checkEmailApi, checkEmailDns, createResendDomainsApi, emailCheckMain, type DnsLookup, type ResendDomain, type ResendDomainsApi } from '../email-check.js';

/**
 * MUT-359 A2 (D4, D21): `npm --prefix server run email:check`. The DNS mode needs no key and is what the release
 * preflight runs; `--api` reads the domain through Resend's API (a stub here, never the network) and fails while
 * open or click tracking is on, a record isn't verified, or the region isn't eu-west-1.
 */
const DOMAIN = 'mail.example.test';

function dns(overrides: Partial<Record<string, string[] | { exchange: string; priority: number }[]>> = {}): DnsLookup {
  const records: Record<string, unknown> = {
    [`txt:resend._domainkey.${DOMAIN}`]: ['p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC'],
    [`mx:send.${DOMAIN}`]: [{ exchange: 'feedback-smtp.eu-west-1.amazonses.com', priority: 10 }],
    [`txt:send.${DOMAIN}`]: ['v=spf1 include:amazonses.com ~all'],
    [`txt:_dmarc.${DOMAIN}`]: ['v=DMARC1; p=none;'],
  };
  for (const [key, value] of Object.entries(overrides)) records[key] = value;
  return {
    txt: async (name) => (records[`txt:${name}`] as string[] | undefined) ?? [],
    mx: async (name) => (records[`mx:${name}`] as { exchange: string; priority: number }[] | undefined) ?? [],
  };
}

const VERIFIED: ResendDomain = {
  id: 'd_1',
  name: DOMAIN,
  status: 'verified',
  region: 'eu-west-1',
  open_tracking: false,
  click_tracking: false,
  records: [
    { record: 'SPF', status: 'verified' },
    { record: 'SPF', status: 'verified' },
    { record: 'DKIM', status: 'verified' },
  ],
};
const api = (domain: Partial<ResendDomain> | null = {}, others: ResendDomain[] = []): ResendDomainsApi => ({
  list: async () => [...others, ...(domain ? [{ ...VERIFIED, ...domain }] : [])].map(({ id, name }) => ({ id, name })),
  get: async (id) => [...others, { ...VERIFIED, ...domain }].find((d) => d.id === id)!,
});

describe('email:check — DNS (keyless, the preflight’s)', () => {
  it('passes when DKIM, the return-path MX and SPF, and DMARC are published', async () => {
    expect(await checkEmailDns(DOMAIN, dns())).toEqual([]);
  });

  it.each([
    [`txt:resend._domainkey.${DOMAIN}`, [], 'DKIM'],
    [`mx:send.${DOMAIN}`, [], 'MX'],
    [`mx:send.${DOMAIN}`, [{ exchange: 'feedback-smtp.us-east-1.amazonses.com', priority: 10 }], 'eu-west-1'],
    [`txt:send.${DOMAIN}`, ['v=spf1 -all'], 'SPF'],
    [`txt:_dmarc.${DOMAIN}`, [], 'DMARC'],
  ] as const)('fails when %s is %j', async (key, value, word) => {
    const problems = await checkEmailDns(DOMAIN, dns({ [key]: value as never }));
    expect(problems.join('\n')).toContain(word);
  });
});

describe('email:check --api (the operator’s, with a full-access key)', () => {
  it('passes a verified eu-west-1 domain with tracking off', async () => {
    expect(await checkEmailApi(DOMAIN, api())).toEqual([]);
  });

  it.each([
    [{ open_tracking: true }, 'open tracking'],
    [{ click_tracking: true }, 'click tracking'],
    [{ open_tracking: undefined }, 'open tracking'],
    [{ status: 'pending' }, 'not verified'],
    [{ region: 'us-east-1' }, 'eu-west-1'],
    [{ records: [{ record: 'DKIM', status: 'pending' }] }, 'DKIM'],
  ] as const)('fails for %j', async (change, word) => {
    const problems = await checkEmailApi(DOMAIN, api(change as Partial<ResendDomain>));
    expect(problems.join('\n')).toContain(word);
  });

  it('fails when Resend has no such domain, even if it has others (Malafat’s)', async () => {
    const problems = await checkEmailApi(DOMAIN, api(null, [{ ...VERIFIED, id: 'd_9', name: 'malafat.example' }]));
    expect(problems.join('\n')).toContain('not in Resend');
  });
});

describe('the Resend domains client', () => {
  it('lists then reads a domain with the key, and says which call failed', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) =>
      String(url).endsWith('/domains')
        ? new Response(JSON.stringify({ object: 'list', data: [{ id: 'd_1', name: DOMAIN }] }))
        : new Response(JSON.stringify(VERIFIED)),
    );
    const client = createResendDomainsApi('re_full_access', fetch);
    expect(await client.list()).toEqual([{ id: 'd_1', name: DOMAIN }]);
    expect((await client.get('d_1')).region).toBe('eu-west-1');
    expect(new Headers(fetch.mock.calls[0]![1]?.headers).get('authorization')).toBe('Bearer re_full_access');
    expect(String(fetch.mock.calls[1]![0])).toBe('https://api.resend.com/domains/d_1');

    const refused = createResendDomainsApi('re_sending_only', vi.fn<typeof globalThis.fetch>(async () => new Response('{"name":"restricted_api_key"}', { status: 401 })));
    await expect(refused.list()).rejects.toThrow(/401.*restricted_api_key/);
  });
});

describe('emailCheckMain', () => {
  const quiet = { log: vi.fn(), error: vi.fn() };

  it('refuses to run without a domain', async () => {
    expect(await emailCheckMain({ argv: [], env: {}, dns: dns(), console: quiet })).toBe(1);
  });

  it('runs the DNS check by default and the API check with --api', async () => {
    const out = { log: vi.fn(), error: vi.fn() };
    expect(await emailCheckMain({ argv: [], env: { MAIL_DOMAIN: DOMAIN }, dns: dns(), console: out })).toBe(0);
    expect(out.log).toHaveBeenCalledWith(expect.stringContaining('[email] ok'));
    expect(await emailCheckMain({ argv: ['--api'], env: { MAIL_DOMAIN: DOMAIN, RESEND_CHECK_API_KEY: 're_x' }, dns: dns(), resend: api({ click_tracking: true }), console: quiet })).toBe(1);
  });

  it('fails --api without a key, pointing at the Keychain, and never falls back to the sending key', async () => {
    const out = { log: vi.fn(), error: vi.fn() };
    expect(await emailCheckMain({ argv: ['--api'], env: { MAIL_DOMAIN: DOMAIN, RESEND_API_KEY: 're_sending' }, dns: dns(), console: out })).toBe(1);
    expect(out.error).toHaveBeenCalledWith(expect.stringContaining('RESEND_CHECK_API_KEY'));
  });
});
