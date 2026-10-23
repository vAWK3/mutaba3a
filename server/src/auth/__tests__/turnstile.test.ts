import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { createTurnstileVerifier, isTurnstileTestSecret, SITEVERIFY_URL, TURNSTILE_TEST_SECRETS } from '../turnstile.js';

/**
 * MUT-366 (ADR-159 §7, D7): the server verifies the Turnstile token itself and fails closed. Cloudflare's published
 * test secrets are answered locally, so dev, CI and QA make no call to Cloudflare.
 */
const logger = pino({ level: 'silent' });
const CONTEXT = { ip: '203.0.113.7', action: 'signup' as const, idempotencyKey: 'req-1' };
const LIVE_SECRET = '0x4AAAAAAAlivesecretfortests_00000';

function answering(status: number, body: unknown) {
  return vi.fn<typeof fetch>(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

describe('Turnstile test secrets (MUT-366, D7)', () => {
  it('knows Cloudflare’s published test secrets', () => {
    expect(isTurnstileTestSecret(TURNSTILE_TEST_SECRETS.pass)).toBe(true);
    expect(isTurnstileTestSecret(TURNSTILE_TEST_SECRETS.fail)).toBe(true);
    expect(isTurnstileTestSecret(TURNSTILE_TEST_SECRETS.spent)).toBe(true);
    expect(isTurnstileTestSecret(LIVE_SECRET)).toBe(false);
  });

  it('answers them locally, without calling Cloudflare', async () => {
    const fetch = answering(200, { success: true });
    const pass = createTurnstileVerifier({ secret: TURNSTILE_TEST_SECRETS.pass, fetch, logger });
    const fail = createTurnstileVerifier({ secret: TURNSTILE_TEST_SECRETS.fail, fetch, logger });
    const spent = createTurnstileVerifier({ secret: TURNSTILE_TEST_SECRETS.spent, fetch, logger });
    expect(pass.mode).toBe('test');
    expect(await pass.verify('XXXX.DUMMY.TOKEN.XXXX', CONTEXT)).toBe(true);
    expect(await fail.verify('XXXX.DUMMY.TOKEN.XXXX', CONTEXT)).toBe(false);
    expect(await spent.verify('XXXX.DUMMY.TOKEN.XXXX', CONTEXT)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses an empty token even with the always-pass secret', async () => {
    const pass = createTurnstileVerifier({ secret: TURNSTILE_TEST_SECRETS.pass, logger });
    expect(await pass.verify('', CONTEXT)).toBe(false);
  });
});

describe('Turnstile siteverify (MUT-366)', () => {
  it('posts the secret, the token, the client address and the idempotency key, and passes on success', async () => {
    const fetch = answering(200, { success: true, action: 'signup', hostname: 'portal.example.test' });
    const verifier = createTurnstileVerifier({ secret: LIVE_SECRET, fetch, logger });
    expect(verifier.mode).toBe('live');
    expect(await verifier.verify('token-abc', CONTEXT)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(SITEVERIFY_URL);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ secret: LIVE_SECRET, response: 'token-abc', remoteip: '203.0.113.7', idempotency_key: 'req-1' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('leaves the address out when the client address is unknown', async () => {
    const fetch = answering(200, { success: true });
    await createTurnstileVerifier({ secret: LIVE_SECRET, fetch, logger }).verify('token-abc', { ...CONTEXT, ip: null });
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).not.toHaveProperty('remoteip');
  });

  it('fails closed on success:false', async () => {
    const fetch = answering(200, { success: false, 'error-codes': ['invalid-input-response'] });
    expect(await createTurnstileVerifier({ secret: LIVE_SECRET, fetch, logger }).verify('t', CONTEXT)).toBe(false);
  });

  it('fails closed on a token minted for another form', async () => {
    const fetch = answering(200, { success: true, action: 'recover' });
    expect(await createTurnstileVerifier({ secret: LIVE_SECRET, fetch, logger }).verify('t', CONTEXT)).toBe(false);
  });

  it('fails closed on a non-200 answer, a body that is not JSON, a network error and a timeout', async () => {
    expect(await createTurnstileVerifier({ secret: LIVE_SECRET, fetch: answering(500, { success: true }), logger }).verify('t', CONTEXT)).toBe(false);
    expect(await createTurnstileVerifier({ secret: LIVE_SECRET, fetch: answering(200, '<html>'), logger }).verify('t', CONTEXT)).toBe(false);
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await createTurnstileVerifier({ secret: LIVE_SECRET, fetch: down, logger }).verify('t', CONTEXT)).toBe(false);
    const hangs = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
    );
    expect(await createTurnstileVerifier({ secret: LIVE_SECRET, fetch: hangs, logger, timeoutMs: 20 }).verify('t', CONTEXT)).toBe(false);
  });

  it('never calls Cloudflare for an empty token', async () => {
    const fetch = answering(200, { success: true });
    expect(await createTurnstileVerifier({ secret: LIVE_SECRET, fetch, logger }).verify('', CONTEXT)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
