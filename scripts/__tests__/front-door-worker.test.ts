// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../../server/infrastructure/frontdoor/worker/front-door.js';
import { FRONT_DOOR_CLIENT_IP_HEADER, FRONT_DOOR_HEADER } from '../../server/src/auth/sessions';

/**
 * MUT-326 (ADR-155 D3): the Cloudflare Worker in front of the Cloud Run service. It must
 * prove itself to the server, hand over the caller's address, and otherwise change nothing:
 * methods, bodies, other headers (X-Mutaba3a-Profile!), redirects and cookies pass through.
 */
const ENV = { UPSTREAM_ORIGIN: 'https://service.a.run.example', FRONT_DOOR_TOKEN: 't'.repeat(48) };

function captureFetch(response = new Response('ok', { status: 200 })) {
  const calls: { url: string; init: RequestInit & { headers: Headers } }[] = [];
  vi.stubGlobal('fetch', async (url: string | URL, init: RequestInit & { headers: Headers }) => {
    calls.push({ url: String(url), init });
    return response;
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('front-door Worker', () => {
  it('forwards to the upstream origin with the same path and query', async () => {
    const calls = captureFetch();
    await worker.fetch(new Request('https://app.placeholder.example/p/abc/expenses?month=2026-10'), ENV);
    expect(calls[0]!.url).toBe('https://service.a.run.example/p/abc/expenses?month=2026-10');
  });

  it('proves itself with the token and hands over the edge-read client address', async () => {
    const calls = captureFetch();
    await worker.fetch(new Request('https://app.placeholder.example/v1/me', { headers: { 'cf-connecting-ip': '203.0.113.7' } }), ENV);
    expect(calls[0]!.init.headers.get(FRONT_DOOR_HEADER)).toBe(ENV.FRONT_DOOR_TOKEN);
    expect(calls[0]!.init.headers.get(FRONT_DOOR_CLIENT_IP_HEADER)).toBe('203.0.113.7');
  });

  it('overwrites a caller\'s own copies of those two headers, and sends no client IP it did not read', async () => {
    const calls = captureFetch();
    await worker.fetch(
      new Request('https://app.placeholder.example/v1/sessions', {
        headers: { [FRONT_DOOR_HEADER]: 'forged', [FRONT_DOOR_CLIENT_IP_HEADER]: '9.9.9.9' },
      }),
      ENV,
    );
    expect(calls[0]!.init.headers.get(FRONT_DOOR_HEADER)).toBe(ENV.FRONT_DOOR_TOKEN);
    expect(calls[0]!.init.headers.get(FRONT_DOOR_CLIENT_IP_HEADER)).toBeNull();
  });

  it('passes every other header through, X-Mutaba3a-Profile and cookies included, but not Host', async () => {
    const calls = captureFetch();
    await worker.fetch(
      new Request('https://app.placeholder.example/v1/entries', {
        headers: { 'X-Mutaba3a-Profile': 'org-1', cookie: '__Host-mut_session=abc', 'sec-fetch-site': 'same-origin', origin: 'https://app.placeholder.example' },
      }),
      ENV,
    );
    const sent = calls[0]!.init.headers;
    expect(sent.get('x-mutaba3a-profile')).toBe('org-1');
    expect(sent.get('cookie')).toBe('__Host-mut_session=abc');
    expect(sent.get('sec-fetch-site')).toBe('same-origin');
    expect(sent.get('origin')).toBe('https://app.placeholder.example');
    expect(sent.get('host')).toBeNull();
    expect(sent.get('x-forwarded-host')).toBeNull();
  });

  it('forwards a write\'s method and body, and never gives a GET or HEAD a body', async () => {
    const calls = captureFetch();
    await worker.fetch(new Request('https://app.placeholder.example/v1/sessions', { method: 'POST', body: '{"email":"a@b.c"}' }), ENV);
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.body).toBeTruthy();
    await worker.fetch(new Request('https://app.placeholder.example/', { method: 'HEAD' }), ENV);
    expect(calls[1]!.init.method).toBe('HEAD');
    expect(calls[1]!.init.body).toBeUndefined();
  });

  it('hands the server\'s redirects and cookies to the browser untouched', async () => {
    const upstream = new Response(null, { status: 302, headers: { location: '/carry-over?next=%2F' } });
    upstream.headers.append('set-cookie', '__Host-mut_session=a; Path=/; Secure; HttpOnly; SameSite=Strict');
    upstream.headers.append('set-cookie', 'other=b; Path=/; Secure');
    const calls = captureFetch(upstream);
    const res = await worker.fetch(new Request('https://app.placeholder.example/'), ENV);
    expect(calls[0]!.init.redirect).toBe('manual');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/carry-over?next=%2F');
    expect(res.headers.getSetCookie()).toHaveLength(2);
  });

  it('fails closed (503) when its token or upstream is missing, instead of proxying unauthenticated', async () => {
    const calls = captureFetch();
    expect((await worker.fetch(new Request('https://app.placeholder.example/'), { ...ENV, FRONT_DOOR_TOKEN: '' })).status).toBe(503);
    expect((await worker.fetch(new Request('https://app.placeholder.example/'), { ...ENV, UPSTREAM_ORIGIN: '' })).status).toBe(503);
    expect(calls).toHaveLength(0);
  });
});
