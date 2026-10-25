import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { cimdCacheUntil, clientTrust, fetchClientMetadata, isCimdClientId, isPublicUnicastAddress, parseCimdUrl, validateClientMetadata } from '../trust.js';

/** MUT-434: who a client is (trust by redirect host, MAL-224) and the CIMD fetch guard (S1, ported from MAL-176). */

describe('clientTrust (by redirect host, never by name)', () => {
  it('verifies only exact Claude hosts', () => {
    expect(clientTrust('https://claude.ai/api/mcp/auth_callback')).toBe('VERIFIED');
    expect(clientTrust('https://claude.com/api/mcp/auth_callback')).toBe('VERIFIED');
    expect(clientTrust('https://claude.ai.evil.example/cb')).toBe('UNVERIFIED');
    expect(clientTrust('https://evil.claude.ai/cb')).toBe('UNVERIFIED');
  });

  it('labels a loopback redirect as an app on this computer', () => {
    expect(clientTrust('http://127.0.0.1:5123/callback')).toBe('LOOPBACK');
    expect(clientTrust('http://localhost:5123/callback')).toBe('LOOPBACK');
  });

  it('fails closed on garbage', () => {
    expect(clientTrust('not a url')).toBe('UNVERIFIED');
  });
});

describe('CIMD client ids and URLs', () => {
  it('recognises an https URL with a path as a CIMD client id', () => {
    expect(isCimdClientId('https://claude.ai/oauth/mcp-oauth-client-metadata')).toBe(true);
    expect(isCimdClientId('https://claude.ai')).toBe(false);
    expect(isCimdClientId('https://claude.ai/')).toBe(false);
    expect(isCimdClientId('mcl_abc')).toBe(false);
  });

  it.each([
    ['http://claude.ai/meta.json', 'not_https'],
    ['https://user:pw@claude.ai/meta.json', 'invalid_url'],
    ['https://claude.ai/meta.json#x', 'invalid_url'],
    ['https://claude.ai:8443/meta.json', 'invalid_url'],
    ['nonsense', 'invalid_url'],
  ])('refuses %s (%s)', (raw, reason) => {
    expect(parseCimdUrl(raw)).toEqual({ ok: false, reason });
  });

  it('accepts a default-port https URL', () => {
    expect(parseCimdUrl('https://claude.ai:443/meta.json').ok).toBe(true);
  });
});

describe('isPublicUnicastAddress (SSRF guard)', () => {
  it.each([
    ['10.0.0.1', 4],
    ['127.0.0.1', 4],
    ['169.254.169.254', 4],
    ['172.16.0.1', 4],
    ['192.168.1.1', 4],
    ['100.64.0.1', 4],
    ['0.0.0.0', 4],
    ['224.0.0.1', 4],
    ['::1', 6],
    ['fe80::1', 6],
    ['fd00::1', 6],
    ['::ffff:169.254.169.254', 6],
    ['garbage', 4],
  ] as const)('blocks %s', (address, family) => {
    expect(isPublicUnicastAddress(address, family)).toBe(false);
  });

  it.each([
    ['8.8.8.8', 4],
    ['2606:4700::1111', 6],
  ] as const)('allows %s', (address, family) => {
    expect(isPublicUnicastAddress(address, family)).toBe(true);
  });
});

describe('validateClientMetadata', () => {
  const url = 'https://claude.ai/oauth/meta.json';
  const doc = { client_id: url, client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] };

  it('accepts a document whose client_id is its own URL', () => {
    expect(validateClientMetadata(doc, url)).toEqual({ ok: true, metadata: { clientId: url, clientName: 'Claude', redirectUris: doc.redirect_uris } });
  });

  it.each([
    [{ ...doc, client_id: 'https://claude.ai/other.json' }],
    [{ ...doc, client_name: '' }],
    [{ ...doc, redirect_uris: [] }],
    [{ ...doc, redirect_uris: ['http://claude.ai/cb'] }],
    [{ ...doc, token_endpoint_auth_method: 'private_key_jwt' }],
    [[doc]],
    [null],
  ])('refuses %j', (bad) => {
    expect(validateClientMetadata(bad, url)).toEqual({ ok: false, reason: 'malformed_document' });
  });
});

