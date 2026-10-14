import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { getRepositories, setRepositories, resetRepositories, type Repositories } from '../../db/provider';
import { DEFAULT_SETTINGS } from '../../db/defaultSettings';
import type { Settings } from '../../types';
import { useDismissMalafatMoment, useMalafatSuggestions, useSetMalafatSuggestionsOn } from '../useMalafatSuggestions';

/** In memory, like the Dexie repository: `update()` replaces top-level fields only. */
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
  return { read: () => row };
}

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

afterEach(() => resetRepositories());

describe('useMalafatSuggestions', () => {
  it('reports nothing until the settings row has loaded, so a dismissed card never flashes', async () => {
    installFakeSettings({ malafatSuggestions: { off: true } });
    const { result } = renderHook(() => useMalafatSuggestions(), { wrapper: wrapper() });
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toEqual({ on: false, dismissed: [] }));
  });

  it('dismissing keeps the switch, and switching keeps the dismissals (the repository replaces nested fields)', async () => {
    const store = installFakeSettings({ enabledCurrencies: ['USD'], malafatSuggestions: { off: true, dismissed: ['settings' as never] } });
    const Wrapper = wrapper();
    const dismiss = renderHook(() => useDismissMalafatMoment(), { wrapper: Wrapper });
    await act(() => dismiss.result.current.mutateAsync('client-threshold'));
    expect(store.read().malafatSuggestions).toEqual({ off: true, dismissed: ['client-threshold'] });

    const setOn = renderHook(() => useSetMalafatSuggestionsOn(), { wrapper: Wrapper });
    await act(() => setOn.result.current.mutateAsync(true));
    expect(store.read().malafatSuggestions).toEqual({ off: false, dismissed: ['client-threshold'] });
    expect(store.read().enabledCurrencies).toEqual(['USD']);
  });

  it('records a moment once however often it is dismissed', async () => {
    const store = installFakeSettings();
    const { result } = renderHook(() => useDismissMalafatMoment(), { wrapper: wrapper() });
    await act(() => result.current.mutateAsync('second-business'));
    await act(() => result.current.mutateAsync('second-business'));
    expect(store.read().malafatSuggestions?.dismissed).toEqual(['second-business']);
  });
});
