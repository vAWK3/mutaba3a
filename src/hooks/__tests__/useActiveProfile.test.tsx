import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useActiveProfile, useProfileFilter, useOwedLens } from '../useActiveProfile';
import * as profileStore from '../../lib/profileStore';
import * as useQueries from '../useQueries';
import type { BusinessProfile } from '../../types';

// Mock the profile store
vi.mock('../../lib/profileStore', () => ({
  useProfileStore: vi.fn(),
}));

// Mock useQueries hooks
vi.mock('../useQueries', () => ({
  useBusinessProfiles: vi.fn(),
  useDefaultBusinessProfile: vi.fn(),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

const mockProfile1: BusinessProfile = {
  id: 'profile-1',
  name: 'Test Business 1',
  isDefault: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockProfile2: BusinessProfile = {
  id: 'profile-2',
  name: 'Test Business 2',
  isDefault: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const store = {
  setActiveProfile: vi.fn(),
  setWorkingProfile: vi.fn(),
  setAllBusinesses: vi.fn(),
};

/** The store as the hook reads it: the working business, the lens and the screen (MUT-89) */
function mockStore(state: { activeProfileId?: string; allBusinesses?: boolean; onOwedScreen?: boolean } = {}) {
  (profileStore.useProfileStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    activeProfileId: '',
    allBusinesses: false,
    onOwedScreen: false,
    ...state,
    ...store,
  });
}

function mockProfiles(profiles: BusinessProfile[], options: { loading?: boolean; defaultProfile?: BusinessProfile } = {}) {
  (useQueries.useBusinessProfiles as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    data: profiles,
    isLoading: options.loading ?? false,
  });
  (useQueries.useDefaultBusinessProfile as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    data: 'defaultProfile' in options ? options.defaultProfile : profiles.find((p) => p.isDefault),
    isLoading: false,
  });
}

describe('useActiveProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore();
    mockProfiles([mockProfile1]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('single profile scenarios', () => {
    it('should return single profile as active when only one exists', async () => {
      const { result } = renderHook(() => useActiveProfile(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.activeProfile).toEqual(mockProfile1);
      expect(result.current.activeProfileId).toBe('profile-1');
      expect(result.current.isAllProfiles).toBe(false);
      expect(result.current.showAllProfilesOption).toBe(false);
    });

    it('should return profiles list', async () => {
      const { result } = renderHook(() => useActiveProfile(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.profiles).toHaveLength(1);
      });

      expect(result.current.profiles[0]).toEqual(mockProfile1);
    });

    it('ignores a chosen All businesses with only one business (AC1)', () => {
      mockStore({ activeProfileId: 'profile-1', allBusinesses: true, onOwedScreen: true });
      const { result } = renderHook(() => useActiveProfile(), { wrapper: createWrapper() });

      expect(result.current.isAllProfiles).toBe(false);
      expect(result.current.showAllProfilesOption).toBe(false);
      expect(result.current.activeProfileId).toBe('profile-1');
    });
  });

  describe('multiple profile scenarios', () => {
    beforeEach(() => {
      mockProfiles([mockProfile1, mockProfile2]);
    });

    it('offers All businesses only on Home and Clients (AC1, O2)', () => {
      mockStore({ activeProfileId: 'profile-1', onOwedScreen: false });
      const offScreen = renderHook(() => useActiveProfile(), { wrapper: createWrapper() });
      expect(offScreen.result.current.showAllProfilesOption).toBe(false);

      mockStore({ activeProfileId: 'profile-1', onOwedScreen: true });
      const onScreen = renderHook(() => useActiveProfile(), { wrapper: createWrapper() });
      expect(onScreen.result.current.showAllProfilesOption).toBe(true);
    });

    it('is in All businesses only with the lens chosen, on an owed screen', () => {
      mockStore({ activeProfileId: 'profile-1', allBusinesses: true, onOwedScreen: true });
      expect(renderHook(() => useActiveProfile(), { wrapper: createWrapper() }).result.current.isAllProfiles).toBe(true);

      mockStore({ activeProfileId: 'profile-1', allBusinesses: true, onOwedScreen: false });
      expect(renderHook(() => useActiveProfile(), { wrapper: createWrapper() }).result.current.isAllProfiles).toBe(false);

      mockStore({ activeProfileId: 'profile-1', allBusinesses: false, onOwedScreen: true });
      expect(renderHook(() => useActiveProfile(), { wrapper: createWrapper() }).result.current.isAllProfiles).toBe(false);
    });

    it('keeps the working business as the active one while All businesses is on (AC3)', () => {
      mockStore({ activeProfileId: 'profile-2', allBusinesses: true, onOwedScreen: true });
      const { result } = renderHook(() => useActiveProfile(), { wrapper: createWrapper() });

      expect(result.current.activeProfileId).toBe('profile-2');
      expect(result.current.activeProfile).toEqual(mockProfile2);
    });

    it('falls back to the default business with All kept on, after a legacy "all" (D5)', async () => {
      mockStore({ activeProfileId: '', allBusinesses: true, onOwedScreen: true });
      const { result } = renderHook(() => useActiveProfile(), { wrapper: createWrapper() });

      expect(result.current.activeProfileId).toBe('profile-1');
      expect(result.current.isAllProfiles).toBe(true);
      await waitFor(() => expect(store.setWorkingProfile).toHaveBeenCalledWith('profile-1'));
      expect(store.setActiveProfile).not.toHaveBeenCalled();
    });

    it('should return specific profile when selected', async () => {
      mockStore({ activeProfileId: 'profile-2' });

      const { result } = renderHook(() => useActiveProfile(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.activeProfile).toEqual(mockProfile2);
      });
    });

    it('should allow setting active profile', async () => {
      const { result } = renderHook(() => useActiveProfile(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        result.current.setActiveProfile('profile-2');
      });

      expect(store.setActiveProfile).toHaveBeenCalledWith('profile-2');
    });

    it('turns All businesses on and off through its own setter (D6)', () => {
      mockStore({ activeProfileId: 'profile-1', onOwedScreen: true });
      const { result } = renderHook(() => useActiveProfile(), { wrapper: createWrapper() });

      act(() => result.current.setAllBusinesses(true));
      expect(store.setAllBusinesses).toHaveBeenCalledWith(true);
      expect(store.setActiveProfile).not.toHaveBeenCalled();

      act(() => result.current.setAllBusinesses(false));
      expect(store.setAllBusinesses).toHaveBeenCalledWith(false);
    });

    it('should not set invalid profile ID via handleSetActiveProfile', async () => {
      const { result } = renderHook(() => useActiveProfile(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        result.current.setActiveProfile('invalid-id');
      });

      // When an invalid ID is passed to handleSetActiveProfile, it should not call the store
      expect(store.setActiveProfile).not.toHaveBeenCalledWith('invalid-id');
    });
  });

  it('cannot turn All businesses on with one business', () => {
    mockStore({ activeProfileId: 'profile-1', onOwedScreen: true });
    const { result } = renderHook(() => useActiveProfile(), { wrapper: createWrapper() });

    act(() => result.current.setAllBusinesses(true));
    expect(store.setAllBusinesses).not.toHaveBeenCalled();
  });

  describe('fallback scenarios', () => {
    it('should fallback to default profile when stored ID is invalid', async () => {
      mockStore({ activeProfileId: 'non-existent-id' });

      const { result } = renderHook(() => useActiveProfile(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.activeProfileId).toBe('profile-1');
      });
    });

    it('repairs a missing working business without picking one, so All stays on (D5)', async () => {
      mockProfiles([mockProfile1, mockProfile2]);
      mockStore({ activeProfileId: 'archived-business', allBusinesses: true, onOwedScreen: true });

      renderHook(() => useActiveProfile(), { wrapper: createWrapper() });

      await waitFor(() => expect(store.setWorkingProfile).toHaveBeenCalledWith('profile-1'));
      expect(store.setActiveProfile).not.toHaveBeenCalled();
    });

    it('should fallback to first profile when default is not set', async () => {
      mockProfiles([mockProfile1], { defaultProfile: undefined });

      const { result } = renderHook(() => useActiveProfile(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.activeProfileId).toBe('profile-1');
      });
    });

    it('should return empty string when no profiles exist', async () => {
      mockProfiles([], { defaultProfile: undefined });

      const { result } = renderHook(() => useActiveProfile(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.activeProfileId).toBe('');
    });
  });

  describe('loading states', () => {
    it('should indicate loading when profiles are loading', () => {
      mockProfiles([], { loading: true });

      const { result } = renderHook(() => useActiveProfile(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
    });

    it('should indicate loading when default profile is loading', () => {
      (useQueries.useDefaultBusinessProfile as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        data: undefined,
        isLoading: true,
      });

      const { result } = renderHook(() => useActiveProfile(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
    });
  });
});

describe('useProfileFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore({ activeProfileId: 'profile-1' });
    mockProfiles([mockProfile1, mockProfile2]);
  });

  it('should return profile ID when specific profile is active', async () => {
    const { result } = renderHook(() => useProfileFilter(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current).toBe('profile-1');
    });
  });

  it('returns the working business, never All, while All businesses is on (AC3)', () => {
    mockStore({ activeProfileId: 'profile-2', allBusinesses: true, onOwedScreen: true });
    const { result } = renderHook(() => useProfileFilter(), { wrapper: createWrapper() });

    expect(result.current).toBe('profile-2');
  });
});