describe('cimdCacheUntil (≤ 24 h)', () => {
  const at = new Date('2026-10-25T00:00:00Z');
  it('follows max-age, capped at a day', () => {
    expect(cimdCacheUntil('public, max-age=600', at).toISOString()).toBe('2026-10-25T00:10:00.000Z');
    expect(cimdCacheUntil('max-age=999999', at).toISOString()).toBe('2026-10-26T00:00:00.000Z');
  });
  it('re-fetches every time on no-store or no-cache, and holds an hour without a header', () => {
    expect(cimdCacheUntil('no-store', at).getTime()).toBe(at.getTime());
    expect(cimdCacheUntil('no-cache, max-age=600', at).getTime()).toBe(at.getTime());
    expect(cimdCacheUntil(undefined, at).toISOString()).toBe('2026-10-25T01:00:00.000Z');
  });
});

/** A fake https.request: emits the scripted response (or error) once the request ends. */
function fakeRequest(script: { status?: number; headers?: Record<string, string>; body?: string; error?: string; lookupAddress?: string; hang?: boolean }) {
  const seen: Array<Record<string, unknown>> = [];
  const requestFn = ((options: Record<string, unknown>, onResponse: (res: EventEmitter & Record<string, unknown>) => void) => {
    seen.push(options);
    const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
    req.destroy = () => undefined;
    req.end = () => {
      if (script.hang) return;
      const lookup = options.lookup as (h: string, o: unknown, cb: (err: (Error & { code?: string }) | null) => void) => void;
      lookup('claude.ai', {}, (err) => {
        if (err) return void req.emit('error', err);
        if (script.error) return void req.emit('error', new Error(script.error));
        const res = new EventEmitter() as EventEmitter & Record<string, unknown>;
        res.statusCode = script.status ?? 200;
        res.headers = script.headers ?? { 'content-type': 'application/json' };
        res.destroy = () => undefined;
        onResponse(res);
        if (script.body !== undefined) res.emit('data', Buffer.from(script.body));
        res.emit('end');
      });
    };
    return req;
  }) as never;
  const lookupFn = ((_h: string, _o: unknown, cb: (err: null, a: Array<{ address: string; family: number }>) => void) =>
    cb(null, [{ address: script.lookupAddress ?? '160.79.104.10', family: 4 }])) as never;
  return { requestFn, lookupFn, seen };
}

describe('fetchClientMetadata (guarded)', () => {
  const url = 'https://claude.ai/oauth/meta.json';
  const body = JSON.stringify({ client_id: url, client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] });

  it('fetches, validates and reports the cache header', async () => {
    const f = fakeRequest({ body, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'max-age=60' } });
    const result = await fetchClientMetadata(url, f);
    expect(result).toEqual({ ok: true, metadata: { clientId: url, clientName: 'Claude', redirectUris: ['https://claude.ai/api/mcp/auth_callback'] }, cacheControl: 'max-age=60' });
    expect(f.seen[0]).toMatchObject({ hostname: 'claude.ai', path: '/oauth/meta.json', method: 'GET' });
  });

  it.each([
    [{ lookupAddress: '10.0.0.5', body }, 'private_address'],
    [{ status: 302, headers: { location: 'http://10.0.0.1/' } }, 'redirect_not_allowed'],
    [{ status: 404 }, 'fetch_failed'],
    [{ headers: { 'content-type': 'text/html' }, body }, 'bad_content_type'],
    [{ headers: { 'content-type': 'application/json', 'content-length': '999999' }, body }, 'too_large'],
    [{ body: 'x'.repeat(20_000) }, 'too_large'],
    [{ body: '{nope' }, 'malformed_document'],
    [{ error: 'ECONNRESET' }, 'fetch_failed'],
  ])('refuses %j with %s', async (script, reason) => {
    expect(await fetchClientMetadata(url, fakeRequest(script))).toEqual({ ok: false, reason });
  });

  it('gives up after the wall-clock budget', async () => {
    expect(await fetchClientMetadata(url, { ...fakeRequest({ hang: true }), timeoutMs: 20 })).toEqual({ ok: false, reason: 'timeout' });
  });

  it('refuses a bad URL without any request', async () => {
    const f = fakeRequest({ body });
    expect(await fetchClientMetadata('http://claude.ai/meta.json', f)).toEqual({ ok: false, reason: 'not_https' });
    expect(f.seen).toHaveLength(0);
  });
});
