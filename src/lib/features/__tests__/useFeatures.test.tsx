import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { getRepositories, setRepositories, resetRepositories, type Repositories } from '../../../db/provider';
import { DEFAULT_SETTINGS } from '../../../db/defaultSettings';
import type { Settings } from '../../../types';
import { DEFAULT_FEATURES } from '../features';
import {
  useFeatureEnabled,
  useFeatureFlags,
  useSetFeatureEnabled,
  useFeatureNotice,
  readFeatureFlags,
} from '../useFeatures';

/**
 * A settings repository that lives in memory and behaves like the Dexie one:
 * `get()` resolves nothing extra (the hooks must do their own resolving),
 * `update()` replaces top-level fields.
 */
function installFakeSettings(initial: Partial<Settings> = {}) {
  let row: Settings = { ...DEFAULT_SETTINGS, ...initial };
  const settings = {
    get: vi.fn(async () => ({ ...row })),
    update: vi.fn(async (data: Partial<Settings>) => {
      row = { ...row, ...data, id: 'default' };
    }),
  };
  const real = getRepositories();
  setRepositories({ ...real, base: { ...real.base, settings } } as Repositories);
  return { settings, read: () => row };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

afterEach(() => {
  resetRepositories();
});

describe('useFeatureEnabled', () => {
  it('is off while loading and off when the row has no features', async () => {
    installFakeSettings();
    const { result } = renderHook(() => useFeatureEnabled('expenses'), { wrapper: createWrapper() });

    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('reflects a stored true', async () => {
    installFakeSettings({ features: { expenses: true } });
    const { result } = renderHook(() => useFeatureEnabled('expenses'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current).toBe(true));
  });
});

describe('useFeatureFlags', () => {
  it('returns the resolved map and keeps the same reference across re-renders', async () => {
    installFakeSettings({ features: { projects: true } });
    const { result, rerender } = renderHook(() => useFeatureFlags(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.projects).toBe(true));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    expect(result.current).toEqual({ ...DEFAULT_FEATURES, projects: true });
  });
});

describe('useSetFeatureEnabled', () => {
  it('writes the full resolved map and takes effect immediately for readers', async () => {
    const fake = installFakeSettings();
    const wrapper = createWrapper();
    const { result } = renderHook(
      () => ({ enabled: useFeatureEnabled('expenses'), set: useSetFeatureEnabled() }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.enabled).toBe(false));
    await act(async () => {
      await result.current.set.mutateAsync({ key: 'expenses', enabled: true });
    });

    expect(fake.settings.update).toHaveBeenCalledWith({
      features: { ...DEFAULT_FEATURES, expenses: true },
    });
    await waitFor(() => expect(result.current.enabled).toBe(true));
  });

  it('can switch an area off again without touching the others', async () => {
    const fake = installFakeSettings({ features: { expenses: true, projects: true } });
    const { result } = renderHook(() => useSetFeatureEnabled(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ key: 'expenses', enabled: false });
    });

    expect(fake.read().features).toEqual({ ...DEFAULT_FEATURES, projects: true });
  });
});

describe('useFeatureNotice', () => {
  it('exposes the pending notice and clears it on dismiss', async () => {
    const fake = installFakeSettings({ features: { projects: true }, featureNotice: ['projects'] });
    const { result } = renderHook(() => useFeatureNotice(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.notice).toEqual(['projects']);

    await act(async () => {
      await result.current.dismiss();
    });

    expect(fake.settings.update).toHaveBeenCalledWith({ featureNotice: undefined });
    expect(fake.read().featureNotice).toBeUndefined();
    expect(fake.read().features).toEqual({ projects: true });
    await waitFor(() => expect(result.current.notice).toEqual([]));
  });

  it('reports an empty notice and not-loaded before the query resolves', () => {
    installFakeSettings();
    const { result } = renderHook(() => useFeatureNotice(), { wrapper: createWrapper() });
    expect(result.current.notice).toEqual([]);
    expect(result.current.isLoaded).toBe(false);
  });
});

describe('readFeatureFlags', () => {
  it('resolves from the repository without React', async () => {
    installFakeSettings({ features: { retainers: true } });
    expect(await readFeatureFlags()).toEqual({ ...DEFAULT_FEATURES, retainers: true });
  });

  it('resolves defaults for a row without features', async () => {
    installFakeSettings();
    expect(await readFeatureFlags()).toEqual(DEFAULT_FEATURES);
  });
});
