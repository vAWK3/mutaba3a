import { describe, expect, it } from 'vitest';
import { createDnsDomainChecker, type DnsResolverLike } from '../dns-checker.js';
import { createRdapClient, IANA_RDAP_BOOTSTRAP_URL } from '../rdap.js';

/**
 * MUT-367 (§3.1, D4, D24): the production checker, on a fake resolver and a fake fetch. No real DNS or RDAP runs.
 */
const NOW = new Date('2026-10-23T09:00:00Z');

const dnsError = (code: string) => Object.assign(new Error(code), { code });

type Answers = Record<string, unknown | Error>;
/** `mx:<name>`, `a:<name>`, `aaaa:<name>` → records, or an Error to throw. A missing key is ENOTFOUND. */
function fakeResolver(answers: Answers, delayMs = 0): DnsResolverLike & { cancelled: boolean } {
  const answer = async (key: string) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const value = answers[key];
    if (value instanceof Error) throw value;
    if (value === undefined) throw dnsError('ENOTFOUND');
    return value;
  };
  const resolver = {
    cancelled: false,
    resolveMx: (name: string) => answer(`mx:${name}`) as Promise<{ exchange: string; priority: number }[]>,
    resolve4: (name: string) => answer(`a:${name}`) as Promise<string[]>,
    resolve6: (name: string) => answer(`aaaa:${name}`) as Promise<string[]>,
    cancel: () => {
      resolver.cancelled = true;
    },
  };
  return resolver;
}

const BOOTSTRAP = { services: [[['example', 'test'], ['https://rdap.registry.example/']]] };

function fakeFetch(routes: Record<string, { status: number; body?: unknown; delayMs?: number }>) {
  const requested: { url: string; redirect: RequestInit['redirect'] }[] = [];
  const fetchFn = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    requested.push({ url, redirect: init?.redirect });
    const route = routes[url];
    if (route?.delayMs) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, route.delayMs);
        init?.signal?.addEventListener('abort', () => (clearTimeout(t), reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
      });
    }
    if (!route) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(route.body ?? {}), { status: route.status, headers: { 'content-type': 'application/rdap+json' } });
  }) as typeof fetch;
  return { fetchFn, requested };
}

const registered = (iso: string) => ({ status: 200, body: { events: [{ eventAction: 'last changed', eventDate: '2026-01-01T00:00:00Z' }, { eventAction: 'registration', eventDate: iso }] } });

function checker(resolver: DnsResolverLike, routes: Record<string, { status: number; body?: unknown; delayMs?: number }>, budgetMs = 500) {
  const { fetchFn, requested } = fakeFetch({ [IANA_RDAP_BOOTSTRAP_URL]: { status: 200, body: BOOTSTRAP }, ...routes });
  const rdap = createRdapClient({ fetch: fetchFn, now: () => NOW });
  return { check: createDnsDomainChecker({ resolver: () => resolver, rdap, budgetMs }), requested };
}

describe('createDnsDomainChecker (MUT-367)', () => {
  it('reads MX, apex and www addresses, and the RDAP registration date of the exact domain', async () => {
    const r = fakeResolver({ 'mx:firm.example': [{ exchange: 'mx.firm.example', priority: 10 }], 'a:firm.example': ['192.0.2.1'], 'aaaa:www.firm.example': ['2001:db8::1'] });
    const { check, requested } = checker(r, { 'https://rdap.registry.example/domain/firm.example': registered('2019-05-01T00:00:00Z') });
    expect(await check.check('firm.example')).toEqual({ mx: 'present', apex: 'present', www: 'present', rdap: { status: 'found', registeredAt: new Date('2019-05-01T00:00:00Z') }, timedOut: false });
    // D4: straight to the registry the bootstrap names, never following a redirect anywhere else.
    expect(requested.find((q) => q.url.includes('/domain/'))).toEqual({ url: 'https://rdap.registry.example/domain/firm.example', redirect: 'error' });
  });

  it('a null MX (RFC 7505) is "null"; no records at all is "none"', async () => {
    const nullMx = fakeResolver({ 'mx:quiet.example': [{ exchange: '', priority: 0 }] });
    expect((await checker(nullMx, {}).check.check('quiet.example')).mx).toBe('null');
    const nothing = fakeResolver({ 'mx:gone.example': dnsError('ENODATA') });
    expect(await checker(nothing, {}).check.check('gone.example')).toMatchObject({ mx: 'none', apex: 'none', www: 'none', rdap: { status: 'not-found' } });
  });

  it('D24: only ENOTFOUND and ENODATA mean "no record"; any other DNS error is unknown', async () => {
    for (const code of ['ESERVFAIL', 'EREFUSED', 'ECONNREFUSED', 'ETIMEOUT']) {
      const r = fakeResolver({ 'mx:firm.example': dnsError(code), 'a:firm.example': dnsError(code), 'aaaa:firm.example': dnsError(code), 'a:www.firm.example': dnsError(code), 'aaaa:www.firm.example': dnsError(code) });
      expect(await checker(r, {}).check.check('firm.example'), code).toMatchObject({ mx: 'unknown', apex: 'unknown', www: 'unknown' });
    }
  });

  it('a TLD the bootstrap doesn’t serve is "unsupported-tld"; a registry error is "error"', async () => {
    const r = fakeResolver({});
    expect((await checker(r, {}).check.check('firm.ps')).rdap).toEqual({ status: 'unsupported-tld' });
    expect((await checker(r, { 'https://rdap.registry.example/domain/firm.example': { status: 503 } }).check.check('firm.example')).rdap).toEqual({ status: 'error' });
    expect((await checker(r, { 'https://rdap.registry.example/domain/firm.example': { status: 200, body: { events: [] } } }).check.check('firm.example')).rdap).toEqual({ status: 'found', registeredAt: null });
  });

  it('stops at the budget: unanswered lookups are unknown, RDAP is a timeout, and the resolver is cancelled', async () => {
    const slow = fakeResolver({ 'mx:slow.example': [{ exchange: 'mx.slow.example', priority: 10 }] }, 200);
    const { check } = checker(slow, { 'https://rdap.registry.example/domain/slow.example': { ...registered('2019-05-01T00:00:00Z'), delayMs: 200 } }, 50);
    const started = performance.now();
    const facts = await check.check('slow.example');
    expect(performance.now() - started).toBeLessThan(150);
    expect(facts).toEqual({ mx: 'unknown', apex: 'unknown', www: 'unknown', rdap: { status: 'timeout' }, timedOut: true });
    expect(slow.cancelled).toBe(true);
  });

  it('reads the IANA bootstrap once and reuses it', async () => {
    const r = fakeResolver({});
    const { check, requested } = checker(r, {});
    await check.check('a.example');
    await check.check('b.example');
    expect(requested.filter((q) => q.url === IANA_RDAP_BOOTSTRAP_URL)).toHaveLength(1);
  });
});
