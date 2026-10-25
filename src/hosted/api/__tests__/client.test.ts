import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api, ApiError, apiErrorReason, request, setUnauthorisedHandler } from '../client';

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

describe('expenses (MUT-44)', () => {
  const body = { occurredOn: '2026-10-11', amount: '12.50', currency: 'ILS' as const };

  it('createExpense sends idempotency-key and the request body, profile-scoped', async () => {
    fetchMock.mockResolvedValue(json(201, { id: 'e1' }));
    await api.createExpense('org-1', body, 'idem-1');
    const { url, init, headers } = lastCall();
    expect(url).toBe('/v1/expenses');
    expect(init.method).toBe('POST');
    expect(headers.get('idempotency-key')).toBe('idem-1');
    expect(headers.get('x-mutaba3a-profile')).toBe('org-1');
    expect(JSON.parse(String(init.body))).toEqual(body);
  });

  it('updateExpense sends if-match with the given version and PATCHes the expense', async () => {
    fetchMock.mockResolvedValue(json(200, { id: 'e1' }));
    await api.updateExpense('org-1', 'e1', { title: 'Taxi' }, '3');
    const { url, init, headers } = lastCall();
    expect(url).toBe('/v1/expenses/e1');
    expect(init.method).toBe('PATCH');
    expect(headers.get('if-match')).toBe('3');
  });

  it('deleteExpense DELETEs by id, profile-scoped', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await api.deleteExpense('org-1', 'e1');
    const { url, init, headers } = lastCall();
    expect(url).toBe('/v1/expenses/e1');
    expect(init.method).toBe('DELETE');
    expect(headers.get('x-mutaba3a-profile')).toBe('org-1');
  });

  it('expenses lists with cursor pagination', async () => {
    fetchMock.mockResolvedValue(json(200, { items: [], nextCursor: null }));
    await api.expenses('org-1', { limit: 50, cursor: 'c1' });
    expect(lastCall().url).toBe('/v1/expenses?limit=50&cursor=c1');
  });

  it('expense fetches a single expense with receipts', async () => {
    fetchMock.mockResolvedValue(json(200, { id: 'e1' }));
    await api.expense('org-1', 'e1');
    expect(lastCall().url).toBe('/v1/expenses/e1');
  });

  it('expenseCategories lists without an idempotency or if-match header', async () => {
    fetchMock.mockResolvedValue(json(200, { items: [] }));
    await api.expenseCategories('org-1');
    const { url, headers } = lastCall();
    expect(url).toBe('/v1/expense-categories');
    expect(headers.has('idempotency-key')).toBe(false);
  });

  it('expenseSummary sends the date range', async () => {
    fetchMock.mockResolvedValue(json(200, { from: '2026-10-01', to: '2026-10-31', currencies: [] }));
    await api.expenseSummary('org-1', { from: '2026-10-01', to: '2026-10-31' });
    expect(lastCall().url).toBe('/v1/summaries/expenses?from=2026-10-01&to=2026-10-31');
  });

  it('startReceipt POSTs with no idempotency-key (M6 pattern — a repeat leaves an unlisted PENDING row)', async () => {
    fetchMock.mockResolvedValue(json(201, { receipt: { id: 'r1' }, upload: { url: 'https://x', method: 'PUT', headers: {}, expiresAt: '2026-10-11T00:00:00Z' } }));
    await api.startReceipt('org-1', 'e1', { filename: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100 });
    const { url, init, headers } = lastCall();
    expect(url).toBe('/v1/expenses/e1/receipts');
    expect(init.method).toBe('POST');
    expect(headers.has('idempotency-key')).toBe(false);
  });

  it('completeReceipt POSTs to the completion path', async () => {
    fetchMock.mockResolvedValue(json(200, { id: 'r1' }));
    await api.completeReceipt('org-1', 'e1', 'r1');
    expect(lastCall().url).toBe('/v1/expenses/e1/receipts/r1/complete');
  });

  it('deleteReceipt DELETEs the receipt', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await api.deleteReceipt('org-1', 'e1', 'r1');
    expect(lastCall().init.method).toBe('DELETE');
  });

  it('receiptDownload fetches the signed-URL envelope', async () => {
    fetchMock.mockResolvedValue(json(200, { url: 'https://x' }));
    await api.receiptDownload('org-1', 'e1', 'r1');
    expect(lastCall().url).toBe('/v1/expenses/e1/receipts/r1/download');
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

// MUT-262 (D3): a password change rotates the session cookie. A request the page sent with the old cookie can come
// back 401 after the change committed; that is not a sign-out. Same rule as the phone's MUT-208.
describe('a 401 for a cookie the portal no longer holds (MUT-262)', () => {
  const PASSWORD = { currentPassword: 'old one', newPassword: 'a new long passphrase' };
  const isChange = (url: string, init: RequestInit) => init.method === 'POST' && url.endsWith('/v1/me/password');

  /** A fetch whose answers the test releases by hand, in any order. */
  function heldFetch() {
    const held = new Map<string, (r: Response) => void>();
    fetchMock.mockImplementation(
      (url: string, init: RequestInit) =>
        new Promise<Response>((resolve) => {
          held.set(isChange(url, init) ? 'change' : `${init.method} ${url}`, resolve);
        }),
    );
    return (key: string, response: Response) => {
      const resolve = held.get(key);
      if (!resolve) throw new Error(`nothing in flight for ${key}`);
      held.delete(key);
      resolve(response);
    };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('ignores a 401 on a request sent before the change answered', async () => {
    const handler = vi.fn();
    const off = setUnauthorisedHandler(handler);
    const release = heldFetch();
    const stale = api.me().catch((e: unknown) => e);
    const change = api.changePassword(PASSWORD);
    await tick();
    release('change', new Response(null, { status: 204 }));
    await change;
    release('GET /v1/me', json(401, envelope('SESSION_EXPIRED')));
    expect(await stale).toBeInstanceOf(ApiError);
    expect(handler).not.toHaveBeenCalled();
    off();
  });

  it('holds a 401 that lands while the change is in flight, and ignores it once the change succeeds', async () => {
    const handler = vi.fn();
    const off = setUnauthorisedHandler(handler);
    const release = heldFetch();
    const stale = api.me().catch((e: unknown) => e);
    const change = api.changePassword(PASSWORD);
    await tick();
    release('GET /v1/me', json(401, envelope('SESSION_EXPIRED')));
    await tick();
    expect(handler).not.toHaveBeenCalled();
    release('change', new Response(null, { status: 204 }));
    await change;
    expect(await stale).toBeInstanceOf(ApiError);
    expect(handler).not.toHaveBeenCalled();
    off();
  });

  it('passes that held 401 on when the change fails: the session really ended', async () => {
    const handler = vi.fn();
    const off = setUnauthorisedHandler(handler);
    const release = heldFetch();
    const stale = api.me().catch((e: unknown) => e);
    const change = api.changePassword(PASSWORD).catch((e: unknown) => e);
    await tick();
    release('GET /v1/me', json(401, envelope('SESSION_EXPIRED')));
    await tick();
    release('change', json(403, envelope('CURRENT_PASSWORD_WRONG')));
    expect(await change).toMatchObject({ code: 'CURRENT_PASSWORD_WRONG' });
    await stale;
    expect(handler).toHaveBeenCalledTimes(1);
    off();
  });

  it('ends the session on a 401 for a request sent after the change, as before', async () => {
    const handler = vi.fn();
    const off = setUnauthorisedHandler(handler);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await api.changePassword(PASSWORD);
    fetchMock.mockResolvedValueOnce(json(401, envelope('SESSION_EXPIRED')));
    await api.me().catch(() => {});
    expect(handler).toHaveBeenCalledTimes(1);
    off();
  });

  it("a 401 on the change itself reaches the handler without waiting on itself", async () => {
    const handler = vi.fn();
    const off = setUnauthorisedHandler(handler);
    fetchMock.mockResolvedValueOnce(json(401, envelope('SESSION_EXPIRED')));
    await expect(api.changePassword(PASSWORD)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(handler).toHaveBeenCalledTimes(1);
    off();
  });
});

describe('apiErrorReason (MUT-183 R3)', () => {
  const error = (details: unknown) => new ApiError(409, 'CONFLICT', 'm', details);

  it('returns details.reason when it is a string', () => {
    expect(apiErrorReason(error({ reason: 'PROFILE_LIMIT', limit: 6 }))).toBe('PROFILE_LIMIT');
  });

  it('returns undefined for a missing, non-string or absent reason', () => {
    expect(apiErrorReason(error({ limit: 6 }))).toBeUndefined();
    expect(apiErrorReason(error({ reason: 42 }))).toBeUndefined();
    expect(apiErrorReason(error(null))).toBeUndefined();
    expect(apiErrorReason(error(undefined))).toBeUndefined();
  });
});

describe('profile operations (MUT-183)', () => {
  const P = '33333333-3333-4333-8333-333333333333';

  it('creates with the Idempotency-Key and no profile header', async () => {
    fetchMock.mockResolvedValue(json(201, { id: P }));
    await api.createProfile({ name: 'Studio', type: 'BUSINESS', defaultCurrency: 'USD', timezone: 'Asia/Jerusalem' }, 'key-1');
    const { url, init, headers } = lastCall();
    expect(url).toBe('/v1/profiles');
    expect(init.method).toBe('POST');
    expect(headers.get('Idempotency-Key')).toBe('key-1');
    expect(headers.has('X-Mutaba3a-Profile')).toBe(false);
  });

  it('patches with the version it was given as If-Match', async () => {
    fetchMock.mockResolvedValue(json(200, { profile: { id: P }, typeChange: null }));
    await api.updateProfile(P, { name: 'Renamed' }, 3);
    const { url, init, headers } = lastCall();
    expect(url).toBe(`/v1/profiles/${P}`);
    expect(init.method).toBe('PATCH');
    expect(headers.get('If-Match')).toBe('3');
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Renamed' });
  });

  it('previews a type change with ?to=', async () => {
    fetchMock.mockResolvedValue(json(200, { uncategorizedExpenses: 12, deletedCategories: 9, preset: 'general' }));
    await expect(api.profileTypeChangePreview(P, 'BUSINESS')).resolves.toEqual({ uncategorizedExpenses: 12, deletedCategories: 9, preset: 'general' });
    expect(lastCall().url).toBe(`/v1/profiles/${P}/type-change?to=BUSINESS`);
  });
});