describe('useOwedLens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore({ activeProfileId: 'profile-2' });
    mockProfiles([mockProfile1, mockProfile2]);
  });

  it('has no scope while the businesses are loading (D2)', () => {
    mockProfiles([], { loading: true });
    const { result } = renderHook(() => useOwedLens(), { wrapper: createWrapper() });

    expect(result.current.scope).toBeUndefined();
    expect(result.current.isAll).toBe(false);
  });

  it('reads the working business when All businesses is off', () => {
    const { result } = renderHook(() => useOwedLens(), { wrapper: createWrapper() });

    expect(result.current.scope).toBe('profile-2');
    expect(result.current.isAll).toBe(false);
  });

  it('reads every business in the switcher when All businesses is on (O3)', () => {
    mockStore({ activeProfileId: 'profile-2', allBusinesses: true, onOwedScreen: true });
    const { result } = renderHook(() => useOwedLens(), { wrapper: createWrapper() });

    expect(result.current.scope).toEqual(['profile-1', 'profile-2']);
    expect(result.current.isAll).toBe(true);
    expect(result.current.profilesById.get('profile-1')).toEqual(mockProfile1);
  });

  it('does not wait for the route flag: the owed screens call it on their first frame (D3)', () => {
    mockStore({ activeProfileId: 'profile-2', allBusinesses: true, onOwedScreen: false });
    const { result } = renderHook(() => useOwedLens(), { wrapper: createWrapper() });

    expect(result.current.isAll).toBe(true);
    expect(result.current.scope).toEqual(['profile-1', 'profile-2']);
  });

  it('reads the one business when All is chosen but only one business exists', () => {
    mockProfiles([mockProfile1]);
    mockStore({ activeProfileId: 'profile-1', allBusinesses: true });
    const { result } = renderHook(() => useOwedLens(), { wrapper: createWrapper() });

    expect(result.current.scope).toBe('profile-1');
    expect(result.current.isAll).toBe(false);
  });

  it('reads as today, with an empty scope, when there is no business at all (D4)', () => {
    mockProfiles([], { defaultProfile: undefined });
    mockStore({ activeProfileId: '', allBusinesses: true });
    const { result } = renderHook(() => useOwedLens(), { wrapper: createWrapper() });

    expect(result.current.scope).toBe('');
    expect(result.current.isAll).toBe(false);
  });
});
