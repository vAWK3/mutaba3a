import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { fetchLatestRelease, useLatestRelease } from '../useLatestRelease';
import { useCheckForUpdates } from '../useCheckForUpdates';

/**
 * The release fetch feeds the landing hero, its header button and Get it
 * section, the Download page and the desktop update check (MUT-77 R6). These
 * pin what all of them rely on before concurrent callers start sharing one
 * request.
 */

const GITHUB_RELEASE = {
  tag_name: 'v0.1.4',
  html_url: 'https://github.com/vAWK3/mutaba3a/releases/tag/v0.1.4',
  assets: [{ name: 'Mutaba3a_0.1.4_aarch64.dmg' }, { name: 'Mutaba3a_0.1.4_x64_en-US.msi' }],
};

function okResponse() {
  return { ok: true, status: 200, json: async () => GITHUB_RELEASE } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  sessionStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useLatestRelease', () => {
  it('serves a fresh sessionStorage entry without calling GitHub', async () => {
    sessionStorage.setItem(
      'latest-release-info',
      JSON.stringify({
        version: '0.1.3',
        releaseNotesUrl: 'https://example.test/notes',
        hasMacBuild: true,
        hasWindowsBuild: false,
        timestamp: Date.now(),
      }),
    );

    const { result } = renderHook(() => useLatestRelease());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.release).toEqual({
      version: '0.1.3',
      releaseNotesUrl: 'https://example.test/notes',
      hasMacBuild: true,
      hasWindowsBuild: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('makes one GitHub call when two parts of the page ask at once, and both get the release', async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);

    const hero = renderHook(() => useLatestRelease());
    const getIt = renderHook(() => useLatestRelease());
    pending.resolve(okResponse());

    await waitFor(() => expect(hero.result.current.isLoading).toBe(false));
    await waitFor(() => expect(getIt.result.current.isLoading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const { result } of [hero, getIt]) {
      expect(result.current.release).toEqual({
        version: '0.1.4',
        releaseNotesUrl: GITHUB_RELEASE.html_url,
        hasMacBuild: true,
        hasWindowsBuild: true,
      });
    }
  });

  it('gives both callers the error when the shared call fails, and the next call asks GitHub again', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403 } as Response);

    const hero = renderHook(() => useLatestRelease());
    const getIt = renderHook(() => useLatestRelease());

    await waitFor(() => expect(hero.result.current.isLoading).toBe(false));
    await waitFor(() => expect(getIt.result.current.isLoading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hero.result.current).toEqual({ release: null, isLoading: false, error: 'GitHub API returned 403' });
    expect(getIt.result.current.error).toBe('GitHub API returned 403');

    fetchMock.mockResolvedValueOnce(okResponse());
    await expect(fetchLatestRelease()).resolves.toMatchObject({ version: '0.1.4' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('useCheckForUpdates after the landing fetch settled', () => {
  it('still asks GitHub for its own check', async () => {
    // Vite defines the app version at build time; Vitest doesn't.
    vi.stubGlobal('__APP_VERSION__', '0.1.3');
    fetchMock.mockResolvedValue(okResponse());
    await fetchLatestRelease();

    const { result } = renderHook(() => useCheckForUpdates());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.latestVersion).toBe('0.1.4');
  });
});
