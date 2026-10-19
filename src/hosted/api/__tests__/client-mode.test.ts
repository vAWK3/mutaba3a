import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODE_KEY, setMode } from '../../session/mode';

/**
 * Where `request()` sends a call (MUT-286, brief §2.6): the server for a
 * `remote` hint, the local backend for `local`, and with no hint one probe of
 * `/v1/me` decides. Sign-in and setup always go to the server. The local
 * backend is faked here (its own tests drive the real one); `fetch` is a spy.
 */

const localFetch = vi.fn<(request: Request) => Promise<Response>>();
const boot = vi.fn();

vi.mock('@mut/local-backend', () => ({ bootLocalBackend: () => boot() }));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ME = { user: { id: 'u' }, profiles: [] };

async function freshClient() {
  vi.resetModules();
  return import('../client');
}

describe('request() by mode', () => {
  const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

  beforeEach(() => {
    localStorage.clear();
    fetchSpy.mockReset();
    localFetch.mockReset();
    boot.mockReset();
    boot.mockResolvedValue({ fetch: localFetch, onRemoteWrite: () => () => {}, exportRecords: () => Promise.resolve(new Blob()), readRecordsFile: vi.fn() });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('remote: the server answers, the local chunk is never loaded', async () => {
    const { api } = await freshClient();
    setMode('remote');
    fetchSpy.mockImplementation(() => Promise.resolve(json(200, ME)));

    await api.me();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(boot).not.toHaveBeenCalled();
  });

  it('local: the local backend answers the same call, as a Request for the page origin', async () => {
    const { api } = await freshClient();
    setMode('local');
    localFetch.mockImplementation(() => Promise.resolve(json(200, ME)));

    const me = await api.me();

    expect(me).toEqual(ME);
    expect(fetchSpy).not.toHaveBeenCalled();
    const sent = localFetch.mock.calls[0]?.[0];
    expect(new URL(sent!.url).pathname).toBe('/v1/me');
  });

  it('local: sign-in still goes to the server (brief §2.6)', async () => {
    const { api } = await freshClient();
    setMode('local');
    fetchSpy.mockResolvedValue(json(201, ME));

    await api.signIn({ email: 'a@b.ps', password: 'secret-password' });

    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/v1/sessions');
    expect(localFetch).not.toHaveBeenCalled();
  });

  it('local: a setup link is checked by the server', async () => {
    const { api } = await freshClient();
    setMode('local');
    fetchSpy.mockResolvedValue(json(200, { state: 'valid' }));

    await api.checkSetupLink('token');

    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/v1/account-setup/check');
  });

  // `freshClient()` loads a new mode module too, which starts at production's default (`probe`), not the test
  // setup's pinned `remote`: with localStorage cleared, these calls really have no hint.
  describe('no hint', () => {

    it('a 401 from the probe means nobody is signed in: local, and remembered', async () => {
      const { api } = await freshClient();
      fetchSpy.mockResolvedValue(json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }));
      localFetch.mockImplementation(() => Promise.resolve(json(200, ME)));

      await api.me();
      await api.me();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(localFetch).toHaveBeenCalledTimes(2);
      expect(localStorage.getItem(MODE_KEY)).toBe('local');
    });

    it('a 200 from the probe means a live session from before local mode: remote, and remembered', async () => {
      const { api } = await freshClient();
      fetchSpy.mockImplementation(() => Promise.resolve(json(200, ME)));

      await api.me();

      expect(localStorage.getItem(MODE_KEY)).toBe('remote');
      expect(boot).not.toHaveBeenCalled();
    });

    it('an outage decides nothing: the server is asked, nothing is saved, and the next call probes again', async () => {
      const { api, ApiError } = await freshClient();
      fetchSpy.mockResolvedValue(json(503, { error: { code: 'UNAVAILABLE', message: 'down' } }));

      await expect(api.me()).rejects.toBeInstanceOf(ApiError);
      await expect(api.me()).rejects.toBeInstanceOf(ApiError);

      expect(localStorage.getItem(MODE_KEY)).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(4); // probe + request, twice
      expect(boot).not.toHaveBeenCalled();
    });

    it('offline decides nothing either: a network error, no hint saved', async () => {
      const { api } = await freshClient();
      fetchSpy.mockRejectedValue(new TypeError('offline'));

      await expect(api.me()).rejects.toMatchObject({ code: 'NETWORK' });
      expect(localStorage.getItem(MODE_KEY)).toBeNull();
    });
  });

  it('a local 401 never ends a session: only the server\'s does', async () => {
    const { api, setUnauthorisedHandler } = await freshClient();
    setMode('local');
    const onUnauthorised = vi.fn();
    setUnauthorisedHandler(onUnauthorised);
    localFetch.mockResolvedValue(json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }));

    await expect(api.customers('p')).rejects.toMatchObject({ status: 401 });

    expect(onUnauthorised).not.toHaveBeenCalled();
  });

  it.each([
    ['LocalFormatTooNewError', 'LOCAL_FORMAT_TOO_NEW'],
    ['LocalSaveFailedError', 'LOCAL_SAVE_FAILED'],
  ])('%s stops the page: its own error, and the stop handler hears it (D1, review)', async (name, code) => {
    const { api, setLocalStopHandler } = await freshClient();
    setMode('local');
    const onStop = vi.fn();
    setLocalStopHandler(onStop);
    const stop = new Error('stop');
    stop.name = name;
    localFetch.mockRejectedValue(stop);

    await expect(api.customers('p')).rejects.toMatchObject({ code });
    expect(onStop).toHaveBeenCalledWith(code);
  });

  it('a server that can\'t be reached is still NETWORK, and never stops the page', async () => {
    const { api, setLocalStopHandler } = await freshClient();
    setMode('remote');
    const onStop = vi.fn();
    setLocalStopHandler(onStop);
    fetchSpy.mockRejectedValue(new TypeError('offline'));

    await expect(api.me()).rejects.toMatchObject({ code: 'NETWORK' });
    expect(onStop).not.toHaveBeenCalled();
  });

  it('a local backend that can\'t run is its own error, not "offline", and is retried on the next call (review)', async () => {
    const { api } = await freshClient();
    setMode('local');
    boot.mockRejectedValueOnce(new Error('IndexedDB blocked'));
    localFetch.mockImplementation(() => Promise.resolve(json(200, ME)));

    await expect(api.me()).rejects.toMatchObject({ code: 'LOCAL_UNAVAILABLE' });
    await expect(api.me()).resolves.toEqual(ME);
    expect(boot).toHaveBeenCalledTimes(2);
  });
});
