import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api, ApiError, request, setUnauthorisedHandler } from '../client';

const fetchMock = vi.fn();

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function envelope(code: string, details?: unknown) {
  return { error: { code, message: 'm', details, requestId: 'req-1' } };
}

function lastCall(): { url: string; init: RequestInit; headers: Headers } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, headers: new Headers(init.headers) };
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('request', () => {
  it('sends same-origin credentials and JSON accept, never Authorization', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true }));
    await request('GET', '/v1/me');
    const { init, headers } = lastCall();
    expect(init.credentials).toBe('same-origin');
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.has('authorization')).toBe(false);
  });

  it('sends X-Mutaba3a-Profile on profile-scoped calls only', async () => {
    fetchMock.mockResolvedValue(json(200, { items: [], nextCursor: null }));
    await api.receivables('org-1', {});
    expect(lastCall().headers.get('x-mutaba3a-profile')).toBe('org-1');
    fetchMock.mockResolvedValue(json(200, { user: {}, profiles: [] }));
    await api.me();
    expect(lastCall().headers.has('x-mutaba3a-profile')).toBe(false);
  });

  it('drops empty query values and encodes the rest', async () => {
    fetchMock.mockResolvedValue(json(200, { items: [], nextCursor: null }));
    await api.receivables('org-1', { status: 'OPEN', customerId: undefined, dueAfter: '', cursor: 'a b&c' });
    expect(lastCall().url).toBe('/v1/receivables?status=OPEN&cursor=a+b%26c');
  });

  it('sends a JSON body on sign-in', async () => {
    fetchMock.mockResolvedValue(json(201, { user: {}, profiles: [] }));
    await api.signIn({ email: 'a@b.ps', password: 'pw' });
    const { init, headers } = lastCall();
    expect(init.method).toBe('POST');
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({ email: 'a@b.ps', password: 'pw' });
  });

  it('returns undefined for 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.signOut()).resolves.toBeUndefined();
  });
});

describe('errors', () => {
  it('parses the server envelope into ApiError', async () => {
    fetchMock.mockResolvedValue(json(403, envelope('READ_ONLY_PROFILE', { domain: 'payments', writerOfRecord: 'MALAFAT' })));
    const error = await request('GET', '/v1/payments', { profileId: 'o' }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, code: 'READ_ONLY_PROFILE', requestId: 'req-1' });
    expect(error.details).toEqual({ domain: 'payments', writerOfRecord: 'MALAFAT' });
  });

  it('reads Retry-After on 429', async () => {
    fetchMock.mockResolvedValue(json(429, envelope('RATE_LIMITED', { retryAfterSeconds: 90 }), { 'Retry-After': '150' }));
    const error = await api.signIn({ email: 'a@b.ps', password: 'x' }).catch((e) => e);
    expect(error).toMatchObject({ status: 429, code: 'RATE_LIMITED', retryAfterSeconds: 150 });
  });

  it('maps a body that is not the envelope to UNKNOWN', async () => {
    fetchMock.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }));
    await expect(api.me()).rejects.toMatchObject({ status: 502, code: 'UNKNOWN' });
  });

  it('maps a thrown fetch to NETWORK with status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api.me()).rejects.toMatchObject({ status: 0, code: 'NETWORK' });
  });
});

describe('unauthorised handler', () => {
  it('fires once for a 401 from any call except sign-in', async () => {
    const handler = vi.fn();
    const off = setUnauthorisedHandler(handler);
    fetchMock.mockResolvedValue(json(401, envelope('SESSION_EXPIRED')));
    await api.receivables('o', {}).catch(() => {});
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({ code: 'SESSION_EXPIRED' });

    fetchMock.mockResolvedValue(json(401, envelope('INVALID_CREDENTIALS')));
    await api.signIn({ email: 'a@b.ps', password: 'x' }).catch(() => {});
    expect(handler).toHaveBeenCalledTimes(1);
    off();
  });

  it('stops firing once unregistered', async () => {
    const handler = vi.fn();
    setUnauthorisedHandler(handler)();
    fetchMock.mockResolvedValue(json(401, envelope('UNAUTHENTICATED')));
    await api.me().catch(() => {});
    expect(handler).not.toHaveBeenCalled();
  });
});
