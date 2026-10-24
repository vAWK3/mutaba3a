import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  SIGNUP_DOOR_TIMEOUT_MS,
  fetchSignupOpen,
  resetSignupDoorForTests,
  signupHref,
  signupOpenOnce,
  useSignupUrl,
} from '../signupDoor';

const PORTAL = 'https://portal.example';

const answer = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

afterEach(() => {
  resetSignupDoorForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('fetchSignupOpen (MUT-369, D1/D3)', () => {
  it('is open only when the server says signup: true', async () => {
    expect(await fetchSignupOpen(PORTAL, answer({ signup: true, recovery: true }))).toBe(true);
    expect(await fetchSignupOpen(PORTAL, answer({ signup: false, recovery: true }))).toBe(false);
  });

  it('asks the portal origin for the doors', async () => {
    const fetchFn = answer({ signup: true, recovery: true });
    await fetchSignupOpen(PORTAL, fetchFn);
    expect(fetchFn).toHaveBeenCalledWith(`${PORTAL}/v1/self-service`, expect.anything());
  });

  it('reads closed on anything but a clear yes: an error status, a bad body, a wrong shape, a network failure', async () => {
    expect(await fetchSignupOpen(PORTAL, answer({ signup: true }, 500))).toBe(false);
    expect(await fetchSignupOpen(PORTAL, vi.fn(async () => new Response('not json', { status: 200 })))).toBe(false);
    expect(await fetchSignupOpen(PORTAL, answer({ signup: 'yes' }))).toBe(false);
    expect(await fetchSignupOpen(PORTAL, answer(null))).toBe(false);
    expect(await fetchSignupOpen(PORTAL, vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))).toBe(false);
  });

  it(`reads closed when the server takes longer than ${SIGNUP_DOOR_TIMEOUT_MS} ms`, async () => {
    vi.useFakeTimers();
    const slow = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    );
    const result = fetchSignupOpen(PORTAL, slow);
    await vi.advanceTimersByTimeAsync(SIGNUP_DOOR_TIMEOUT_MS);
    expect(await result).toBe(false);
  });

  it('stays a CORS-simple request: no credentials, no custom headers, never cached (D17)', async () => {
    const fetchFn = answer({ signup: true, recovery: true });
    await fetchSignupOpen(PORTAL, fetchFn);
    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.credentials).toBe('omit');
    expect(init.cache).toBe('no-store');
    expect(init.method ?? 'GET').toBe('GET');
    expect(init.headers).toBeUndefined();
  });
});

describe('signupOpenOnce', () => {
  it('asks once per page load, however many parts want the answer', async () => {
    const fetchFn = answer({ signup: true, recovery: true });
    await Promise.all([signupOpenOnce(PORTAL, fetchFn), signupOpenOnce(PORTAL, fetchFn)]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('signupHref', () => {
  it('opens the portal signup page in the page language', () => {
    expect(signupHref(PORTAL, 'en')).toBe(`${PORTAL}/signup?lang=en`);
    expect(signupHref(PORTAL, 'ar')).toBe(`${PORTAL}/signup?lang=ar`);
  });
});

describe('useSignupUrl', () => {
  it('is null with no portal URL (tests, desktop) and asks nothing', () => {
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    const { result } = renderHook(() => useSignupUrl('en'));
    expect(result.current).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('is null until the server says open, then the signup link in the page language', async () => {
    vi.stubGlobal('__PORTAL_URL__', PORTAL);
    vi.stubGlobal('fetch', answer({ signup: true, recovery: true }));
    const { result, rerender } = renderHook(({ language }) => useSignupUrl(language), { initialProps: { language: 'ar' as 'ar' | 'en' } });
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe(`${PORTAL}/signup?lang=ar`));
    act(() => rerender({ language: 'en' }));
    expect(result.current).toBe(`${PORTAL}/signup?lang=en`);
  });

  it('stays null while signup is closed', async () => {
    vi.stubGlobal('__PORTAL_URL__', PORTAL);
    const fetchFn = answer({ signup: false, recovery: true });
    vi.stubGlobal('fetch', fetchFn);
    const { result } = renderHook(() => useSignupUrl('en'));
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current).toBeNull();
  });
});
